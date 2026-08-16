/// <reference lib="dom" />
// electron/tsconfig.json::lib не включает DOM (main-процесс без DOM) — этот файл единственный
// среди electron/*.ts реально работающий в контексте страницы (document/window/MutationObserver),
// поэтому DOM lib подключается точечно только сюда, а не глобально в tsconfig (иначе main.ts/
// TabManager.ts тоже начали бы молча типизировать document/window, которых там не существует).
//
// Менеджер паролей, шаг 2 — content-preload на ГОСТЕВЫХ страницах (реальные сайты пользователя),
// в отличие от electron/preload.ts (только наш собственный chrome-UI) и preload-aipanel.ts/
// preload-translatepopover.ts/preload-findbar.ts/preload-suggestdropdown.ts (наши chrome-оверлеи).
// Это ПЕРВЫЙ preload, который выполняется в контексте реального сайта — см. TabManager.ts,
// webPreferences.preload в createTab/createPinnedTab/wakeTab.
//
// ⚠️ Никакого contextBridge.exposeInMainWorld здесь нет и не должно быть — странице не нужно
// самой ничего вызывать (вся логика — сканер DOM + ipcRenderer.on/send внутри изолированного
// мира preload). Не экспортировать в window страницы вообще ничего — это уже, чем «узкий
// contextBridge», и минимизирует поверхность атаки со стороны скриптов сайта.
//
// Каждый хук обёрнут в свой try/catch: сбой сканера/детектора НЕ должен ронять загрузку
// страницы или рендерер — фича должна тихо деградировать, а не браузинг.
//
// ⚠️ Каналы IPC.PASSWORDS_* НЕ импортируются из '../shared/ipc' — проверено эмпирически
// (Electron webContents 'preload-error': "module not found: ../shared/ipc"): sandboxed preload
// (webPreferences.sandbox: true, обязателен для гостевых страниц — снижать его тут нельзя ради
// удобства импорта) не может require() локальные относительные модули, только сам 'electron'
// и Node-совместимые встроенные. Отсюда — вручную продублированные строки, ДОЛЖНЫ совпадать
// с shared/ipc.ts::IPC.PASSWORDS_FORM_DETECTED/PASSWORDS_CREDENTIAL_SUBMITTED/PASSWORDS_FILL/
// PASSWORDS_FIELD_ICON_CLICK.
import { contextBridge, ipcRenderer } from 'electron';

// ─── Отпечаток браузера: window.chrome ──────────────────────────────────────
//
// Продолжение BrowserIdentity.ts — та же тема «как браузер представляется сайтам», но слой JS,
// до которого из main не дотянуться. Замер отпечатка против Edge на одной странице:
//   Edge   → window.chrome = { app, csi, loadTimes }
//   Oblako → window.chrome = {} (ноль ключей)
// Пустой `window.chrome` при строке UA, которая называет нас Chrome, — классический признак
// встроенного браузера, по нему нас и опознают (симптом: вход в аккаунт Google отвечает
// «Возможно, этот браузер или приложение небезопасны», справка Google прямым текстом называет
// причиной «браузер встроен в другое приложение»).
//
// ⚠️ Это НЕ маскировка чужого браузера: мы и есть Chromium той же версии, эти ветки отсутствуют
// только потому, что их не выставляет Electron. Значения берутся из настоящего Performance API
// страницы, а не выдумываются.
//
// ⚠️ Живёт здесь, а не в BrowserIdentity.ts, по единственной причине: гостевые страницы идут с
// contextIsolation+sandbox, и это ЕДИНСТВЕННАЯ точка, исполняющаяся в контексте реального сайта
// раньше его собственных скриптов. executeInMainWorld — потому что сам preload работает в
// изолированном мире, где правка window странице не видна.
// ⚠️ Известная дыра: OAuth-попапы создаются вообще без preload (см. TabManager.ts,
// setWindowOpenHandler) — туда шим не доезжает.
try {
  contextBridge.executeInMainWorld({
    func: () => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const w = window as any;
      const chrome = w.chrome ?? (w.chrome = {});
      const t = () => performance.timing;
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const navEntry = () => performance.getEntriesByType('navigation')[0] as any;

      if (!chrome.csi) {
        chrome.csi = function csi() {
          return {
            onloadT: t().domContentLoadedEventEnd,
            startE: t().navigationStart,
            pageT: performance.now(),
            tran: 15,
          };
        };
      }
      if (!chrome.loadTimes) {
        chrome.loadTimes = function loadTimes() {
          const proto = navEntry()?.nextHopProtocol || 'h2';
          const start = t().navigationStart / 1000;
          return {
            commitLoadTime: t().responseStart / 1000,
            connectionInfo: proto,
            finishDocumentLoadTime: t().domContentLoadedEventEnd / 1000,
            finishLoadTime: t().loadEventEnd / 1000,
            firstPaintAfterLoadTime: 0,
            firstPaintTime: start,
            navigationType: 'Other',
            npnNegotiatedProtocol: proto,
            requestTime: start,
            startLoadTime: start,
            wasAlternateProtocolAvailable: false,
            wasFetchedViaSpdy: proto !== 'http/1.1',
            wasNpnNegotiated: proto !== 'http/1.1',
          };
        };
      }
      if (!chrome.app) {
        chrome.app = {
          isInstalled: false,
          InstallState: { DISABLED: 'disabled', INSTALLED: 'installed', NOT_INSTALLED: 'not_installed' },
          RunningState: { CANNOT_RUN: 'cannot_run', READY_TO_RUN: 'ready_to_run', RUNNING: 'running' },
          getDetails: () => null,
          getIsInstalled: () => false,
          runningState: () => 'cannot_run',
        };
      }
    },
  });
} catch {
  // Тихо: сбой шима не должен ронять загрузку страницы (тот же принцип, что у хуков ниже).
}

const CH_FORM_DETECTED = 'passwords:form-detected';
const CH_CREDENTIAL_SUBMITTED = 'passwords:credential-submitted';
const CH_FILL = 'passwords:fill';
const CH_FIELD_ICON_CLICK = 'passwords:field-icon-click';
// Автозаполнение форм (адреса/карты) — ДОЛЖНЫ совпадать с shared/ipc.ts::IPC.AUTOFILL_FIELD_FOCUS/
// AUTOFILL_FILL_FIELDS (см. выше про невозможность импорта shared в sandboxed preload).
const CH_AUTOFILL_FIELD_FOCUS = 'autofill:field-focus';
const CH_AUTOFILL_DISMISS = 'autofill:dismiss';
const CH_AUTOFILL_FILL = 'autofill:fill-fields';
const CH_AUTOFILL_SUBMIT = 'autofill:submit';
const CH_AUTOFILL_MAP_FIELDS = 'autofill:map-fields';
const CH_AUTOFILL_PASTE_BLOB = 'autofill:paste-blob';
// Буфер скопированного со страниц (см. electron/ClipboardBuffer.ts).
const CH_CLIPBOARD_COPY = 'clipboard:copied';

function isTopFrame(): boolean {
  try {
    return window.top === window;
  } catch {
    return false;
  }
}

// ── Видимость поля — против фантомных/скрытых форм (clickjacking-смежный риск, см. бриф) ──
//
// ⚠️ Проверки ДВЕ, и путать их нельзя. «Отрисовано» — поле реально существует на странице и не
// спрятано стилями. «В окне» — вдобавок попадает в текущий вьюпорт.
// Раньше проверка была одна, с вьюпортом внутри, и ею же решался вопрос «есть ли на странице
// форма входа». Из-за этого форма НИЖЕ СГИБА не считалась формой вовсе: ключ в омнибоксе не
// загорался, автоподстановка единственного сохранённого входа не срабатывала — до тех пор, пока
// что-нибудь случайно не вызывало пересканирование. Для существования формы вьюпорт не важен;
// он важен только для размещения значка, который физически некуда рисовать за краем окна.
function isRendered(el: Element): boolean {
  const r = (el as HTMLElement).getBoundingClientRect();
  if (r.width === 0 || r.height === 0) return false;
  const style = getComputedStyle(el as HTMLElement);
  if (style.visibility === 'hidden' || style.display === 'none' || Number(style.opacity) === 0) return false;
  return true;
}

function isVisible(el: Element): boolean {
  if (!isRendered(el)) return false;
  const r = (el as HTMLElement).getBoundingClientRect();
  return !(r.bottom < 0 || r.right < 0 || r.top > window.innerHeight || r.left > window.innerWidth);
}

// Ищет ближайшее текстовое/email/tel поле той же формы — сначала назад по DOM-порядку от поля
// пароля (типичный порядок «логин, затем пароль»), потом любое подходящее поле в той же форме.
// getRootNode вместо document — поле может жить в shadow root (см. collectPasswordInputs),
// document его соседей просто не увидит.
function findUsernameField(passwordField: HTMLInputElement): HTMLInputElement | null {
  const scope: ParentNode = passwordField.form ?? (passwordField.getRootNode() as ParentNode);
  const candidates = Array.from(scope.querySelectorAll('input')) as HTMLInputElement[];
  const idx = candidates.indexOf(passwordField);
  const isUsernameType = (el: HTMLInputElement) => ['text', 'email', 'tel'].includes((el.type || 'text').toLowerCase());
  for (let i = idx - 1; i >= 0; i--) {
    if (isUsernameType(candidates[i]!)) return candidates[i]!;
  }
  return candidates.find((c) => c !== passwordField && isUsernameType(c)) ?? null;
}

// Обход С заходом в открытые shadow root'ы — современные UI-киты (web components) прячут поля
// туда, document.querySelectorAll их не видит (живой кейс: поле логина панели без иконки).
// Закрытые shadow root'ы физически недоступны — там честно пасуем. Полный проход по '*' на
// каждый скан дёшев относительно debounce 300ms (см. scheduleScan) — глубина обхода
// ограничена реальной вложенностью shadow-деревьев, обычно 0–1.
function collectPasswordInputs(root: ParentNode, out: HTMLInputElement[]): void {
  for (const el of Array.from(root.querySelectorAll('input[type="password"]'))) {
    out.push(el as HTMLInputElement);
  }
  for (const el of Array.from(root.querySelectorAll('*'))) {
    const shadow = (el as HTMLElement).shadowRoot;
    if (shadow) collectPasswordInputs(shadow, out);
  }
}

// Поля пароля, которые реально есть на странице. Намеренно БЕЗ проверки вьюпорта: форма внизу
// длинной страницы — такая же форма входа, её просто не видно без прокрутки.
function renderedPasswordFields(): HTMLInputElement[] {
  const all: HTMLInputElement[] = [];
  collectPasswordInputs(document, all);
  return all.filter(isRendered);
}

function scanForms(pwFields: HTMLInputElement[]): { hasLoginForm: boolean; hasUsernameField: boolean } {
  try {
    if (pwFields.length === 0) return { hasLoginForm: false, hasUsernameField: false };
    const hasUsernameField = pwFields.some((pf) => findUsernameField(pf) !== null);
    return { hasLoginForm: true, hasUsernameField };
  } catch {
    return { hasLoginForm: false, hasUsernameField: false };
  }
}

// ── Иконка-ключ прямо в поле пароля (не в тулбаре) ──────────────────────────────────────────
// Единственная внедряемая в страницу видимая вещь — маленький значок, ничего больше. Сама
// карточка с логинами/генератором рисуется в ОТДЕЛЬНОЙ привилегированной WebContentsView
// (electron/PasswordPopoverManager.ts, тот же compositор, что у тулбарной иконки-ключа) —
// просто заякоренной на позицию этого значка вместо позиции тулбара. Секреты через эту
// границу не проходят вообще: клик шлёт наружу только координаты поля (rect), ничего больше.
const ICON_SIZE = 20;
const ICON_MARGIN = 4;
// Меньше этого — поле физически не вместит значок без визуального мусора, не показываем.
const MIN_FIELD_WIDTH_FOR_ICON = ICON_SIZE + ICON_MARGIN * 2;
const MIN_FIELD_HEIGHT_FOR_ICON = 14;

const KEY_ICON_SVG = `
  <svg xmlns="http://www.w3.org/2000/svg" width="13" height="13" viewBox="0 0 24 24" fill="none"
       stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
    <path d="m15.5 7.5 2.3 2.3a1 1 0 0 0 1.4 0l2.1-2.1a1 1 0 0 0 0-1.4L19 4"/>
    <path d="m21 2-9.6 9.6"/>
    <circle cx="7.5" cy="15.5" r="5.5"/>
  </svg>`;

const fieldIcons = new Map<HTMLInputElement, { host: HTMLDivElement; btn: HTMLButtonElement }>();

function createIconHost(field: HTMLInputElement): { host: HTMLDivElement; btn: HTMLButtonElement } {
  const host = document.createElement('div');
  // Инлайн-стили на самом host — страница теоретически может их переопределить своим CSS
  // (тот же риск, на который идут любые расширения-менеджеры паролей), но случайный конфликт
  // маловероятен: ни класса, ни id, которые могла бы случайно поймать чужая CSS-селекция.
  host.style.cssText = 'position:fixed; top:0; left:0; width:0; height:0; z-index:2147483647; pointer-events:none;';
  const shadow = host.attachShadow({ mode: 'closed' });
  const btn = document.createElement('button');
  btn.type = 'button';
  btn.setAttribute('aria-label', 'Пароли Oblako');
  btn.innerHTML = KEY_ICON_SVG;
  btn.style.cssText = `
    all: initial; position: fixed; width: ${ICON_SIZE}px; height: ${ICON_SIZE}px;
    display: flex; align-items: center; justify-content: center; pointer-events: auto;
    border: none; border-radius: 5px; background: rgba(120,120,140,0.16); color: rgba(90,90,110,0.9);
    cursor: pointer; box-sizing: border-box;
  `;
  shadow.appendChild(btn);

  // ⚠️ event.isTrusted — обязательная проверка: без неё скрипт страницы мог бы программно
  // "нажать" на значок (el.dispatchEvent(new MouseEvent('click'))) и спровоцировать открытие
  // поповера/автоподстановку без реального пользователя за клавиатурой.
  btn.addEventListener('click', (e) => {
    try {
      if (!e.isTrusted) return;
      e.preventDefault();
      e.stopPropagation();
      const r = field.getBoundingClientRect();
      if (isTopFrame()) {
        ipcRenderer.send(CH_FIELD_ICON_CLICK, { rect: { x: r.left, y: r.top, width: r.width, height: r.height } });
      }
    } catch {
      // клик не должен ронять страницу
    }
  }, true);

  document.documentElement.appendChild(host);
  return { host, btn };
}

// Многие сайты уже держат свою иконку (глазик «показать пароль», галочка валидации и т.п.)
// в ТОМ ЖЕ правом углу поля — сам input часто растянут на всю ширину обёртки (включая место
// под чужую иконку), их overlay просто рисуется поверх через position:absolute внутри
// position:relative обёртки. Живой пример поймал это ровно так: наша иконка садилась
// ТОЧНО на чужую. Ищем такое препятствие в родителе/деде поля и уступаем ему место слева,
// вместо жёсткой привязки к правому краю самого input — без хардкода конкретных сайтов/классов.
function findRightEdgeObstacleX(field: HTMLInputElement, fieldRect: DOMRect): number | null {
  const scopes = [field.parentElement, field.parentElement?.parentElement].filter(
    (x): x is HTMLElement => !!x,
  );
  let leftmost: number | null = null;
  for (const scope of scopes) {
    for (const el of Array.from(scope.querySelectorAll('*'))) {
      if (el === field || el.tagName === 'INPUT') continue;
      const r = (el as HTMLElement).getBoundingClientRect();
      if (r.width === 0 || r.height === 0) continue;
      // Пересекается с полем по вертикали и находится в его правой половине — типичная зона
      // под «свою» иконку сайта. За пределы поля вправо не выходим — то, что торчит наружу
      // (например, кнопка отправки формы рядом), к этой эвристике не относится.
      const vOverlap = r.top < fieldRect.bottom && r.bottom > fieldRect.top;
      if (!vOverlap) continue;
      if (r.left < fieldRect.left + fieldRect.width * 0.5) continue;
      if (r.right > fieldRect.right + 4) continue;
      if (leftmost === null || r.left < leftmost) leftmost = r.left;
    }
  }
  return leftmost;
}

function positionIcon(field: HTMLInputElement, btn: HTMLButtonElement): boolean {
  const r = field.getBoundingClientRect();
  if (r.width < MIN_FIELD_WIDTH_FOR_ICON || r.height < MIN_FIELD_HEIGHT_FOR_ICON) return false;
  const obstacleX = findRightEdgeObstacleX(field, r);
  // Прижимаем к правому внутреннему краю поля — тот же приём, что у Chrome/1Password/Bitwarden —
  // либо, если там уже что-то чужое, уступаем место слева от него.
  const left = (obstacleX ?? r.right) - ICON_SIZE - ICON_MARGIN;
  // Не вылезаем ЗА левый край поля — если места категорически не хватает (узкое поле + чужая
  // иконка почти во всю ширину), лучше не показывать значок вовсе, чем рисовать его внахлёст
  // на текст/плейсхолдер.
  if (left < r.left + ICON_MARGIN) return false;
  const top = r.top + (r.height - ICON_SIZE) / 2;
  btn.style.left = `${left}px`;
  btn.style.top = `${top}px`;
  return true;
}

// Вызывается из debounced-скана (новые/пропавшие поля) И из scroll/resize (только репозишн,
// без пересчёта видимости — дёшево, может вызываться часто).
function repositionAllIcons() {
  try {
    for (const [field, { host, btn }] of fieldIcons) {
      // Поле исчезло из DOM — значок больше не к чему привязывать, убираем совсем.
      if (!field.isConnected) { host.remove(); fieldIcons.delete(field); continue; }
      // ⚠️ Поле уехало за край окна — ПРЯЧЕМ, но из карты НЕ убираем. Раньше убирали, а вернуть
      // значок могло только пересканирование, которого на прокрутку не вешается вовсе: прокрутил
      // мимо формы и обратно — значка нет, хотя поле на месте.
      const fits = isVisible(field) && positionIcon(field, btn);
      host.style.display = fits ? '' : 'none';
    }
  } catch {
    // repositioning не должен ронять страницу
  }
}

function syncIcons(pwFields: HTMLInputElement[]) {
  try {
    const current = new Set(pwFields);
    for (const [field, { host }] of fieldIcons) {
      if (!current.has(field)) { host.remove(); fieldIcons.delete(field); }
    }
    for (const field of pwFields) {
      if (fieldIcons.has(field)) continue;
      const { host, btn } = createIconHost(field);
      fieldIcons.set(field, { host, btn });
    }
    repositionAllIcons();
  } catch {
    // синк иконок не должен ронять страницу
  }
}

try {
  // capture:true — scroll не всплывает от вложенных скроллящихся контейнеров, только capture
  // ловит его на уровне window для ЛЮБОГО скролла на странице, не только document.
  window.addEventListener('scroll', repositionAllIcons, true);
  window.addEventListener('resize', repositionAllIcons);
} catch {
  // noop
}

// Дедуп — не спамим main одинаковым результатом на каждую мутацию DOM.
let lastScanKey = '';
function reportScan() {
  try {
    const pwFields = renderedPasswordFields();
    const result = scanForms(pwFields);
    if (isTopFrame()) syncIcons(pwFields);
    const key = `${result.hasLoginForm}:${result.hasUsernameField}`;
    if (key === lastScanKey) return;
    lastScanKey = key;
    if (isTopFrame()) ipcRenderer.send(CH_FORM_DETECTED, result);
  } catch {
    // сканер не должен ронять страницу
  }
}

let scanTimer: ReturnType<typeof setTimeout> | null = null;
function scheduleScan() {
  try {
    if (scanTimer) clearTimeout(scanTimer);
    scanTimer = setTimeout(reportScan, 300);
  } catch {
    // noop
  }
}

try {
  const observer = new MutationObserver(() => scheduleScan());
  observer.observe(document.documentElement, { childList: true, subtree: true });
} catch {
  // MutationObserver недоступен/страница успела уничтожить document — сканер просто не переоценивает динамику
}

document.addEventListener('DOMContentLoaded', scheduleScan);
window.addEventListener('load', scheduleScan);
try {
  // Поля, появившиеся БЕЗ DOM-мутаций, MutationObserver не поймает: CSS-анимация довела
  // opacity 0→1 уже после скана (isVisible отсеял поле навсегда), или поле живёт в shadow
  // root (мутации внутри него observer на documentElement не видит). Пересканируем по
  // пользовательским сигналам: фокус (composed — всплывает и из shadow) и конец
  // анимаций/переходов. Всё гасится тем же debounce 300ms — частые transitionend не страшны.
  window.addEventListener('focusin', scheduleScan, true);
  window.addEventListener('animationend', scheduleScan, true);
  window.addEventListener('transitionend', scheduleScan, true);
} catch {
  // noop
}
scheduleScan(); // на случай, если preload выполнился уже после DOMContentLoaded

// ── Детект сохранения — submit с непустым паролем + SPA-эвристика ──────────────────────────────
// «Грязное» поле — пароль реально заполнен пользователем, submit ещё не пойман. captureDirty
// хранит ССЫЛКУ на DOM-элемент (не строку) — на момент реального submit/SPA-навигации читаем
// АКТУАЛЬНОЕ .value, не protecting устаревший снимок.
let dirty: HTMLInputElement | null = null;
let reportedForDirty = false; // не шлём один и тот же submit дважды (обычный submit + SPA-эвристика на ту же навигацию)

function reportSubmit(username: string, password: string) {
  try {
    if (!password) return;
    if (isTopFrame()) ipcRenderer.send(CH_CREDENTIAL_SUBMITTED, { username, password });
    reportedForDirty = true;
  } catch {
    // детектор не должен ронять страницу
  }
}

document.addEventListener('input', (e) => {
  try {
    const t = e.target;
    if (t instanceof HTMLInputElement && t.type === 'password') {
      dirty = t.value ? t : null;
      if (t.value) reportedForDirty = false;
    }
  } catch {
    // noop
  }
}, true);

document.addEventListener('submit', (e) => {
  try {
    const form = e.target;
    if (!(form instanceof HTMLFormElement)) return;
    const pf = form.querySelector('input[type="password"]') as HTMLInputElement | null;
    if (!pf || !pf.value) return;
    reportSubmit(findUsernameField(pf)?.value ?? '', pf.value);
  } catch {
    // noop
  }
}, true);

// SPA: явного submit не было, но пароль был заполнен и произошла клиентская навигация
// (pushState/popstate) — типичный паттерн React/Vue форм логина. Честная эвристика, не ловит
// все варианты (см. бриф) — это ограничение, не баг.
function checkSpaSubmit() {
  try {
    if (reportedForDirty || !dirty || !dirty.value) return;
    reportSubmit(findUsernameField(dirty)?.value ?? '', dirty.value);
  } catch {
    // noop
  }
}

try {
  const originalPushState = history.pushState.bind(history);
  history.pushState = function (...args: Parameters<typeof history.pushState>) {
    checkSpaSubmit();
    return originalPushState(...args);
  };
  window.addEventListener('popstate', checkSpaSubmit);
} catch {
  // сайт мог заморозить history/pushState — SPA-эвристика просто не сработает, обычный submit не затронут
}

// ── Исполнитель заполнения — только по адресной команде от main, без submit ──────────────────
// ⚠️ Принимает и textarea: вставить адрес одной строкой человек может и в неё (поле «Комментарий
// к заказу» на многих формах доставки — обычная textarea), а нативный сеттер прототипа работает
// для обоих одинаково.
function setNativeValue(input: HTMLInputElement | HTMLTextAreaElement, value: string): void {
  const proto = Object.getPrototypeOf(input) as HTMLInputElement;
  const setter = Object.getOwnPropertyDescriptor(proto, 'value')?.set;
  if (setter) setter.call(input, value);
  else input.value = value;
  input.dispatchEvent(new Event('input', { bubbles: true }));
  input.dispatchEvent(new Event('change', { bubbles: true }));
}

// username: undefined (поле ОТСУТСТВУЕТ в payload, не пустая строка) — не трогать поле логина.
// Нужно генератору пароля: пользователь мог уже начать вводить логин, затирать его нельзя.
// Пустая строка — легитимное значение сохранённого логина (сайт без поля логина вообще).
// onlyIfEmpty — автозаполнение без клика (main шлёт его при обнаружении формы): непустые поля
// не трогаем вовсе — то, что пользователь уже ввёл руками, важнее сохранённого.
function fillCredential(username: string | undefined, password: string, onlyIfEmpty?: boolean): boolean {
  try {
    if (!isTopFrame()) return false;
    const passwordField = renderedPasswordFields()[0];
    if (!passwordField) return false;
    if (onlyIfEmpty && passwordField.value) return false;
    if (typeof username === 'string') {
      const usernameField = findUsernameField(passwordField);
      // ⚠️ ПУСТОЙ логин НИКОГДА не пишется поверх заполненного поля. Живой случай: сгенерировали
      // пароль из поля — он сохраняется в сейф сразу, но с пустым username (логина мы ещё не
      // знаем, см. handleGenerateAndFill). Дальше эта же запись предлагается «подставить
      // сохранённый вход», и подстановка затирала пустой строкой почту, которую человек уже
      // ввёл. Хуже того, это замыкало круг: на submit логин уходил пустым, запись его так и не
      // получала — отсюда жалоба «пароль сохраняется, а логин нет».
      const wipesFilledField = username === '' && usernameField?.value !== '';
      if (usernameField && isRendered(usernameField)
        && !(onlyIfEmpty && usernameField.value) && !wipesFilledField) {
        setNativeValue(usernameField, username);
      }
    }
    setNativeValue(passwordField, password);
    return true;
  } catch {
    return false;
  }
}

try {
  ipcRenderer.on(CH_FILL, (_e, payload: { username?: string; password?: string; onlyIfEmpty?: boolean }) => {
    try {
      if (typeof payload?.password !== 'string') return;
      fillCredential(payload.username, payload.password, payload.onlyIfEmpty === true);
    } catch {
      // исполнитель не должен ронять страницу
    }
  });
} catch {
  // IPC недоступен — автозаполнение просто не работает
}

// ── Автозаполнение форм: адреса и карты ─────────────────────────────────────────────────────
// Детект категории поля: сначала по autocomplete-токену (надёжнее всего), затем эвристика по
// name/id/placeholder/aria-label (в т.ч. рус.). Ключи совпадают с shared/ipc.ts::AutofillFieldKey.
// Заход 2 использует адресные ключи; карточные (cc*) детектятся тоже — для захода 3.
type AfKey =
  | 'fullName' | 'givenName' | 'familyName' | 'email' | 'phone'
  | 'street' | 'addressLine2' | 'city' | 'region' | 'postalCode' | 'country' | 'organization'
  | 'ccName' | 'ccNumber' | 'ccExpMonth' | 'ccExpYear' | 'ccExp';

const AF_ADDRESS_KEYS: ReadonlySet<AfKey> = new Set<AfKey>([
  'fullName', 'givenName', 'familyName', 'email', 'phone',
  'street', 'addressLine2', 'city', 'region', 'postalCode', 'country', 'organization',
]);

const AC_TO_KEY: Record<string, AfKey> = {
  'name': 'fullName', 'given-name': 'givenName', 'family-name': 'familyName',
  'email': 'email', 'tel': 'phone', 'tel-national': 'phone', 'tel-local': 'phone',
  'street-address': 'street', 'address-line1': 'street', 'address-line2': 'addressLine2',
  'address-level2': 'city', 'address-level1': 'region',
  'postal-code': 'postalCode', 'country': 'country', 'country-name': 'country',
  'organization': 'organization',
  'cc-name': 'ccName', 'cc-number': 'ccNumber', 'cc-exp': 'ccExp',
  'cc-exp-month': 'ccExpMonth', 'cc-exp-year': 'ccExpYear',
};

type FillField = HTMLInputElement | HTMLSelectElement;

/**
 * Человеческая подпись поля: текст <label>, а не только атрибуты.
 *
 * ⚠️ Раньше эвристика смотрела ТОЛЬКО name/id/placeholder/aria-label — то есть на то, что писал
 * программист, а не на то, что видит человек. На форме, где подпись живёт в теге <label> (это
 * половина русских сайтов, особенно без плейсхолдеров), автозаполнение молчало вовсе: поле с
 * подписью «Индекс» и name="pc_2" не распознавалось ничем.
 * Порядок поиска — от самого надёжного: aria-labelledby → label[for] → обёртка <label> → соседняя
 * ячейка/абзац перед полем.
 */
function labelTextFor(el: FillField): string {
  const clean = (s: string | null | undefined): string => (s || '').replace(/\s+/g, ' ').trim().slice(0, 80);
  try {
    const root = el.getRootNode() as Document | ShadowRoot;
    const labelledBy = el.getAttribute('aria-labelledby');
    if (labelledBy) {
      const parts = labelledBy.split(/\s+/)
        .map((id) => (root as Document).getElementById?.(id)?.textContent)
        .filter(Boolean);
      if (parts.length) return clean(parts.join(' '));
    }
    if (el.id) {
      // CSS.escape есть во всех Chromium; id вида «user.name» без него ломает селектор.
      const esc = (window.CSS && CSS.escape) ? CSS.escape(el.id) : el.id;
      const forLabel = (root as Document).querySelector?.(`label[for="${esc}"]`);
      if (forLabel?.textContent) return clean(forLabel.textContent);
    }
    const wrapping = el.closest('label');
    if (wrapping?.textContent) return clean(wrapping.textContent);
    // Последний шанс — текст непосредственно перед полем (частая вёрстка «<div>Индекс</div><input>»).
    const prev = el.previousElementSibling;
    if (prev && !prev.querySelector?.('input, select, textarea') && prev.textContent) {
      const t = clean(prev.textContent);
      if (t.length >= 2 && t.length <= 40) return t;
    }
  } catch { /* доступ к DOM подписи не критичен */ }
  return '';
}

// ── Второй эшелон детекта: категории, присланные моделью (см. AutofillFieldMapper.ts) ─────────
// WeakMap, а не атрибут на элементе: ничего в чужой DOM не пишем, и запись умирает вместе с полем.
const aiKeyByEl = new WeakMap<FillField, AfKey>();
// Спрашиваем ОДИН раз на загрузку страницы. Форма может дорисоваться позже, но повторные вопросы
// на каждую перерисовку — прямой путь занять очередь генерации ради одной и той же формы.
let aiMapAsked = false;

function detectFieldKey(el: FillField): AfKey | null {
  const known = detectFieldKeyStrict(el);
  if (known) return known;
  // ⚠️ Ответ модели — ТОЛЬКО там, где эвристика промолчала. Уверенный autocomplete-токен всегда
  // сильнее догадки: перебивать его моделью значило бы менять надёжное на вероятное.
  return aiKeyByEl.get(el) ?? null;
}

function detectFieldKeyStrict(el: FillField): AfKey | null {
  const type = (el.getAttribute('type') || 'text').toLowerCase();
  if (['password', 'hidden', 'submit', 'button', 'checkbox', 'radio', 'file', 'range', 'color', 'image'].includes(type)) {
    return null;
  }
  // autocomplete может нести секции/billing/shipping — берём последний осмысленный токен.
  const acRaw = (el.getAttribute('autocomplete') || '').toLowerCase().trim();
  for (const token of acRaw.split(/\s+/).reverse()) {
    if (AC_TO_KEY[token]) return AC_TO_KEY[token]!;
  }
  // Эвристика по атрибутам И по видимой подписи поля (см. labelTextFor).
  // cc-csc (CVC) намеренно НЕ детектим — мы его не храним и не заполняем.
  const hay = [el.getAttribute('name'), el.id, el.getAttribute('placeholder'), el.getAttribute('aria-label'), labelTextFor(el)]
    .filter(Boolean).join(' ').toLowerCase();
  if (/csc|cvv|cvc|security code|код.*карт/.test(hay)) return null;
  if (type === 'email' || /e-?mail|почт/.test(hay)) return 'email';
  if (type === 'tel' || /phone|\btel\b|моб|телефон/.test(hay)) return 'phone';
  if (/card.?number|cc-?num|номер.?карт/.test(hay)) return 'ccNumber';
  if (/card.?holder|name.?on.?card|владел.*карт|держател/.test(hay)) return 'ccName';
  if (/zip|postal|индекс/.test(hay)) return 'postalCode';
  if (/country|страна/.test(hay)) return 'country';
  // ⚠️ Для кириллицы граница слова — ТОЛЬКО через lookaround, а не \b. В JS \w это [A-Za-z0-9_],
  // русская буква для регулярки «не буква», поэтому между пробелом и «к» границы нет и шаблон
  // /\bкрай\b/ не совпадал НИКОГДА (он тут жил с самого начала и молча ничего не ловил). Ровно на
  // это же напоролась новая проверка «Имя»: /\bимя\b/ не сработала ни разу.
  if (/\bstate\b|province|region|област|регион|(?<![а-яё])край(?![а-яё])|республик/.test(hay)) return 'region';
  if (/\bcity\b|town|город/.test(hay)) return 'city';
  if (/organiz|company|компан|организац/.test(hay)) return 'organization';
  // ⚠️ Квартира/корпус — ДО улицы: их подписи часто соседствуют со словом «адрес», и общий
  // «адресный» шаблон ниже забрал бы их себе, подставив в квартиру название улицы.
  if (/\bapt\b|apartment|suite|\bunit\b|квартир|(?<![а-яё])кв\.|корпус|строени/.test(hay)) return 'addressLine2';
  if (/street|address|\baddr\b|улиц|адрес/.test(hay)) return 'street';
  if (/full.?name|(?<![а-яё])ф\.?и\.?о|fio|полное имя/.test(hay)) return 'fullName';
  // ⚠️ Фамилия и имя по-русски раньше не детектились ВООБЩЕ: они узнавались только по
  // autocomplete-токенам given-name/family-name, которых на русских формах обычно нет.
  if (/last.?name|surname|фамили/.test(hay)) return 'familyName';
  // «Имя» — только если это не «имя пользователя»: то поле про логин, и адрес туда не подставляют.
  if (!/пользовател|логин|user|account/.test(hay) && /first.?name|given.?name|(?<![а-яё])имя(?![а-яё])/.test(hay)) return 'givenName';
  return null;
}

// ⚠️ isRendered, НЕ isVisible: этим списком и заполняют форму, и собирают из неё значения при
// отправке. С проверкой вьюпорта на длинной форме заказа заполнялись только те поля, что попали
// в окно, — остальные оставались пустыми, и человек видел это как «автозаполнение работает
// через раз». Где поле находится относительно прокрутки, для его заполнения не значит ничего.
function collectAutofillFields(): Array<{ key: AfKey; el: FillField }> {
  const out: Array<{ key: AfKey; el: FillField }> = [];
  try {
    for (const el of Array.from(document.querySelectorAll('input, select')) as FillField[]) {
      if (!isRendered(el)) continue;
      const key = detectFieldKey(el);
      if (key) out.push({ key, el });
    }
  } catch {
    // сбой сканера не должен ронять страницу
  }
  return out;
}

function setSelectValue(sel: HTMLSelectElement, value: string): void {
  const v = value.trim().toLowerCase();
  for (const opt of Array.from(sel.options)) {
    if (opt.value.trim().toLowerCase() === v || opt.text.trim().toLowerCase() === v) {
      sel.value = opt.value;
      sel.dispatchEvent(new Event('input', { bubbles: true }));
      sel.dispatchEvent(new Event('change', { bubbles: true }));
      return;
    }
  }
}

/** Поле, про которое имеет смысл спрашивать: видимое, текстовое и ещё не распознанное. */
function isAskableField(el: FillField): boolean {
  const type = (el.getAttribute('type') || 'text').toLowerCase();
  if (!['text', 'tel', 'email', 'number', 'search', ''].includes(type) && el.tagName !== 'SELECT') return false;
  if (detectFieldKeyStrict(el)) return false;
  return isRendered(el);
}

/**
 * Спросить main (а он — модель или кэш), что за поля на этой форме.
 *
 * ⚠️ Порог в три неопознанных поля — не перестраховка. Одно-два безымянных текстовых поля есть
 * почти на каждом сайте (поиск, промокод, подписка на рассылку), и спрашивать про них модель
 * значит греть очередь генерации на каждой странице интернета. Три и больше — это уже форма.
 */
async function askAiFieldMap(): Promise<boolean> {
  if (aiMapAsked) return false;
  aiMapAsked = true;
  try {
    const askable = (Array.from(document.querySelectorAll('input, select')) as FillField[]).filter(isAskableField);
    if (askable.length < 3) return false;
    const fields = askable.slice(0, 12).map((el, i) => ({
      i,
      label: labelTextFor(el),
      name: el.getAttribute('name') || el.id || '',
      placeholder: el.getAttribute('placeholder') || '',
      type: (el.getAttribute('type') || (el.tagName === 'SELECT' ? 'select' : 'text')).toLowerCase(),
    }));
    // Наружу уходят ТОЛЬКО подписи полей — ни введённых значений, ни содержимого страницы.
    const map = await ipcRenderer.invoke(CH_AUTOFILL_MAP_FIELDS, { fields }) as Record<string, AfKey>;
    let got = 0;
    for (const [idx, key] of Object.entries(map || {})) {
      const el = askable[Number(idx)];
      if (el && key) { aiKeyByEl.set(el, key); got++; }
    }
    return got > 0;
  } catch {
    return false; // модели нет, ответа нет — работает как раньше
  }
}

// ⚠️ Форма ВХОДА — не форма с адресом, даже если поле выглядит как email. Живой случай: страница
// «Sign In» с единственным полем «username or email address» получала поповер «Заполнить адрес» с
// домашним адресом человека. Признака два, и оба нужны: подпись самого поля (двухшаговый вход
// показывает логин без пароля вовсе) и наличие поля пароля в той же форме.
function looksLikeCredentials(el: FillField): boolean {
  const hay = [el.getAttribute('name'), el.id, el.getAttribute('placeholder'),
    el.getAttribute('aria-label'), el.getAttribute('autocomplete'), labelTextFor(el)]
    .filter(Boolean).join(' ').toLowerCase();
  if (/username|user name|login|sign.?in|log.?in|логин|войти|вход(?![а-яё])/.test(hay)) return true;
  const scope: ParentNode = el.form ?? document;
  return !!scope.querySelector('input[type="password"]');
}

// ⚠️ Сколько РАЗНЫХ категорий полей должно быть в форме, чтобы она считалась формой адреса/карты.
//
// Живая жалоба: поповер «Заполнить адрес» всплывал буквально на любой форме — достаточно было
// одного распознанного поля, а «email», «телефон» и «город» есть в подписке на рассылку, в
// фильтре каталога, в форме отзыва и в поиске по сайту. Предложение подставить домашний адрес там
// не просто бесполезно, оно навязчиво, а незаказанное действие, лезущее на каждой странице, —
// ровно тот класс ошибки, из-за которого в проекте уже выпилили системный диалог «Сохранить как».
// Считаем именно РАЗНЫЕ категории, а не поля: три поля «имя» подряд формой адреса не делают.
const MIN_ADDRESS_CATEGORIES = 3;
// Карте хватает двух: её поля (номер, держатель, срок) больше нигде не встречаются, и спутать
// такую форму не с чем.
const MIN_CARD_CATEGORIES = 2;

function countFieldCategories(el: FillField, kind: 'address' | 'card'): number {
  // Область — САМА форма, если поле в ней: на странице каталога может жить и форма подписки, и
  // форма заказа, и складывать их поля в одну кучу значит снова считать форму адресом.
  const scope: ParentNode = el.form ?? document;
  const seen = new Set<AfKey>();
  try {
    for (const f of Array.from(scope.querySelectorAll('input, select')) as FillField[]) {
      // isRendered: порог «три разные категории» считается по ВСЕЙ форме. С проверкой вьюпорта
      // длинная форма заказа порога не набирала — предложение автозаполнения не всплывало вовсе.
      if (!isRendered(f)) continue;
      const k = detectFieldKey(f);
      if (!k) continue;
      if ((AF_ADDRESS_KEYS.has(k) ? 'address' : 'card') !== kind) continue;
      seen.add(k);
    }
  } catch { /* обход DOM не критичен */ }
  return seen.size;
}

function reportAutofillFocus(el: FillField): void {
  const key = detectFieldKey(el);
  if (!key) return;
  // Адрес на форме входа не предлагаем вовсе; карту — тем более (её поля там взяться не могут).
  if (looksLikeCredentials(el)) return;
  // ⚠️ В УЖЕ ЗАПОЛНЕННОЕ поле предлагать нечего. Живой случай: сайт со своей системой подсказок
  // адреса подставил нормализованное значение, человек его подтвердил, потом кликнул в это поле
  // снова — и наше предложение перезаписало подтверждённое своим. Пустое поле — это просьба о
  // помощи, заполненное — уже принятое решение, и трогать его мы не вправе.
  // Список (select) не проверяем: у него «значение» есть всегда, в том числе placeholder.
  if (el instanceof HTMLInputElement && el.value.trim() !== '') return;
  const kind = AF_ADDRESS_KEYS.has(key) ? 'address' : 'card';
  const need = kind === 'address' ? MIN_ADDRESS_CATEGORIES : MIN_CARD_CATEGORIES;
  if (countFieldCategories(el, kind) < need) return;
  const r = el.getBoundingClientRect();
  lastAutofillFocusAt = performance.now();
  ipcRenderer.send(CH_AUTOFILL_FIELD_FOCUS, {
    rect: { x: r.x, y: r.y, width: r.width, height: r.height }, kind,
  });
}

// Убрать поповер автозаполнения. Три повода, и все три — обычные способы «отменить» в интерфейсе:
// Esc, уход фокуса с поля, прокрутка страницы (карточка заякорена на поле и уехала бы от него).
let lastAutofillFocusAt = 0;

function dismissAutofill(): void {
  try { if (isTopFrame()) ipcRenderer.send(CH_AUTOFILL_DISMISS); } catch { /* фрейм умер */ }
}
window.addEventListener('keydown', (e) => { if (e.key === 'Escape') dismissAutofill(); }, true);
// ⚠️ relatedTarget === null означает «фокус ушёл ИЗ документа», и это ровно то, что делает сам
// поповер: он живёт отдельной WebContentsView и, появившись, забирает фокус у поля. Без этой
// проверки карточка гасила сама себя в момент показа — то есть не появлялась вообще.
// Закрываем только когда фокус перешёл к ДРУГОМУ элементу той же страницы.
window.addEventListener('focusout', (e) => {
  const t = e.target;
  if (!(t instanceof HTMLInputElement || t instanceof HTMLSelectElement)) return;
  if ((e as FocusEvent).relatedTarget === null) return;
  dismissAutofill();
}, true);
// ⚠️ Прокрутка закрывает поповер, НО не сразу после показа. Замер поймал: фокус на поле сам
// прокручивает страницу (scroll-into-view браузера), событие приходит уже ПОСЛЕ показа — и
// карточка гасла в тот же миг, то есть не появлялась вовсе. Короткая пауза отделяет прокрутку
// браузера от прокрутки человека, ради которой правило и заведено (карточка заякорена на поле).
const SCROLL_GRACE_MS = 500;
window.addEventListener('scroll', () => {
  if (performance.now() - lastAutofillFocusAt < SCROLL_GRACE_MS) return;
  dismissAutofill();
}, { capture: true, passive: true });

// Фокус на поле автозаполнения (top-frame) → сообщаем main позицию поля и вид формы, чтобы он
// показал поповер выбора. Тот же top-frame-гвард, что у паролей: из кросс-origin iframe не шлём.
window.addEventListener('focusin', (e) => {
  try {
    if (!isTopFrame()) return;
    const t = e.target;
    if (!(t instanceof HTMLInputElement || t instanceof HTMLSelectElement)) return;
    if (detectFieldKey(t)) { reportAutofillFocus(t); return; }
    // Поле не узнали — это и есть повод спросить модель. ⚠️ Ответ приходит асинхронно, и к этому
    // моменту человек мог уйти в другое поле: поповер показываем не «тому полю, про которое
    // спрашивали», а тому, где фокус СЕЙЧАС, — иначе карточка всплывёт над полем, которое человек
    // уже покинул.
    if (!isAskableField(t)) return;
    void askAiFieldMap().then((gotSomething) => {
      if (!gotSomething) return;
      const active = document.activeElement;
      if (active instanceof HTMLInputElement || active instanceof HTMLSelectElement) reportAutofillFocus(active);
    });
  } catch {
    // noop
  }
}, true);

// Отправка формы с данными адреса/карты → предлагаем сохранить (offer-save, как у паролей).
// Собираем ТЕКУЩИЕ значения распознанных полей; если это карта (есть номер) — kind 'card', иначе
// адрес (если заполнено хоть сколько-то осмысленных полей). Только top-frame.
function gatherAutofillSubmit(): { kind: 'address' | 'card'; fields: Partial<Record<AfKey, string>> } | null {
  const values: Partial<Record<AfKey, string>> = {};
  for (const { key, el } of collectAutofillFields()) {
    const v = (el.value || '').trim();
    if (v) values[key] = v;
  }
  // Карта: есть номер (>=12 цифр). CVC не собираем (детектор его и не отдаёт).
  if (values.ccNumber && values.ccNumber.replace(/\D/g, '').length >= 12) {
    return { kind: 'card', fields: values };
  }
  // Адрес: хотя бы два осмысленных поля из ключевых — иначе это не форма адреса.
  const addressKeys: AfKey[] = ['fullName', 'givenName', 'familyName', 'email', 'phone', 'street', 'city', 'postalCode', 'region', 'country'];
  const filled = addressKeys.filter((k) => values[k]);
  if (filled.length >= 2) return { kind: 'address', fields: values };
  return null;
}

function reportAutofillSubmit() {
  try {
    if (!isTopFrame()) return;
    const payload = gatherAutofillSubmit();
    if (payload) ipcRenderer.send(CH_AUTOFILL_SUBMIT, payload);
  } catch {
    // детектор не должен ронять страницу
  }
}

// Тот же submit-хук, что у паролей (и SPA-навигация через pushState/popstate, уже перехваченные
// выше для checkSpaSubmit) — переиспользуем событие submit; SPA-случай ловим в тех же местах.
document.addEventListener('submit', () => reportAutofillSubmit(), true);
try {
  const origPush = history.pushState.bind(history);
  history.pushState = function (...args: Parameters<typeof history.pushState>) {
    reportAutofillSubmit();
    return origPush(...args);
  };
  window.addEventListener('popstate', reportAutofillSubmit);
} catch {
  // сайт мог заморозить history — offer-save на SPA просто не сработает
}

// ── Вставленная строка с адресом (AI-IDEAS.md №1) ───────────────────────────
//
// Человек вставляет в поле формы всю строку целиком («Иванов Иван, 123456, Москва, …»), а
// разложить её по полям предлагаем мы.
//
// ⚠️ Вставку НЕ отменяем (никакого preventDefault): если разбор не сложится или человек откажется,
// его текст обязан оказаться в поле ровно там, куда он его вставлял. Убираем строку только когда
// он согласился разложить — тогда она уже лишняя (см. пометку ниже).
const PASTED_MARK = 'data-oblako-pasted';

/**
 * Похоже ли вставленное на адрес одной строкой.
 *
 * ⚠️ Это ГЛАВНЫЙ фильтр приватности, а не оптимизация: всё, что пройдёт проверку, уедет в main
 * к локальной модели. Поэтому условия узкие — длина в разумных пределах, несколько частей через
 * разделители и хотя бы одно число (индекс или телефон есть в любом адресе доставки). Случайно
 * скопированный пароль, ссылка или абзац текста сюда не попадают.
 */
function looksLikeAddressBlob(text: string): boolean {
  const t = text.trim();
  if (t.length < 20 || t.length > 300) return false;
  if (/\n.*\n.*\n/.test(t)) return false;          // многострочное — это уже не «одна строка»
  if (/^\w+:\/\//.test(t) || /\s{4,}/.test(t)) return false; // ссылка, кусок таблицы
  const separators = (t.match(/[,;]|\s—\s/g) ?? []).length;
  if (separators < 2) return false;
  if (!/\d/.test(t)) return false;
  return t.split(/\s+/).length >= 4;
}

// Сколько полей формы должно быть на странице, чтобы предложение имело смысл: раскладывать
// строку на два поля незачем, человек сделает это быстрее сам.
const MIN_FIELDS_FOR_PARSE = 3;

try {
  document.addEventListener('paste', (e) => {
    try {
      if (!isTopFrame()) return;
      const t = e.target;
      if (!(t instanceof HTMLInputElement || t instanceof HTMLTextAreaElement)) return;
      if (t.type && /password|hidden|file|checkbox|radio/i.test(t.type)) return;
      // На форме входа не предлагаем ничего и никогда — то же правило, что у поповера адреса.
      if (t instanceof HTMLInputElement && looksLikeCredentials(t)) return;

      const text = (e as ClipboardEvent).clipboardData?.getData('text/plain') ?? '';
      if (!looksLikeAddressBlob(text)) return;
      if (collectAutofillFields().length < MIN_FIELDS_FOR_PARSE) return;

      // Помечаем поле АТРИБУТОМ: ссылку на узел через мост не передать, а путь по индексам
      // протухает от первой же перерисовки формы (тот же приём, что в pageFacts.ts и правке текста).
      document.querySelectorAll(`[${PASTED_MARK}]`).forEach((el) => el.removeAttribute(PASTED_MARK));
      t.setAttribute(PASTED_MARK, '1');

      const r = t.getBoundingClientRect();
      lastAutofillFocusAt = performance.now();
      ipcRenderer.send(CH_AUTOFILL_PASTE_BLOB, {
        text: text.trim(),
        rect: { x: r.x, y: r.y, width: r.width, height: r.height },
      });
    } catch {
      // разбор вставки не имеет права ронять страницу
    }
  }, true);
} catch {
  // IPC недоступен
}

// ── Копирование со страницы (буфер браузера) ────────────────────────────────
//
// ⚠️ Источник буфера — только САМА СТРАНИЦА: системный буфер обмена мы не опрашиваем никогда,
// иначе в историю попадало бы всё, что человек копирует в других приложениях (см.
// ClipboardBuffer.ts). Но способов скопировать со страницы ДВА, и один сначала проглядели —
// см. шим navigator.clipboard ниже.
//
// ⚠️ Копию ИЗ ПОЛЯ ПАРОЛЯ не отправляем, и это не формальность: человек мог показать пароль
// глазом-иконкой и скопировать его прямо со страницы, а наш буфер живёт в памяти main и
// показывается списком — там ему не место ни секунды.
const forbiddenSource = (): boolean => {
  const el = document.activeElement;
  if (el instanceof HTMLInputElement && /password/i.test(el.type || '')) return true;
  // Форма входа целиком: логин оттуда тоже не нужен в общем списке.
  if (el instanceof HTMLInputElement && looksLikeCredentials(el)) return true;
  return false;
};

const reportCopy = (text: string): void => {
  try {
    if (!isTopFrame() || !text || forbiddenSource()) return;
    ipcRenderer.send(CH_CLIPBOARD_COPY, { text: text.slice(0, 20000), title: document.title || '' });
  } catch {
    // копирование не имеет права ломаться из-за нас
  }
};

try {
  document.addEventListener('copy', () => {
    try {
      // ⚠️ Выделение ВНУТРИ поля ввода `window.getSelection()` не отдаёт — для input/textarea
      // Chromium держит его отдельно (selectionStart/End). Сайты, копирующие через скрытую
      // textarea + execCommand('copy'), идут ровно этим путём, и без второй ветки такая копия
      // выглядела бы как «скопировали пустоту».
      const el = document.activeElement;
      const inField = el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement
        ? (el.value ?? '').slice(el.selectionStart ?? 0, el.selectionEnd ?? 0)
        : '';
      reportCopy(inField || String(window.getSelection() || ''));
    } catch {
      // копирование не имеет права ломаться из-за нас
    }
  }, true);
} catch {
  // IPC недоступен
}

// ⚠️ ВТОРОЙ способ скопировать со страницы: `navigator.clipboard`, которым пользуются кнопки
// «Копировать» — в AI-чатах, у блоков кода, у промокодов. События `copy` при этом НЕ ВОЗНИКАЕТ
// ВООБЩЕ и выделения тоже нет, поэтому обработчик выше про такие копии не узнавал никогда: в
// буфер попадал обычный текст, выделенный мышью, и не попадало ровно то, что человек копировал
// осознанным нажатием кнопки (живая жалоба).
//
// ⚠️ Шим ставится в ГЛАВНОМ мире через executeInMainWorld — тот же приём и та же причина, что у
// шима `window.chrome` в начале файла: сам preload живёт в изолированном мире, где правка
// `navigator` странице не видна. Функция-докладчик приезжает аргументом (contextBridge проксирует
// функции между мирами), поэтому ipcRenderer в главный мир не протекает.
//
// ⚠️ Поверхность захвата этим расширяется, и это осознанно: под неё попадают и коды из
// двухфакторной аутентификации, и сгенерированный на сайте пароль. Держит риск та же конструкция,
// что и раньше, — только память, только сеанс, инкогнито исключено целиком, выключатель в поповере
// стирает собранное. На диск не попадает ничего.
//
// ⚠️ Оборачиваем И `write` (ClipboardItem), а не только `writeText`: чаты, копирующие ответ с
// разметкой, кладут в буфер сразу text/html и text/plain, и на `writeText` такой сайт не заходит.
// Читаем ТОЛЬКО text/plain — картинку из буфера мы всё равно не показываем.
try {
  contextBridge.executeInMainWorld({
    func: (report: (text: string) => void) => {
      try {
        const clip = navigator.clipboard as unknown as {
          writeText?: (t: string) => Promise<void>;
          write?: (items: unknown[]) => Promise<void>;
        } | undefined;
        if (!clip) return;

        const origText = clip.writeText;
        if (typeof origText === 'function') {
          clip.writeText = function writeText(text: string) {
            try { report(String(text ?? '')); } catch { /* сайт не должен пострадать */ }
            return origText.call(this, text);
          };
        }

        const origWrite = clip.write;
        if (typeof origWrite === 'function') {
          clip.write = function write(items: unknown[]) {
            try {
              for (const item of items ?? []) {
                const it = item as { types?: string[]; getType?: (t: string) => Promise<Blob> };
                if (!it?.types?.includes('text/plain') || typeof it.getType !== 'function') continue;
                // Промис не ждём и в возврат не вмешиваемся: наша слежка не имеет права ни
                // задержать копирование, ни уронить его своей ошибкой.
                void it.getType('text/plain')
                  .then((b) => b.text())
                  .then((t) => { try { report(String(t ?? '')); } catch { /* … */ } })
                  .catch(() => { /* сайт мог отдать пустой blob */ });
                break;
              }
            } catch { /* сайт не должен пострадать */ }
            return origWrite.call(this, items);
          };
        }
      } catch {
        // страница обязана продолжить работать даже если шим не встал
      }
    },
    args: [(text: string) => reportCopy(text)],
  });
} catch {
  // executeInMainWorld недоступен (нет contextIsolation) — тогда просто нет этой ветки источника
}

// Подстановка выбранного профиля/карты: main шлёт карту «категория → значение», заполняем поля.
try {
  ipcRenderer.on(CH_AUTOFILL_FILL, (_e, fields: Partial<Record<AfKey, string>>) => {
    try {
      if (!isTopFrame() || !fields || typeof fields !== 'object') return;
      const filled = new Set<Element>();
      for (const { key, el } of collectAutofillFields()) {
        const value = fields[key];
        if (typeof value !== 'string' || value === '') continue;
        if (el instanceof HTMLSelectElement) setSelectValue(el, value);
        else setNativeValue(el, value);
        filled.add(el);
      }
      // ⚠️ Строку, которую человек вставил целиком, убираем — но ТОЛЬКО если она осталась лежать
      // в поле, куда её никто не разложил. Иначе адрес оказался бы на форме дважды: разобранный
      // по полям и он же одной строкой в поле «Имя». Поле, получившее своё значение, не трогаем.
      const pasted = document.querySelector(`[${PASTED_MARK}]`);
      if (pasted) {
        pasted.removeAttribute(PASTED_MARK);
        if (!filled.has(pasted) && (pasted instanceof HTMLInputElement || pasted instanceof HTMLTextAreaElement)) {
          setNativeValue(pasted, '');
        }
      }
    } catch {
      // исполнитель не должен ронять страницу
    }
  });
} catch {
  // IPC недоступен
}

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
import { ipcRenderer } from 'electron';

const CH_FORM_DETECTED = 'passwords:form-detected';
const CH_CREDENTIAL_SUBMITTED = 'passwords:credential-submitted';
const CH_FILL = 'passwords:fill';
const CH_FIELD_ICON_CLICK = 'passwords:field-icon-click';

function isTopFrame(): boolean {
  try {
    return window.top === window;
  } catch {
    return false;
  }
}

// ── Видимость поля — против фантомных/скрытых форм (clickjacking-смежный риск, см. бриф) ──
function isVisible(el: Element): boolean {
  const r = (el as HTMLElement).getBoundingClientRect();
  if (r.width === 0 || r.height === 0) return false;
  const style = getComputedStyle(el as HTMLElement);
  if (style.visibility === 'hidden' || style.display === 'none' || Number(style.opacity) === 0) return false;
  if (r.bottom < 0 || r.right < 0 || r.top > window.innerHeight || r.left > window.innerWidth) return false;
  return true;
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

function visiblePasswordFields(): HTMLInputElement[] {
  const all: HTMLInputElement[] = [];
  collectPasswordInputs(document, all);
  return all.filter(isVisible);
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
      if (!field.isConnected || !isVisible(field)) { host.remove(); fieldIcons.delete(field); continue; }
      const fits = positionIcon(field, btn);
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
    const pwFields = visiblePasswordFields();
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
function setNativeValue(input: HTMLInputElement, value: string): void {
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
    const passwordField = visiblePasswordFields()[0];
    if (!passwordField) return false;
    if (onlyIfEmpty && passwordField.value) return false;
    if (typeof username === 'string') {
      const usernameField = findUsernameField(passwordField);
      if (usernameField && isVisible(usernameField) && !(onlyIfEmpty && usernameField.value)) {
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

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
// с shared/ipc.ts::IPC.PASSWORDS_FORM_DETECTED/PASSWORDS_CREDENTIAL_SUBMITTED/PASSWORDS_FILL.
import { ipcRenderer } from 'electron';

const CH_FORM_DETECTED = 'passwords:form-detected';
const CH_CREDENTIAL_SUBMITTED = 'passwords:credential-submitted';
const CH_FILL = 'passwords:fill';

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
function findUsernameField(passwordField: HTMLInputElement): HTMLInputElement | null {
  const scope: ParentNode = passwordField.form ?? document;
  const candidates = Array.from(scope.querySelectorAll('input')) as HTMLInputElement[];
  const idx = candidates.indexOf(passwordField);
  const isUsernameType = (el: HTMLInputElement) => ['text', 'email', 'tel'].includes((el.type || 'text').toLowerCase());
  for (let i = idx - 1; i >= 0; i--) {
    if (isUsernameType(candidates[i]!)) return candidates[i]!;
  }
  return candidates.find((c) => c !== passwordField && isUsernameType(c)) ?? null;
}

function scanForms(): { hasLoginForm: boolean; hasUsernameField: boolean } {
  try {
    const pwFields = (Array.from(document.querySelectorAll('input[type="password"]')) as HTMLInputElement[]).filter(isVisible);
    if (pwFields.length === 0) return { hasLoginForm: false, hasUsernameField: false };
    const hasUsernameField = pwFields.some((pf) => findUsernameField(pf) !== null);
    return { hasLoginForm: true, hasUsernameField };
  } catch {
    return { hasLoginForm: false, hasUsernameField: false };
  }
}

// Дедуп — не спамим main одинаковым результатом на каждую мутацию DOM.
let lastScanKey = '';
function reportScan() {
  try {
    const result = scanForms();
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

function fillCredential(username: string, password: string): boolean {
  try {
    if (!isTopFrame()) return false;
    const pwFields = (Array.from(document.querySelectorAll('input[type="password"]')) as HTMLInputElement[]).filter(isVisible);
    const passwordField = pwFields[0];
    if (!passwordField) return false;
    const usernameField = findUsernameField(passwordField);
    if (usernameField && isVisible(usernameField)) setNativeValue(usernameField, username);
    setNativeValue(passwordField, password);
    return true;
  } catch {
    return false;
  }
}

try {
  ipcRenderer.on(CH_FILL, (_e, payload: { username?: string; password?: string }) => {
    try {
      if (typeof payload?.password !== 'string') return;
      fillCredential(typeof payload.username === 'string' ? payload.username : '', payload.password);
    } catch {
      // исполнитель не должен ронять страницу
    }
  });
} catch {
  // IPC недоступен — автозаполнение просто не работает
}

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
// (Каналы submit/fill добавятся сюда же в коммитах 2/3 — на этом шаге только сканер.)
import { ipcRenderer } from 'electron';

const CH_FORM_DETECTED = 'passwords:form-detected';

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
    ipcRenderer.send(CH_FORM_DETECTED, result);
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

import type { WebContents } from 'electron';
import { IPC } from '../shared/ipc';
import type { ClipboardLink, MediaSessionReport } from '../shared/ipc';

type Rect = { x: number; y: number; width: number; height: number };
type FieldKind = 'address' | 'card';

// Колбэки читают текущее состояние владельца в момент события: часть из них задаётся уже после
// создания вкладки, а при передаче вкладки старые слушатели остаются и молчат через mine().
export interface GuestSignalHooks {
  mine(): boolean;
  isIncognito(): boolean;
  onPasswordForm(hasLoginForm: boolean, hasUsernameField: boolean, url: string): void;
  onPasswordSubmit(username: string, password: string, url: string): void;
  onPasswordFieldAnchor(rect: Rect, url: string): void;
  onMediaReport(report: MediaSessionReport, url: string): void;
  onPasswordDismiss(): void;
  onAutofillFieldFocus(rect: Rect, kind: FieldKind, url: string): void;
  onAutofillPasteBlob(text: string, rect: Rect): void;
  onPageCopy(text: string, url: string, title: string, rich: { html: string; links: ClipboardLink[] }): void;
  onAutofillDismiss(): void;
  mapFields(origin: string, fields: unknown): Promise<Record<number, string>> | undefined;
  onAutofillSubmit(kind: FieldKind, fields: Record<string, string>, url: string): void;
}

export function wireTabGuestSignals(wc: WebContents, hooks: GuestSignalHooks): void {
  // Per-view IPC даёт достоверный WebContents. URL читаем в main, не из payload страницы.
  wc.ipc.on(IPC.PASSWORDS_FORM_DETECTED, (_e, payload: { hasLoginForm: boolean; hasUsernameField: boolean }) => {
    if (!hooks.mine()) return;
    try { hooks.onPasswordForm(payload.hasLoginForm, payload.hasUsernameField, wc.getURL()); }
    catch (e) { console.warn('[TabMgr] onPasswordFormCb error:', (e as Error).message); }
  });
  wc.ipc.on(IPC.PASSWORDS_CREDENTIAL_SUBMITTED, (_e, payload: { username: string; password: string }) => {
    if (!hooks.mine()) return;
    try { hooks.onPasswordSubmit(payload.username, payload.password, wc.getURL()); }
    catch (e) { console.warn('[TabMgr] onPasswordSubmitCb error:', (e as Error).message); }
  });
  wc.ipc.on(IPC.PASSWORDS_FIELD_ICON_CLICK, (_e, payload: { rect: Rect }) => {
    if (!hooks.mine()) return;
    try { hooks.onPasswordFieldAnchor(payload.rect, wc.getURL()); }
    catch (e) { console.warn('[TabMgr] onPasswordFieldAnchorCb error:', (e as Error).message); }
  });
  wc.ipc.on(IPC.MEDIA_SESSION_REPORT, (_e, report: MediaSessionReport) => {
    if (!hooks.mine()) return;
    try { hooks.onMediaReport(report, wc.getURL()); }
    catch (e) { console.warn('[TabMgr] onMediaReportCb error:', (e as Error).message); }
  });
  wc.ipc.on(IPC.PASSWORDS_DISMISS, () => {
    if (!hooks.mine()) return;
    try { hooks.onPasswordDismiss(); }
    catch (e) { console.warn('[TabMgr] onPasswordDismissCb error:', (e as Error).message); }
  });
  wc.ipc.on(IPC.PASSWORDS_FIELD_FOCUS, (_e, payload: { rect: Rect }) => {
    if (!hooks.mine()) return;
    try { hooks.onPasswordFieldAnchor(payload.rect, wc.getURL()); }
    catch (e) { console.warn('[TabMgr] onPasswordFieldAnchorCb error (field):', (e as Error).message); }
  });
  wc.ipc.on(IPC.AUTOFILL_FIELD_FOCUS, (_e, payload: { rect: Rect; kind: FieldKind }) => {
    if (!hooks.mine()) return;
    try { hooks.onAutofillFieldFocus(payload.rect, payload.kind, wc.getURL()); }
    catch (e) { console.warn('[TabMgr] onAutofillFieldFocusCb error:', (e as Error).message); }
  });
  wc.ipc.on(IPC.AUTOFILL_PASTE_BLOB, (_e, payload: { text: string; rect: Rect }) => {
    if (!hooks.mine()) return;
    try { hooks.onAutofillPasteBlob(payload.text, payload.rect); }
    catch (e) { console.warn('[TabMgr] onAutofillPasteBlobCb error:', (e as Error).message); }
  });
  // Приватная вкладка не должна оставлять запись в буфере браузера.
  wc.ipc.on(IPC.CLIPBOARD_COPIED, (_e, payload: { text: string; title: string; html?: string; links?: ClipboardLink[] }) => {
    if (!hooks.mine() || hooks.isIncognito()) return;
    try { hooks.onPageCopy(payload.text, wc.getURL(), payload.title, { html: payload.html ?? '', links: payload.links ?? [] }); }
    catch (e) { console.warn('[TabMgr] onPageCopyCb error:', (e as Error).message); }
  });
  wc.ipc.on(IPC.AUTOFILL_DISMISS, () => {
    if (!hooks.mine()) return;
    try { hooks.onAutofillDismiss(); }
    catch (e) { console.warn('[TabMgr] onAutofillDismissCb error:', (e as Error).message); }
  });

  // После переноса вкладки removeHandler ОБЯЗАТЕЛЕН: handle, в отличие от on, может быть один.
  wc.ipc.removeHandler(IPC.AUTOFILL_MAP_FIELDS);
  wc.ipc.handle(IPC.AUTOFILL_MAP_FIELDS, async (_e, payload: { fields?: unknown }) => {
    if (!hooks.mine()) return {};
    try {
      let origin = '';
      try { origin = new URL(wc.getURL()).origin; } catch { return {}; }
      if (!origin.startsWith('http')) return {};
      return await hooks.mapFields(origin, payload?.fields) ?? {};
    } catch (e) {
      console.warn('[TabMgr] autofill map error:', (e as Error).message);
      return {};
    }
  });
  wc.ipc.on(IPC.AUTOFILL_SUBMIT, (_e, payload: { kind: FieldKind; fields: Record<string, string> }) => {
    if (!hooks.mine()) return;
    try { hooks.onAutofillSubmit(payload.kind, payload.fields, wc.getURL()); }
    catch (e) { console.warn('[TabMgr] onAutofillSubmitCb error:', (e as Error).message); }
  });
}

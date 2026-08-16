// ── VPN, шаг 1 (подписка + список серверов, см. electron/VpnSubscription.ts) ──
// Редактированная версия VpnServer (electron/VpnParser.ts) для renderer — без credential
// (uuid/пароль). Показывать/копировать эти значения пользователю в UI незачем (не пароль
// сайта, который иногда нужно скопировать в другое место) — поэтому не «спрятано до reveal»,
// как у PasswordMeta, а не отдаётся вообще никогда.
export interface VpnServerMeta {
  id: string;
  protocol: 'vless' | 'trojan';
  remark: string;
  address: string;
  port: number;
  security: 'none' | 'tls' | 'reality';
  transport: 'tcp' | 'ws' | 'grpc' | 'xhttp';
}

export interface VpnStatus {
  hasSubscription: boolean;
  serverCount: number;
  fetchedAt: number | null;
}

export interface VpnSubscriptionResult {
  ok: boolean;
  error?: string;
  count?: number;
  skipped?: number;
}

// VPN, шаг 2 — состояние процесса Xray. serverId/remark — какой сервер сейчас активен (или
// последняя попытка) для подсветки в списке. error — только человекочитаемое сообщение,
// НЕ сырой лог Xray (тот может содержать SNI/адреса — см. VpnProcess.ts::getRecentLogs,
// отдельный канал не заведён в шаге 2, лог наружу пока вообще не уходит).
export interface VpnConnectionState {
  state: 'stopped' | 'starting' | 'running' | 'error';
  serverId: string | null;
  serverRemark: string | null;
  error?: string;
}

// ── Менеджер паролей, шаг 1 (сейф, см. electron/PasswordManager.ts) ───────────
// PasswordMeta — то, что уходит в renderer массово (список): без secret/notes. Сам пароль
// приходит только через revealPassword/copyPasswordField, по явному действию пользователя.
export interface PasswordMeta {
  id: number;
  origin: string;
  url: string;
  username: string;
  title: string;
  createdAt: number;
  updatedAt: number;
}

export interface PasswordAddInput {
  url: string;
  username: string;
  password: string;
  title: string;
  notes?: string;
}

// undefined-поля не меняются при update; password: undefined — оставить прежний секрет как есть.
export type PasswordUpdateInput = Partial<Omit<PasswordAddInput, 'password'>> & {
  id: number;
  password?: string;
};

export type PasswordCopyField = 'username' | 'password';

export interface PasswordGenerateOptions {
  length: number;
  lower: boolean;
  upper: boolean;
  digits: boolean;
  symbols: boolean;
}

// Менеджер паролей, шаг 2 — состояние индикатора-«ключа» в omnibox для АКТИВНОЙ вкладки.
// Пароль НИКОГДА не входит в этот тип — только origin/username/id, само значение секрета
// остаётся в main до explicit save/update/fill (см. electron/PasswordAutofillManager.ts).
export interface PasswordIndicatorMatch {
  id: number;
  username: string;
}
export type PasswordIndicatorState =
  | { kind: 'has-saved'; origin: string; matches: PasswordIndicatorMatch[] }
  | { kind: 'offer-save'; origin: string; username: string }
  | { kind: 'offer-update'; origin: string; username: string; matchId: number }
  // Клик по иконке в пустом поле пароля БЕЗ сохранённого логина для origin (похоже на форму
  // регистрации) — предложить сгенерировать пароль. Ничего не расшифровываем/не подставляем,
  // пока пользователь сам не нажмёт «Сгенерировать» в поповере.
  | { kind: 'offer-generate'; origin: string };

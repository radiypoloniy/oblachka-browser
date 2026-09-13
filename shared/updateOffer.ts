// Когда показывать карточку обновления и какую фазу рисовать.
//
// Чистая логика: main только подставляет статус и сохранённый skip, renderer ничего не решает.
// Без этого карточка легко начнёт спрашивать про уже пропущенную версию или прятаться во время
// качки, которую человек только что сам заказал.

export type UpdateOfferKind =
  | 'disabled'
  | 'idle'
  | 'checking'
  | 'not-available'
  | 'available'
  | 'downloading'
  | 'downloaded'
  | 'error';

export type UpdateOfferPhase = 'ask' | 'progress' | 'restart' | 'hide';

export function updateOfferPhase(kind: UpdateOfferKind): UpdateOfferPhase {
  if (kind === 'available') return 'ask';
  if (kind === 'downloading') return 'progress';
  if (kind === 'downloaded') return 'restart';
  return 'hide';
}

export function shouldShowUpdatePrompt(args: {
  kind: UpdateOfferKind;
  newVersion: string | null;
  skippedVersion: string | null;
  dismissedAsk: boolean;
  /** «Позже» на готовом файле: поставим при выходе, карточку больше не держим. */
  postponedInstall: boolean;
}): boolean {
  const phase = updateOfferPhase(args.kind);
  if (phase === 'hide') return false;
  // Качку не прячем: человек уже согласился, осталось довести.
  if (phase === 'progress') return true;
  if (phase === 'restart') return !args.postponedInstall;
  if (!args.newVersion) return false;
  if (args.dismissedAsk) return false;
  if (args.skippedVersion !== null && args.skippedVersion === args.newVersion) return false;
  return true;
}

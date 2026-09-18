// Куда класть вкладку, открытую «отдельно» из уже показанного split.
//
// ⚠️ Решение нарочно тупое и без Electron: TabManager только подставляет живые id. Иначе
// политику («папка соседней половины; только показанная пара; не попап») нельзя проверить
// голым node, и правка в одном из двух мест снова оставит «ссылка уехала в сайдбар».

export type SplitParkSide = 'left' | 'right';

export function splitOtherPaneId(leftId: string, rightId: string, openerId: string): string | null {
  if (openerId === leftId) return rightId;
  if (openerId === rightId) return leftId;
  return null;
}

export function splitParkSide(input: {
  shownLeftId: string | null;
  shownRightId: string | null;
  openerId: string;
  openedId: string;
  openedEphemeral: boolean;
  openedPinned: boolean;
  sameProfile: boolean;
  openedIsPanel?: boolean;
}): SplitParkSide | null {
  const { shownLeftId, shownRightId, openerId, openedId } = input;
  if (!shownLeftId || !shownRightId) return null;
  // Хаб не страница: в стопку половины его класть некуда, id у него фиксированный.
  if (!openedId || openedId === openerId || openedId === 'hub') return null;
  if (input.openedIsPanel) return null;
  if (!input.sameProfile || input.openedEphemeral || input.openedPinned) return null;
  // Уже на экране пары — класть некуда, третьей панели нет.
  if (openedId === shownLeftId || openedId === shownRightId) return null;
  // Соседняя половина: статья слева остаётся, ссылка уходит направо (или наоборот).
  if (openerId === shownLeftId) return 'right';
  if (openerId === shownRightId) return 'left';
  return null;
}

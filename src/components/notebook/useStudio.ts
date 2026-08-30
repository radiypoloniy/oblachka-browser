import { useEffect, useState } from 'react';
import type { StudioKind } from '../Notebook';

export interface StudioState {
  kind: StudioKind;
  label: string;
  busy: boolean;
  text?: string;
  error?: string;
}

/**
 * Генерация материала Студии: одно окно результата, один прогон за раз.
 *
 * ⚠️ Остановка здесь НЕ «спрятать окно». Прогон живёт в main и продолжается сам по себе, поэтому
 * и закрытие окна, и кнопка «Остановить» зовут cancelAiActivity — иначе модель считает документ,
 * который уже никто не увидит. Живой случай: человек закрывал Студию, генерация шла фоном, а
 * следующее открытие ставило в очередь ещё один прогон за старым, и так копилось.
 */
export function useStudio(labelOf: (k: StudioKind) => string) {
  const [note, setNote] = useState<string | null>(null);
  const [state, setState] = useState<StudioState | null>(null);
  // Знаков сгенерировано — приходит из main по ходу прогона (NOTEBOOK_STUDIO_PROGRESS).
  const [chars, setChars] = useState(0);

  useEffect(() => window.oblako.onStudioProgress(setChars), []);

  async function generate(
    kind: StudioKind,
    context: string | null,
    // ⚠️ Список источников уходит в main ГОТОВЫМ, а не восстанавливается моделью из текста:
    // подвал документа — единственное место, где выдумка выглядит как факт (см.
    // electron/NotebookPage.ts).
    sources: { title: string; url: string }[] = [],
  ): Promise<void> {
    const label = labelOf(kind);
    if (!context) { setNote('Выберите источники с текстом — по ним построю материал.'); return; }
    setNote(null);
    setChars(0);
    // Прежнюю работу снимает main (beginActivity прерывает предыдущую), поэтому здесь ничего
    // ждать не нужно: очередь не копится по построению.
    setState({ kind, label, busy: true });
    const r = await window.oblako.generateStudio(kind, context, sources);
    setState({
      kind, label, busy: false,
      text: r.ok ? r.text : undefined,
      error: r.ok ? undefined : (r.error || 'Не удалось сгенерировать'),
    });
  }

  const stop = () => { void window.oblako.cancelAiActivity(); };
  const close = () => { if (state?.busy) stop(); setState(null); };

  return { note, state, chars, generate, stop, close, busyKind: state?.busy ? state.kind : null };
}

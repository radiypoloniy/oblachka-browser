import { BrowserWindow } from 'electron';
import { IPC } from '../shared/ipc';
import type { AiActivityState } from '../shared/ipc';

// Что ИИ делает прямо сейчас — одно место на всё приложение.
//
// ⚠️ Заведено по живой жалобе: человек закрыл окно Студии, а модель продолжала считать документ
// в фоне; следующее открытие ставило в очередь ЕЩЁ один прогон за старым, и так копилось.
// Снаружи это выглядело как «браузер жрёт процессор сам по себе», и остановить было нечем.
//
// ⚠️ Реестр ОДИН на приложение, а не по одному на фичу, и это не обобщение впрок: у node-llama-cpp
// один контекст на процесс, очередь к нему тоже одна (withQwenQueue), то есть «что сейчас делает
// ИИ» — физически единственное состояние. Два реестра означали бы два ответа на один вопрос.
//
// ⚠️ Долгую работу ОБЯЗАНО быть видно и вне того окна, где её заказали: индикатор в AI-панели
// (зелёный светодиод + текст + «Стоп») — не украшение, а единственный способ узнать, что модель
// занята, если экран Студии уже закрыт.

interface Run {
  id: number;
  label: string;
  startedAt: number;
  chars: number;
  ctrl: AbortController;
}

let current: Run | null = null;
let nextId = 1;

export interface ActivityHandle {
  /** Сигнал для runTabOrganizePrompt: доезжает до llama.cpp и рвёт генерацию по-настоящему. */
  readonly signal: AbortSignal;
  /** Прервали ли эту работу. */
  readonly cancelled: boolean;
  progress(chars: number): void;
  /**
   * Сменить подпись по ходу работы: «Пишу раздел 3 из 6».
   *
   * ⚠️ Нужна потому, что страница собирается в несколько прогонов (см. NotebookPage.ts), и
   * растущее число знаков про это ничего не говорит. «Пишу статью» после «Выписываю числа» —
   * единственное, по чему человек может понять, на каком шаге он ждёт.
   */
  note(label: string): void;
  done(): void;
}

/**
 * Заявить новую работу ИИ.
 *
 * ⚠️ Новая работа ПРЕРЫВАЕТ предыдущую, а не встаёт за ней. Очередь всё равно исполняет их по
 * одной, но старая при этом продолжает жечь процессор ради результата, который человеку уже не
 * нужен: он нажал другую кнопку, а значит передумал. Именно так и накапливались прогоны.
 */
export function beginActivity(label: string): ActivityHandle {
  cancelActivity();
  const run: Run = { id: nextId++, label, startedAt: Date.now(), chars: 0, ctrl: new AbortController() };
  current = run;
  broadcast();
  return {
    get signal() { return run.ctrl.signal; },
    get cancelled() { return run.ctrl.signal.aborted; },
    progress(chars: number) {
      if (current !== run) return;   // нас уже сменили — молчим, чтобы не мигать чужим числом
      run.chars = chars;
      broadcast();
    },
    note(label: string) {
      if (current !== run) return;
      run.label = label;
      broadcast();
    },
    done() {
      if (current !== run) return;
      current = null;
      broadcast();
    },
  };
}

/** Прервать текущую работу. false — прерывать было нечего. */
export function cancelActivity(): boolean {
  if (!current) return false;
  current.ctrl.abort();
  current = null;
  broadcast();
  return true;
}

export function getActivity(): AiActivityState | null {
  if (!current) return null;
  return { label: current.label, startedAt: current.startedAt, chars: current.chars };
}

// Рассылка всем окнам: панель живёт в своём webContents, блокнот — в другом, и оба показывают
// одно и то же состояние.
function broadcast(): void {
  const state = getActivity();
  for (const w of BrowserWindow.getAllWindows()) {
    if (w.isDestroyed()) continue;
    for (const wc of [w.webContents, ...w.contentView.children.flatMap(viewContents)]) {
      if (!wc.isDestroyed()) wc.send(IPC.AI_ACTIVITY_CHANGED, state);
    }
  }
}

// Дочерние вью окна (AI-панель — отдельный WebContentsView). Рекурсии не нужно: панель лежит
// прямым ребёнком, как и вкладки.
function viewContents(v: Electron.View): Electron.WebContents[] {
  const wc = (v as { webContents?: Electron.WebContents }).webContents;
  return wc ? [wc] : [];
}

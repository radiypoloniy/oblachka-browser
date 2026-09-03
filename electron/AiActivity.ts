import { BrowserWindow } from 'electron';
import { IPC } from '../shared/ipc';
import type { AiActivityState } from '../shared/ipc';
import { isLocalRoute, type AiRole } from './ai/registry';

// Что ИИ делает прямо сейчас — одно место на всё приложение.
//
// ⚠️ Заведено по живой жалобе: человек закрыл окно Студии, а модель продолжала считать документ
// в фоне; следующее открытие ставило в очередь ЕЩЁ один прогон за старым, и так копилось.
// Снаружи это выглядело как «браузер жрёт процессор сам по себе», и остановить было нечем.
//
// ⚠️ РАБОТ ТЕПЕРЬ НЕСКОЛЬКО, и это не обобщение впрок, а починка. Прежде реестр держал ровно одну,
// и `beginActivity` начинал с того, что ОБРЫВАЛ предыдущую. С единственной локальной моделью это
// было честно: у node-llama-cpp один контекст на процесс, очередь одна, второй работе всё равно
// негде было идти. С подключением облака это перестало быть правдой — туда можно слать параллельно,
// — и вопрос в чате блокнота молча убивал генерацию страницы, начатую минуту назад. Реестр из
// одного слота стал в этот момент не упрощением, а потерей чужой работы.
//
// ⚠️ Реестр всё равно ОДИН на приложение: «что сейчас делает ИИ» — по-прежнему один вопрос, просто
// ответом на него стал список, а не единственная строка. Два реестра означали бы два ответа.
//
// ⚠️ Долгую работу ОБЯЗАНО быть видно и вне того окна, где её заказали: индикатор в AI-панели
// (светодиод + текст + «Стоп») — не украшение, а единственный способ узнать, что модель занята,
// если экран Студии уже закрыт.

interface Run {
  id: number;
  label: string;
  startedAt: number;
  chars: number;
  /** Считается на этой машине. ⚠️ Снимается ОДИН РАЗ на старте: маршрут роли может смениться
   *  посреди работы, но эта работа всё равно доедет там, где началась. */
  local: boolean;
  ctrl: AbortController;
}

const runs = new Map<number, Run>();
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
   * единственный способ показать, что дело двигается, а не встало.
   */
  note(label: string): void;
  done(): void;
}

/**
 * Заявить работу.
 *
 * ⚠️ Роль обязательна: по ней снимается, где эта работа считается. Светодиод в панели красится
 * зелёным «на этой машине» или бирюзовым «облако» — тем же языком, что метка модели в чатах, и
 * соврать здесь нельзя: цвет означает «текст никуда не улетает».
 */
export function beginActivity(label: string, role: AiRole): ActivityHandle {
  const run: Run = {
    id: nextId++, label, startedAt: Date.now(), chars: 0,
    local: isLocalRoute(role), ctrl: new AbortController(),
  };
  runs.set(run.id, run);
  broadcast();
  return {
    get signal() { return run.ctrl.signal; },
    get cancelled() { return run.ctrl.signal.aborted; },
    progress(chars: number) {
      if (!runs.has(run.id)) return;   // нас уже прервали — молчим, чтобы не мигать числом
      run.chars = chars;
      broadcast();
    },
    note(label: string) {
      if (!runs.has(run.id)) return;
      run.label = label;
      broadcast();
    },
    done() {
      if (!runs.delete(run.id)) return;
      broadcast();
    },
  };
}

/**
 * Прервать работу: одну по номеру или все сразу.
 *
 * ⚠️ Без номера — ВСЕ, и кнопка в панели так и подписана, когда работ больше одной. Прерывать
 * «какую-нибудь» было бы хуже, чем прервать всё: человек нажал «Стоп», потому что хочет тишины.
 */
export function cancelActivity(id?: number): boolean {
  const targets = id === undefined ? [...runs.values()] : [runs.get(id)].filter((r): r is Run => r !== undefined);
  if (targets.length === 0) return false;
  for (const run of targets) {
    run.ctrl.abort();
    runs.delete(run.id);
  }
  broadcast();
  return true;
}

/**
 * Что показать в индикаторе.
 *
 * ⚠️ Показываем САМУЮ СВЕЖУЮ работу, а остальные — числом. У неё живее движется счётчик знаков, и
 * это та, которую человек только что заказал и на которую смотрит. Забытая фоновая при этом не
 * пропадает: «и ещё 1» — тот самый признак, ради которого индикатор и заведён.
 */
export function getActivity(): AiActivityState | null {
  if (runs.size === 0) return null;
  const list = [...runs.values()];
  const shown = list[list.length - 1];
  return {
    label: shown.label, startedAt: shown.startedAt, chars: shown.chars,
    local: shown.local, count: list.length,
  };
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

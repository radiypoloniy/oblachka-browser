// Сторож простоя локальной модели: раз в минуту спрашивает политику, пора ли выгружать.
//
// ⚠️ Уровень ПРИЛОЖЕНИЯ, а не окна. Модель одна на процесс, а TabManager принадлежит окну: живи
// этот таймер там, два окна дважды считали бы один и тот же простой и дважды звали бы выгрузку.
//
// ⚠️ Решение целиком лежит в shared/modelIdle.ts, здесь только сбор фактов. Так политика попадает
// под npm test и мутационный прогон, а этот файл остаётся тем, что проверками не покрывается в
// принципе — проводкой к живым менеджерам.
import { MODEL_CHECK_INTERVAL, TIGHT_STREAK, isHardwareTight, shouldUnloadModel } from '../shared/modelIdle';
import type { HardwareState, VramState } from '../shared/modelIdle';
import { getLoadedModelIdMirror, getVramFreeAtLoad, getVram } from './inference/InferenceHost';
import { isModelWarm, unloadModel } from './TranslationService';
import { isQwenBusy, lastQwenUserRequestAt } from './QwenQueue';
import { isAiPanelOpen } from './AiPanelManager';

let timer: NodeJS.Timeout | null = null;

// Сколько проверок подряд железу было тесно. Считается здесь, а не в политике: политика — чистая
// функция и памяти между вызовами не имеет.
let tightStreak = 0;

// Идёт ли уже проверка. ⚠️ Замер видеопамяти асинхронный (запрос в процесс инференса), и без
// этого флага долгий ответ дал бы два наложившихся тика с двумя вызовами выгрузки.
let checking = false;

/** Состояние видеопамяти либо null, если модель считается лежащей в обычной памяти. */
async function readVram(): Promise<VramState | null> {
  let info;
  try {
    info = await getVram();
  } catch {
    return null; // процесс инференса не ответил — про карту ничего не знаем, и это не повод дёргаться
  }
  // gpu приходит строкой от node-llama-cpp: 'cuda' | 'vulkan' | 'metal' | 'false'.
  if (info.gpu === 'false' || info.total <= 0) return null;
  // ⚠️ Точка отсчёта приходит из ЗАМЕРА В ВОРКЕРЕ, сделанного сразу после загрузки, и НЕ снимается
  // здесь. Сторож просыпается раз в минуту, и его собственный снимок «как было до чужих» опаздывал
  // ровно на то время, за которое игра успевает запуститься, — из-за чего давление не срабатывало
  // вовсе, а модель висела все сорок минут.
  const freeAtLoad = getVramFreeAtLoad();
  if (freeAtLoad === null) return null; // замер не удался — про чужой приход судить не по чему
  return { total: info.total, free: info.free, freeAtLoad };
}

async function tick(): Promise<void> {
  if (checking) return;
  checking = true;
  try {
    const modelId = getLoadedModelIdMirror();
    if (modelId === null) {
      // Модели в памяти нет — считать тесноту незачем. ⚠️ И, главное, нельзя спрашивать
      // видеопамять: getVram() поднимает процесс инференса, если тот не запущен, то есть сторож
      // простоя сам бы его и запускал.
      tightStreak = 0;
      return;
    }

    const hw: HardwareState = { vram: await readVram() };
    tightStreak = isHardwareTight(hw) ? Math.min(tightStreak + 1, TIGHT_STREAK) : 0;

    const reason = shouldUnloadModel({
      // ⚠️ loaded/loading — два разных состояния из двух источников: зеркало в InferenceHost знает
      // про РЕАЛЬНО загруженную модель, а isModelWarm() истинен уже во время загрузки. Без этой
      // пары «модель грузится» читалось бы как «модель лежит и простаивает».
      loaded: true,
      loading: isModelWarm() && getLoadedModelIdMirror() === null,
      busy: isQwenBusy(),
      panelOpen: isAiPanelOpen(),
      lastUserRequestAt: lastQwenUserRequestAt(),
      tightStreak,
    }, Date.now());
    if (!reason) return;

    console.log(`[model] выгружаем модель: ${reason === 'idle' ? 'простой' : 'железу тесно'}`);
    tightStreak = 0;
    // ⚠️ Выгрузка сама встаёт в очередь к модели (withQwenQueue), поэтому идущую генерацию она не
    // режет, а дожидается. Отказ глушим: не смогли выгрузить — попробуем через минуту.
    await unloadModel().catch((e: unknown) => console.log(`[model] выгрузка не удалась: ${String(e)}`));
  } finally {
    checking = false;
  }
}

/** Запустить сторож. Зовётся один раз из main.ts после app.whenReady(). */
export function startModelIdleWatcher(): void {
  if (timer) return;
  // unref — сторож не должен держать процесс живым сам по себе.
  timer = setInterval(() => { void tick(); }, MODEL_CHECK_INTERVAL);
  timer.unref();
}

export function stopModelIdleWatcher(): void {
  if (!timer) return;
  clearInterval(timer);
  timer = null;
}

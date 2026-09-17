import os from 'os';
import type { WebContents, WebFrameMain } from 'electron';
import { hostOfUrl } from '../shared/rules';
import {
  memoryBudgetBytes, systemFreeShare, isUnderMemoryPressure, isIdleForTimer,
  pressureCandidates, SLEEP_CHECK_INTERVAL, PRESSURE_SLEEP_PER_CHECK, MEDIA_GRACE,
} from '../shared/sleepPolicy';

// Проверяем и беззвучное видео, включая iframe. PiP/fullscreen тоже защищают от выгрузки.
const MEDIA_PLAYING_SCRIPT = `(function(){
  if (document.pictureInPictureElement || document.fullscreenElement) return true;
  var els = document.querySelectorAll('video,audio');
  for (var i = 0; i < els.length; i++) {
    var m = els[i];
    if (!m.paused && !m.ended && m.readyState >= 2) return true;
  }
  return false;
})()`;
// Ограничиваем опрос: у страницы могут быть десятки iframe, а выгрузка должна экономить ресурсы.
const MEDIA_PROBE_MAX_FRAMES = 12;

// v1: заполненные поля только top-frame; редактируемую форму не выгружаем.
const HAS_FILLED_FORMS_SCRIPT = `(function(){
  var sel='input:not([type=checkbox]):not([type=radio]):not([type=hidden])' +
    ':not([type=submit]):not([type=button]):not([type=reset]):not([type=file]),' +
    'textarea,[contenteditable="true"]';
  var els=document.querySelectorAll(sel);
  for(var i=0;i<els.length;i++){
    var v=els[i].value||els[i].textContent||'';
    if(v.trim().length>0)return true;
  }
  return false;
})()`;

export interface SleepTab {
  id: string;
  view: { webContents: WebContents } | null;
  sleeping: unknown;
  incognito?: boolean;
  lastActiveAt: number;
  lastMediaAt?: number;
}

export interface SleepHost {
  tabs(): Iterable<SleepTab>;
  tab(id: string): SleepTab | undefined;
  activeId(): string;
  activePair(): { leftId: string; rightId: string } | undefined;
  isPinned(id: string): boolean;
  isNeverSleepHost(host: string): boolean;
  tabUrl(tab: SleepTab): string;
  appWorkingSetBytes(): number;
  sleepTab(id: string): void;
}

async function isPlayingMedia(wc: WebContents): Promise<boolean> {
  if (wc.isCurrentlyAudible()) return true;
  let frames: WebFrameMain[];
  try {
    // Главный кадр первым; у большинства страниц до iframe дело не доходит.
    frames = [wc.mainFrame, ...wc.mainFrame.framesInSubtree.filter((f) => f !== wc.mainFrame)];
  } catch { return false; }
  for (const frame of frames.slice(0, MEDIA_PROBE_MAX_FRAMES)) {
    try {
      if (await frame.executeJavaScript(MEDIA_PLAYING_SCRIPT, true)) return true;
    } catch { /* кадр умер или кросс-доменный сбой */ }
  }
  return false;
}

// Одна и та же защита для таймера и давления памяти. После каждого await состояние вкладки
// перепроверяем: за время JS-опроса она могла стать активной или войти в показываемую split-пару.
export async function canSleepNow(tab: SleepTab, protectedIds: Set<string>, host: SleepHost): Promise<boolean> {
  if (tab.sleeping || protectedIds.has(tab.id) || tab.incognito || !tab.view) return false;
  const urlHost = hostOfUrl(host.tabUrl(tab));
  if (urlHost && host.isNeverSleepHost(urlHost)) return false;
  const wc = tab.view.webContents;

  if (tab.lastMediaAt && Date.now() - tab.lastMediaAt < MEDIA_GRACE) return false;
  if (await isPlayingMedia(wc)) {
    tab.lastMediaAt = Date.now();
    return false;
  }
  if (protectedIds.has(tab.id) || tab.sleeping || !tab.view) return false;

  let hasForms = false;
  try { hasForms = await wc.executeJavaScript(HAS_FILLED_FORMS_SCRIPT, true); }
  catch { return false; }
  if (hasForms) return false;

  if (protectedIds.has(tab.id) || tab.sleeping || !tab.view) return false;
  if (tab.id === host.activeId()) return false;
  const pair = host.activePair();
  if (pair && (tab.id === pair.leftId || tab.id === pair.rightId)) return false;
  return true;
}

export function startTabSleepTimer(host: SleepHost): NodeJS.Timeout {
  return setInterval(async () => {
    const now = Date.now();
    const activePair = host.activePair();
    const protectedIds = new Set<string>([host.activeId()]);
    if (activePair) {
      protectedIds.add(activePair.leftId);
      protectedIds.add(activePair.rightId);
    }

    // Сначала часы; только потом давление памяти, чтобы не выгружать лишнее за один проход.
    for (const tab of host.tabs()) {
      if (!isIdleForTimer(now - tab.lastActiveAt, host.isPinned(tab.id))) continue;
      if (await canSleepNow(tab, protectedIds, host)) host.sleepTab(tab.id);
    }

    const budget = memoryBudgetBytes(os.totalmem());
    if (!isUnderMemoryPressure(host.appWorkingSetBytes(), budget, systemFreeShare(os.freemem(), os.totalmem()))) return;
    const order = pressureCandidates(
      [...host.tabs()].map((tab) => ({ id: tab.id, lastActiveAt: tab.lastActiveAt, pinned: host.isPinned(tab.id) })),
      now,
    );
    let slept = 0;
    for (const { id } of order) {
      if (slept >= PRESSURE_SLEEP_PER_CHECK) break;
      if (host.appWorkingSetBytes() <= budget) break;
      const tab = host.tab(id);
      if (tab && await canSleepNow(tab, protectedIds, host)) {
        console.log(`[память] бюджет ${Math.round(budget / 1048576)} МБ превышен — усыпляю вкладку`);
        host.sleepTab(id);
        slept += 1;
      }
    }
  }, SLEEP_CHECK_INTERVAL);
}

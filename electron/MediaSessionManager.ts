// Что играет в браузере прямо сейчас — и как этим управлять с рабочего стола.
//
// ⚠️ ИСТОЧНИК ПРАВДЫ — САМА СТРАНИЦА, а не наши догадки. Каждый нормальный музыкальный сервис
// объявляет трек через `navigator.mediaSession`: название, исполнителя, обложку и обработчики
// «играть / пауза / вперёд / назад». Ровно этим живут медиаклавиши на клавиатуре и панель
// глобальных медиа в Chrome. Мы подключаемся к тому же источнику (см. хук в preload-content.ts),
// поэтому виджет работает С ЛЮБЫМ сервисом — Яндекс Музыка, Spotify, YouTube, VK, — а не с тремя,
// под которые кто-то написал парсер вёрстки. Парсеры вёрстки ломаются в день редизайна; медиасессия
// стандартна и держится годами.
//
// ⚠️ Состояние ОДНО НА ПРИЛОЖЕНИЕ, а не по окну. Музыка в браузере одна: играет она во вкладке
// второго окна, а виджет стоит на столе первого — и это нормальная ситуация, ради которой всё и
// делается. Поэтому активный источник выбирается глобально, а рассылка идёт во все окна.
import { ipcMain } from 'electron';
import type { BrowserWindow } from 'electron';
import { IPC } from '../shared/ipc';
import type { MediaNowPlaying, MediaSessionReport, MediaCommand } from '../shared/ipc';
import { contextForWindow } from './WindowRegistry';

interface Entry extends MediaNowPlaying {
  /** Когда пришло последнее сообщение — по нему выбираем источник, если играют двое. */
  at: number;
}

const byTab = new Map<string, Entry>();
let activeTabId: string | null = null;
let broadcast: (state: MediaNowPlaying | null) => void = () => {};
// Окно, чья вкладка играет: команды уходят её менеджеру вкладок, а не «активному» окну.
const winByTab = new Map<string, BrowserWindow>();

export function initMediaSession(push: (state: MediaNowPlaying | null) => void): void {
  broadcast = push;
  ipcMain.handle(IPC.MEDIA_COMMAND, (_e, action: MediaCommand) => sendCommand(action));
  ipcMain.handle(IPC.MEDIA_STATE, () => current());
}

/** Страница сообщила о своей медиасессии. url — из wc.getURL(), не из payload. */
export function handleMediaReport(win: BrowserWindow, tabId: string, report: MediaSessionReport, url: string): void {
  const title = (report.title ?? '').trim();
  const playing = report.playbackState === 'playing';

  // Пустой заголовок и молчание — это «здесь музыки нет»: убираем запись, чтобы вкладка с
  // отыгравшим роликом не притворялась источником вечно.
  if (!title && !playing) {
    byTab.delete(tabId);
    winByTab.delete(tabId);
    if (activeTabId === tabId) activeTabId = null;
    pick();
    return;
  }

  winByTab.set(tabId, win);
  byTab.set(tabId, {
    tabId,
    title,
    artist: (report.artist ?? '').trim(),
    album: (report.album ?? '').trim(),
    artwork: report.artwork ?? '',
    playbackState: report.playbackState ?? 'none',
    actions: Array.isArray(report.actions) ? report.actions : [],
    host: hostOf(url),
    at: Date.now(),
  });
  pick();
}

/** Вкладку закрыли или усыпили — источник исчез вместе с ней. */
export function forgetMediaTab(tabId: string): void {
  if (!byTab.has(tabId)) return;
  byTab.delete(tabId);
  winByTab.delete(tabId);
  if (activeTabId === tabId) activeTabId = null;
  pick();
}

export function current(): MediaNowPlaying | null {
  const e = activeTabId ? byTab.get(activeTabId) : null;
  if (!e) return null;
  const { at: _at, ...state } = e;
  return state;
}

/**
 * Выбор активного источника.
 *
 * ⚠️ Играющий побеждает ВСЕГДА, и только между равными решает свежесть. Иначе открытая мимоходом
 * вкладка с роликом на паузе перехватывала бы виджет у музыки, которая реально играет в фоне, —
 * то есть кнопка «пауза» останавливала бы не то, что человек слышит.
 */
function pick(): void {
  let best: Entry | null = null;
  for (const e of byTab.values()) {
    if (!best) { best = e; continue; }
    const bp = best.playbackState === 'playing';
    const ep = e.playbackState === 'playing';
    if (ep !== bp) { if (ep) best = e; continue; }
    if (e.at > best.at) best = e;
  }
  const nextId = best?.tabId ?? null;
  const changed = nextId !== activeTabId || JSON.stringify(current()) !== JSON.stringify(lastSent);
  activeTabId = nextId;
  if (!changed) return;
  lastSent = current();
  broadcast(lastSent);
}

let lastSent: MediaNowPlaying | null = null;

function sendCommand(action: MediaCommand): boolean {
  if (!activeTabId) return false;
  const win = winByTab.get(activeTabId);
  const tabs = win && !win.isDestroyed() ? contextForWindow(win)?.tabs : null;
  if (!tabs) return false;
  return tabs.sendMediaCommand(activeTabId, action);
}

function hostOf(url: string): string {
  try { return new URL(url).hostname.replace(/^www\./, ''); } catch { return ''; }
}

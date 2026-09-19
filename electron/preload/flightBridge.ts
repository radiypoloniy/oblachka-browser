// Мост renderer ↔ main для часов на билеты Aviasales и токена Travelpayouts.
//
// Вынесено из preload.ts: дверь между интерфейсом и main уже на своей записи в базе, а токен
// Travelpayouts через IPC не возвращается — только факт «настроено/нет», как ключ Gemini.
import { ipcRenderer } from 'electron';
import { IPC } from '../../shared/ipc';
import type { TrackedFlight } from '../../shared/ipc';

export const flightBridge = {
  listFlightWatches: () => ipcRenderer.invoke(IPC.TRACKING_FLIGHTS) as Promise<TrackedFlight[]>,
  untrackFlight: (id: number) => ipcRenderer.invoke(IPC.TRACKING_FLIGHT_UNTRACK, id) as Promise<void>,
  getTravelpayoutsStatus: () => ipcRenderer.invoke(IPC.TRAVELPAYOUTS_GET_STATUS) as Promise<boolean>,
  saveTravelpayoutsToken: (token: string) =>
    ipcRenderer.invoke(IPC.TRAVELPAYOUTS_SAVE_TOKEN, token) as Promise<boolean>,
  deleteTravelpayoutsToken: () => ipcRenderer.invoke(IPC.TRAVELPAYOUTS_DELETE_TOKEN) as Promise<void>,
  onTravelpayoutsStatusChanged: (cb: (configured: boolean) => void) => {
    const handler = (_e: unknown, configured: boolean) => cb(configured);
    ipcRenderer.on(IPC.TRAVELPAYOUTS_STATUS_CHANGED, handler);
    return () => ipcRenderer.removeListener(IPC.TRAVELPAYOUTS_STATUS_CHANGED, handler);
  },
};

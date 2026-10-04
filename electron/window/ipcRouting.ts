import type { WebContents } from 'electron';
import { contextFromSender } from '../WindowRegistry';

type SenderEvent = { sender: WebContents };

// Неизвестная или уже закрытая вью не должна менять вкладки другого окна.
export const tabsOf = (event: SenderEvent) => contextFromSender(event.sender)?.tabs ?? null;
export const winOf = (event: SenderEvent) => contextFromSender(event.sender)?.win ?? null;
export const chromeOf = (event: SenderEvent) => contextFromSender(event.sender)?.chromeView.webContents ?? null;

// Асинхронный ответ остаётся адресным: закрытие владельца не перенаправляет его соседу.
export function sendTo(contents: WebContents | null, channel: string, ...args: unknown[]): void {
  if (contents && !contents.isDestroyed()) contents.send(channel, ...args);
}

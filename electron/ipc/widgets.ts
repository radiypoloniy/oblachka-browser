// Пароли (чтение), фавиконки, виджеты новой вкладки, блокнот
//
// Часть контракта IPC, вынесенная из main.ts (см. electron/ipc/deps.ts — почему нарезано
// непрерывными кусками, а не по доменам). Тела обработчиков перенесены дословно.
import { IPC } from '../../shared/ipc';
import type { PasswordCopyField } from '../../shared/ipc';
import { getCryptoRates } from '../CryptoRates';
import { getCurrencyRates } from '../CurrencyRates';
import { faviconService } from '../FaviconService';
import { getNextHoliday } from '../HolidaysService';
import { getPhotoOfDay, shufflePhoto } from '../NewTabPhoto';
import { extractUrlText } from '../NotebookExtract';
import { generateStudio } from '../NotebookStudio';
import type { StudioKind } from '../NotebookStudio';
import { getWeather } from '../WeatherService';
import { ipcMain } from 'electron';
import type { IpcDeps } from './deps';

export function registerWidgetsIpc(d: IpcDeps): void {
  const { ensurePasswordAuth, passwords, settings, winOf } = d;

  // через reveal/generate — list его не отдаёт, copy сам кладёт в буфер и наружу не возвращает.
  ipcMain.handle(IPC.PASSWORDS_LIST,     () => passwords.list());
  // Показ/копирование пароля гейтится подтверждением Windows (osAuth), если включено в настройках.
  // Успешная проверка держится PASSWORD_AUTH_GRACE_MS, чтобы не спрашивать на каждый клик подряд.
  // 'unavailable' (механизм не сработал) трактуем как разрешение — не лочим доступ к своим паролям.
  ipcMain.handle(IPC.PASSWORDS_REVEAL,   async (_e, id: number) =>
    (await ensurePasswordAuth('Показать сохранённый пароль')) ? passwords.reveal(id) : null);
  ipcMain.handle(IPC.PASSWORDS_COPY,     async (_e, id: number, field: PasswordCopyField) => {
    // Логин копировать можно без подтверждения — под гейтом только сам пароль.
    if (field === 'password' && !(await ensurePasswordAuth('Скопировать сохранённый пароль'))) return false;
    return passwords.copyField(id, field);
  });
  ipcMain.handle(IPC.PASSWORDS_AUTH_GET, () => settings.getPasswordAuthEnabled());
  ipcMain.handle(IPC.PASSWORDS_AUTH_SET, (_e, enabled: boolean) => {
    settings.setPasswordAuthEnabled(enabled);
    return settings.getPasswordAuthEnabled();
  });
  ipcMain.handle(IPC.FAVICON_GET,        (_e, host: string) => faviconService.get(host));
  // Погода для виджета новой вкладки (тот же WeatherService, что у AI-панели; отдельный typed-канал
  // для главного рендерера — preload-aipanel до него не относится).
  ipcMain.handle(IPC.WEATHER_GET,        (_e, city: string) => getWeather(typeof city === 'string' ? city : ''));
  ipcMain.handle(IPC.NEWTAB_PHOTO_GET,   () => getPhotoOfDay());
  ipcMain.handle(IPC.NEWTAB_PHOTO_SHUFFLE, () => { shufflePhoto(); return getPhotoOfDay(); });
  // Курсы для виджета новой вкладки. Отдельный канал от 'ai-panel:currency-rates' (там своя
  // труба к панели), но за ними ОДИН модуль с общим часовым кэшем — второго сетевого похода
  // открытая панель и открытая вкладка не устроят.
  ipcMain.handle(IPC.CURRENCY_GET,        () => getCurrencyRates());
  ipcMain.handle(IPC.HOLIDAY_GET,         (_e, country?: string) => getNextHoliday(country ?? 'RU'));
  ipcMain.handle(IPC.CRYPTO_GET,          () => getCryptoRates());
  ipcMain.handle(IPC.NOTEBOOK_EXTRACT_URL, (e, url: string) => {
    // Локальная переменная, а не два вызова подряд: при повторном вызове TypeScript теряет
    // проверку на null, и это уже не тот же самый объект по смыслу.
    const w = winOf(e);
    return w ? extractUrlText(w, typeof url === 'string' ? url : '') : { ok: false };
  });
  ipcMain.handle(IPC.NOTEBOOK_STUDIO_GEN, (_e, kind: StudioKind, context: string) =>
    generateStudio(kind, typeof context === 'string' ? context : ''));

}

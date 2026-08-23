// Пароли (чтение), фавиконки, виджеты новой вкладки, блокнот
//
// Часть контракта IPC, вынесенная из main.ts (см. electron/ipc/deps.ts — почему нарезано
// непрерывными кусками, а не по доменам). Тела обработчиков перенесены дословно.
import { IPC } from '../../shared/ipc';
import type { TimerState } from '../../shared/ipc';
import { getTimer, setTimer } from '../TimerService';
import type { PasswordCopyField } from '../../shared/ipc';
import { getCryptoRates } from '../CryptoRates';
import { getCurrencyRates } from '../CurrencyRates';
import { faviconService } from '../FaviconService';
import { getNextHoliday } from '../HolidaysService';
import { getPhotoOfDay, shufflePhoto } from '../NewTabPhoto';
import { extractUrlText } from '../NotebookExtract';
import { generateStudio } from '../NotebookStudio';
import type { StudioKind } from '../NotebookStudio';
import { parsePhraseToGenSpec } from '../GenSpecParser';
import { fetchGenWeb } from '../GenWebSource';
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
  // Таймер стола. ⚠️ Состояние держит main (TimerService), потому что виджет живёт только на
  // новой вкладке: досчитывать после ухода с неё было бы некому.
  ipcMain.handle(IPC.TIMER_GET, () => getTimer());
  ipcMain.handle(IPC.TIMER_SET, (_e, next: Partial<TimerState>) => setTimer(next ?? {}));
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
  let genParseBusy = false;
  ipcMain.handle(IPC.DESKTOP_GEN_WEB, (_e, url: string, force: boolean) =>
    fetchGenWeb(String(url ?? ''), !!force));
  ipcMain.handle(IPC.DESKTOP_GEN_SPEC, async (e, phrase: string, url: string) => {
    if (genParseBusy) return { ok: false, reason: 'model-error', error: 'Уже собираю другой виджет' };
    genParseBusy = true;
    // ⚠️ Отвечаем ТОМУ, кто спросил, а не всем окнам: сборка идёт на одном столе, и чужая
    // анимация в соседнем окне — это неверная картина, а не приятная мелочь.
    const sender = e.sender;
    try {
      return await parsePhraseToGenSpec(String(phrase ?? ''), (p) => {
        if (!sender.isDestroyed()) sender.send(IPC.DESKTOP_GEN_PROGRESS, p);
      }, String(url ?? ''));
    } catch (err) {
      console.warn('[gen-widget] разбор упал:', err);
      return { ok: false, reason: 'model-error' };
    } finally {
      genParseBusy = false;
    }
  });

}

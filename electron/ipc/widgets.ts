// Пароли (чтение), фавиконки, виджеты новой вкладки, блокнот
//
// Часть контракта IPC, вынесенная из main.ts (см. electron/ipc/deps.ts — почему нарезано
// непрерывными кусками, а не по доменам). Тела обработчиков перенесены дословно.
import { app, dialog, shell } from 'electron';
import fsp from 'node:fs/promises';
import nodePath from 'node:path';
import { pathToFileURL } from 'node:url';
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
import { extractFileText, SUPPORTED_FILE_EXTENSIONS } from '../FileExtract';
import { generateStudio } from '../NotebookStudio';
import { cancelActivity, getActivity } from '../AiActivity';
import { suggestQueries, runSearch } from '../NotebookGather';
import type { StudioKind } from '../NotebookStudio';
import { parsePhraseToGenSpec } from '../GenSpecParser';
import { fetchGenWeb } from '../GenWebSource';
import { getWeather } from '../WeatherService';
import { ipcMain } from 'electron';
import type { IpcDeps } from './deps';

export function registerWidgetsIpc(d: IpcDeps): void {
  const { ensurePasswordAuth, passwords, settings, winOf, tabsOf } = d;

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
  // ⚠️ Прогресс шлётся ОТДЕЛЬНЫМ каналом поверх invoke, а не вместо него: ответ по-прежнему
  // один и финальный, меняется только то, что человек видит во время ожидания. Тот же приём,
  // что у DESKTOP_GEN_PROGRESS ниже.
  // ⚠️ Локальный документ — ТАКОЙ ЖЕ источник, как ссылка, и машинерия под него уже была:
  // extractFileText читает pdf/docx/txt/md/csv/json/log и служит узлу графа и умному
  // переименованию загрузок. Блокнот мимо неё просто не был проведён.
  ipcMain.handle(IPC.NOTEBOOK_PICK_FILES, async (e) => {
    const w = winOf(e);
    if (!w) return [];
    const res = await dialog.showOpenDialog(w, {
      title: 'Документы для блокнота',
      // Несколько сразу: материал для исследования человек собирает пачкой, а не по одному.
      properties: ['openFile', 'multiSelections'],
      filters: [
        { name: 'Документы', extensions: [...SUPPORTED_FILE_EXTENSIONS] },
        { name: 'Все файлы', extensions: ['*'] },
      ],
    });
    if (res.canceled) return [];
    return res.filePaths.map((p) => ({ path: p, name: nodePath.basename(p) }));
  });
  // Отдельным каналом от выбора — ровно как у ссылок: диалог отвечает мгновенно, а разбор
  // 300-страничного PDF идёт секунды, и всё это время источник должен стоять в списке
  // со своим «извлекается…», а не задерживать диалог.
  ipcMain.handle(IPC.NOTEBOOK_EXTRACT_FILE, (_e, filePath: string) =>
    typeof filePath === 'string' && filePath
      ? extractFileText(filePath)
      : { ok: false, error: 'Пустой путь' });
  // Открыть источник. ⚠️ Адрес открывается НАШЕЙ вкладкой (человек остаётся в браузере), а
  // файл отдаётся системе: рисовать свой просмотрщик docx и pdf ради этого незачем.
  ipcMain.handle(IPC.NOTEBOOK_OPEN_SOURCE, async (e, kind: 'url' | 'file', target: string) => {
    if (typeof target !== 'string' || !target) return false;
    if (kind === 'file') {
      const err = await shell.openPath(target);
      if (err) console.warn('[Notebook] не удалось открыть файл:', err);
      return !err;
    }
    return !!tabsOf(e)?.createTab(target);
  });
  // Документ новой вкладкой. ⚠️ Файл кладём во ВРЕМЕННУЮ папку системы, а не в userData:
  // это предпросмотр, а не пользовательские данные — сохранить документ насовсем человек
  // просит отдельной кнопкой. По той же причине здесь ничего не удаляется и не подчищается:
  // трогать чужие файлы во временной папке мы права не имеем (см. CLAUDE.md о sqlite в userData).
  //
  // ⚠️ Вкладка открывается ПРОГРАММНО из main, и только поэтому file:// вообще срабатывает:
  // гостевой странице переход на file: с http-страницы запрещён (shared/guestNavigation.ts).
  ipcMain.handle(IPC.NOTEBOOK_OPEN_DOC, async (e, suggestedName: string, html: string) => {
    if (typeof html !== 'string' || !html) return false;
    const safe = (suggestedName || 'документ').replace(/[\/:*?"<>|]/g, ' ').trim().slice(0, 60);
    const file = nodePath.join(app.getPath('temp'), `oblako-${Date.now()}-${safe || 'документ'}.html`);
    try {
      await fsp.writeFile(file, html, 'utf8');
    } catch (err) {
      console.warn('[Notebook] не удалось записать документ во временный файл:', (err as Error).message);
      return false;
    }
    return !!tabsOf(e)?.createTab(pathToFileURL(file).href);
  });
  ipcMain.handle(IPC.AI_ACTIVITY_GET, () => getActivity());
  ipcMain.handle(IPC.AI_ACTIVITY_CANCEL, () => cancelActivity());
  ipcMain.handle(IPC.NOTEBOOK_STUDIO_GEN, (e, kind: StudioKind, context: string) => {
    const sender = e.sender;
    return generateStudio(kind, typeof context === 'string' ? context : '', undefined, (chars) => {
      if (!sender.isDestroyed()) sender.send(IPC.NOTEBOOK_STUDIO_PROGRESS, chars);
    });
  });
  // ⚠️ Два канала, а не один: между ними стоит человек. suggestQueries только ПРЕДЛАГАЕТ, наружу
  // ничего не уходит; runSearch отправляет на SearXNG ровно то, что человек подтвердил.
  ipcMain.handle(IPC.NOTEBOOK_SUGGEST_QUERIES, (_e, topic: string, context: string) =>
    suggestQueries(typeof topic === 'string' ? topic : '', typeof context === 'string' ? context : ''));
  ipcMain.handle(IPC.NOTEBOOK_SEARCH, (_e, queries: string[]) =>
    runSearch(Array.isArray(queries) ? queries.filter((q): q is string => typeof q === 'string') : []));
  // Выгрузка документа Студии. Тот же приём, что у сохранения результата узла графа
  // (GRAPH_SAVE_OUTPUT): имя чистим от того, что Windows не пустит в путь.
  ipcMain.handle(IPC.NOTEBOOK_SAVE_DOC, async (e, suggestedName: string, html: string) => {
    const w = winOf(e);
    if (!w || typeof html !== 'string' || !html) return false;
    const safe = (suggestedName || 'документ').replace(/[\/:*?"<>|]/g, ' ').trim().slice(0, 80);
    const res = await dialog.showSaveDialog(w, {
      title: 'Сохранить документ',
      defaultPath: `${safe || 'документ'}.html`,
      filters: [{ name: 'HTML', extensions: ['html'] }],
    });
    if (res.canceled || !res.filePath) return false;
    try {
      await fsp.writeFile(res.filePath, html, 'utf8');
      return true;
    } catch (err) {
      console.warn('[Notebook] сохранение документа упало:', (err as Error).message);
      return false;
    }
  });
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

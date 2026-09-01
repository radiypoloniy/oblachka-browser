import { Menu, clipboard } from 'electron';
import type { BrowserWindow, ContextMenuParams, MenuItemConstructorOptions, WebContents, WebContentsView } from 'electron';
import { getSearchEngine } from '../shared/searchEngines';
import type { SearchEngineId } from '../shared/searchEngines';
import { hostOfUrl } from '../shared/rules';
import { TRANSLATE_TARGETS } from '../shared/translateLangs';
import type { AiAction } from '../shared/ipc';
import type { SelectionRect } from './TabManager';

// ── Нативное контекстное меню страницы (ПКМ) ─────────────────────────────────
//
// ⚠️ Отдельным файлом, а не методом TabManager, и это не косметика. Меню — ДЕКЛАРАЦИЯ пунктов:
// оно ничего не решает про вкладки, оно перечисляет, что человеку предложить, и зовёт готовые
// действия. С менеджером его связывает ровно дюжина вызовов (см. PageContextMenuHost) при 223
// строках текста — то есть это самый узкий шов, какой в TabManager вообще есть.
//
// ⚠️ Второй повод — размер. TabManager за порогом храповика структуры (scripts/structure-check.mjs),
// и любая новая строка в нём растит то, что и так велико. Правило «файл из базы не имеет права
// стать хуже» существует ровно для того, чтобы место под новую работу освобождалось выносом, а
// не поднятием базы.

// «Краткая выжимка» имеет смысл только для достаточно длинного выделения (иначе выжимать нечего) —
// одно место, легко поменять. ~40 слов ~ 250 символов на кириллице/латинице.
const SUMMARIZE_MIN_CHARS = 250;

// Обрезает длинный текст для лейблов меню, чтобы не растягивало окно.
function truncate(text: string, max = 40): string {
  const s = text.trim().replace(/\s+/g, ' ');
  return s.length > max ? s.slice(0, max) + '…' : s;
}

// Прямоугольник выделения (последний range) в координатах viewport страницы — для позиционирования
// поповера перевода. null, если выделения нет (тогда — фоллбэк на p.x/p.y клика ПКМ) — и ТАК ЖЕ
// null, если bounding rect всего выделения больше вьюпорта или начинается за его пределами (напр.
// выделили несколько экранов текста с прокруткой — rect в основном закадровый, якорить под ним
// поповер уводит его далеко от видимого текста, диагностировано логами: height=1649 при вьюпорте
// ~744, y=-1278). В этом случае координата клика ПКМ (она точно на экране) надёжнее bounding rect
// всего выделения — для НОРМАЛЬНОГО выделения, влезающего во вьюпорт, поведение не меняется.
const SELECTION_RECT_SCRIPT = `(function(){
  var sel = window.getSelection();
  if (!sel || sel.rangeCount === 0) return null;
  var r = sel.getRangeAt(0).getBoundingClientRect();
  if (r.width === 0 && r.height === 0) return null;
  if (r.height > window.innerHeight || r.width > window.innerWidth || r.top < 0 || r.left < 0) return null;
  return { x: r.left, y: r.top, width: r.width, height: r.height };
})()`;

// Правка своего текста в поле ввода: снимаем содержимое поля под курсором и ПОМЕЧАЕМ само поле,
// чтобы потом было куда вернуть исправленный текст.
//
// ⚠️ Поле ищем по координатам клика (elementFromPoint), а не по document.activeElement: правый
// клик не всегда переводит фокус в поле, а к моменту вставки фокус вообще будет у поповера.
// Метка атрибутом — тот же приём, что в pageFacts.ts: ссылку на узел через мост не передать, а
// путь по индексам протухает от любой перерисовки страницы (SPA перерисовывает форму на каждый
// ввод). Атрибут переживает перерисовку React'ом ровно потому, что он на том же DOM-узле.
const EDIT_FIELD_CAPTURE_SCRIPT = (x: number, y: number): string => `(function(){
  var el = document.elementFromPoint(${x}, ${y});
  var ed = el && el.closest ? el.closest('input, textarea, [contenteditable=""], [contenteditable="true"]') : null;
  if (!ed) return null;
  var prev = document.querySelector('[data-oblako-edit]');
  if (prev) prev.removeAttribute('data-oblako-edit');
  ed.setAttribute('data-oblako-edit', '1');
  var value = ('value' in ed) ? ed.value : ed.innerText;
  var r = ed.getBoundingClientRect();
  return { text: String(value || ''), rect: { x: r.left, y: r.top, width: r.width, height: r.height } };
})()`;

/** Прямоугольник в координатах страницы — то, что возвращают оба скрипта выше. */
interface PageRect { x: number; y: number; width: number; height: number }

/** Действие над выделением, уходящее в AI-поповер (см. onAiAction в TranslationService.ts). */
export type AiActionDispatch = (
  action: AiAction, text: string, rect: SelectionRect, wc: WebContents,
  canReplace?: boolean, targetLang?: string,
) => void;

/**
 * Всё, что меню просит у менеджера вкладок.
 *
 * ⚠️ Методами, а не значениями, и это существенно: половина колбэков ставится сеттерами уже ПОСЛЕ
 * конструктора (setOnSaveAs, setGraphMenuBuilder и прочие), а меню строится в момент щелчка —
 * снимок значений при проводке вкладки заморозил бы здесь undefined навсегда.
 */
export interface PageContextMenuHost {
  /** Окно, над которым всплывает меню. */
  window(): BrowserWindow;
  /** Поисковик, выбранный человеком, — для пункта «Поиск „…“ в …». */
  searchEngineId(): SearchEngineId;
  /** Приватна ли вкладка, в которой щёлкнули. */
  isIncognito(tabId: string): boolean;
  /** Новая вкладка. Возвращает id: он нужен и для учёта происхождения, и для split. */
  openTab(url: string, background: boolean, incognito: boolean): string;
  /** Запомнить, с какого сайта и из какой вкладки родилась новая. */
  noteOpened(openedId: string, fromHost: string, openerId: string): void;
  /** Показывается ли сейчас split-пара. */
  splitShown(): boolean;
  enterSplit(tabId: string): void;
  openInNewWindow(url: string): void;
  /** «Сохранить как…»: диалог поднимает не менеджер, а тот, кто владеет загрузками. */
  saveAs(url: string): void;
  /** Готовый пункт «Добавить в граф» либо null, если строитель не поставлен. */
  graphMenuItem(items: Array<{ url: string; title: string }>): MenuItemConstructorOptions | null;
  /** Диспетчер AI-действий либо null, если AI в этом окне не подключён. */
  aiAction(): AiActionDispatch | null;
}

/** Поисковик, выбранный человеком: имя для ярлыка пункта и построитель адреса. */
type Engine = ReturnType<typeof getSearchEngine>;

/**
 * Прямоугольник страницы → координаты ОКНА: поповер позиционируется в main, а тот про вьюпорт
 * вкладки ничего не знает. Оффсет берётся у вью В МОМЕНТ ответа скрипта, а не при построении
 * меню: между щелчком и ответом вкладка могла переехать (въезд панели сплита, размер окна).
 */
function toWindowRect(view: WebContentsView, local: PageRect): SelectionRect {
  const b = view.getBounds();
  return { x: b.x + local.x, y: b.y + local.y, width: local.width, height: local.height };
}

/**
 * Секции меню собираются по отдельности, а склеиваются в wirePageContextMenu.
 *
 * ⚠️ `hasPrev` — не украшение. Разделитель ставится, только если ВЫШЕ уже что-то есть, иначе меню
 * открывается чертой. Секция про своё место в списке не знает, поэтому ей это и сообщают: без
 * параметра пришлось бы либо тащить сюда весь массив, либо вычищать лишние черты после сборки —
 * и то и другое хуже одного булева.
 */
function linkSection(host: PageContextMenuHost, id: string, wc: WebContents, p: ContextMenuParams, priv: boolean): MenuItemConstructorOptions[] {
  const out: MenuItemConstructorOptions[] = [
    {
      label: 'Открыть ссылку в новой вкладке',
      // Источник новой вкладки — страница, где щёлкнули ссылку (тот же учёт, что в
      // setWindowOpenHandler): иначе правило «ссылки с хабра — в группу» не сработало бы
      // на самом частом способе открыть ссылку.
      click: () => {
        const openedId = host.openTab(p.linkURL, true, priv);
        // Третий аргумент — «кто открыл»: см. closeTab, закрытие вернёт человека сюда же.
        host.noteOpened(openedId, hostOfUrl(wc.getURL()), id);
      },
    },
    // Окно создаёт main — TabManager про окна не знает (тот же приём, что у пункта
    // «Добавить в граф»: сюда приходит готовый колбэк).
    { label: 'Открыть ссылку в новом окне', click: () => host.openInNewWindow(p.linkURL) },
    { label: 'Открыть ссылку в инкогнито', click: () => host.openTab(p.linkURL, true, true) },
  ];
  // Пункт только когда текущая вкладка ещё НЕ в показываемой паре — модель split строго
  // бинарная (пара = 2 панели), добавить третью панель к уже сплитнутой вкладке некуда.
  // Спрашиваем именно ПОКАЗЫВАЕМУЮ пару: смысл здесь — «текущая вкладка сейчас показывается
  // как часть пары».
  // ⚠️ Если активная вкладка внутри группы, а новая (createTab — всегда топ-уровень) окажется
  // в другом родителе дерева — enterSplit тихо не сработает (guard требует общего родителя,
  // см. enterSplit). Известное ограничение, не фикс здесь — для вкладок вне групп путь рабочий.
  if (!host.splitShown()) {
    out.push({
      label: 'Открыть ссылку в split',
      click: () => {
        const newId = host.openTab(p.linkURL, true, priv); // background — не перебивать фокус до enterSplit
        if (newId) host.enterSplit(newId); // активная → левая, новая → правая
      },
    });
  }
  out.push({ label: 'Копировать адрес ссылки', click: () => clipboard.writeText(p.linkURL) });
  // «Добавить в граф» строит main: TabManager не должен знать про хранилище графов,
  // ему отдают готовый пункт меню (тот же приём, что с tabManagerRef у менеджеров вью).
  const toGraph = host.graphMenuItem([{ url: p.linkURL, title: p.linkText || p.linkURL }]);
  if (toGraph) out.push({ type: 'separator' }, toGraph);
  return out;
}

function imageSection(host: PageContextMenuHost, wc: WebContents, p: ContextMenuParams, priv: boolean, hasPrev: boolean): MenuItemConstructorOptions[] {
  const out: MenuItemConstructorOptions[] = hasPrev ? [{ type: 'separator' }] : [];
  out.push(
    { label: 'Копировать картинку', click: () => wc.copyImageAt(p.x, p.y) },
    // ⚠️ Пунктов ДВА, и это прямое следствие того, что диалог «куда сохранить» у нас выключен
    // по умолчанию (см. DownloadManager: раньше система спрашивала про КАЖДЫЙ файл, включая
    // картинку с фотостока, и это выпилили). «Сохранить» кладёт в Загрузки молча — то, чего
    // хотят почти всегда; «как…» обязано спросить, иначе слово «как» в пункте — обман, и
    // выбрать место было нельзя вообще ничем (живая жалоба).
    { label: 'Сохранить картинку', click: () => wc.downloadURL(p.srcURL) },
    {
      label: 'Сохранить картинку как…',
      click: () => { host.saveAs(p.srcURL); wc.downloadURL(p.srcURL); },
    },
    { label: 'Открыть картинку в новой вкладке', click: () => host.openTab(p.srcURL, true, priv) },
  );
  return out;
}

/** Редактируемое поле: правка, орфография, поиск по выделенному и правка текста моделью. */
function editableSection(host: PageContextMenuHost, wc: WebContents, view: WebContentsView, p: ContextMenuParams, priv: boolean, engine: Engine, hasPrev: boolean): MenuItemConstructorOptions[] {
  const out: MenuItemConstructorOptions[] = [];
  const sep = () => { if (hasPrev || out.length) out.push({ type: 'separator' }); };

  // Орфография: варианты исправления, только если под курсором реально опечатка.
  if (p.misspelledWord && p.dictionarySuggestions.length) {
    sep();
    for (const suggestion of p.dictionarySuggestions) {
      out.push({ label: suggestion, click: () => wc.replaceMisspelling(suggestion) });
    }
  }
  sep();
  out.push({ role: 'cut' }, { role: 'copy' }, { role: 'paste' });
  if (p.selectionText.trim()) {
    out.push({ type: 'separator' }, {
      label: `Поиск «${truncate(p.selectionText)}» в ${engine.name}`,
      click: () => host.openTab(engine.buildUrl(p.selectionText), false, priv),
    });
  }

  // ── Правка своего текста локальной моделью ──────────────────────────
  // Работаем с ВЫДЕЛЕНИЕМ, если оно есть, иначе со всем содержимым поля: человек чаще всего
  // хочет причесать весь черновик, а не кусок. Текст поля тянем скриптом — в params
  // контекстного меню его нет (там только selectionText).
  const ai = host.aiAction();
  if (!ai) return out;
  // targetLang — только для перевода своего текста на выбранный язык; для fix/shorten/polite
  // не задаётся (они отвечают на языке оригинала).
  const dispatchEdit = (action: AiAction, targetLang?: string) => {
    void (async () => {
      let captured: { text: string; rect: PageRect } | null = null;
      try { captured = await wc.executeJavaScript(EDIT_FIELD_CAPTURE_SCRIPT(p.x, p.y), true); } catch { /* поле пропало */ }
      const text = p.selectionText.trim() || (captured?.text ?? '').trim();
      if (!text) return; // пустое поле — править нечего, молча выходим
      const local = captured?.rect ?? { x: p.x, y: p.y, width: 0, height: 0 };
      // Пятый аргумент — «результат можно вернуть в поле»: поповер покажет «Заменить».
      ai(action, text, toWindowRect(view, local), wc, true, targetLang);
    })();
  };
  out.push({ type: 'separator' }, {
    label: 'Править текст',
    submenu: [
      { label: 'Исправить ошибки', click: () => dispatchEdit('fix') },
      { label: 'Сделать короче',   click: () => dispatchEdit('shorten') },
      { label: 'Смягчить тон',     click: () => dispatchEdit('polite') },
      { type: 'separator' },
      // «Перевести на …» — свой черновик на чужой язык (пишу по-русски, отправлю по-английски).
      // Именно подменю с языками, а не свой всплывающий экран: нативное меню — это уже
      // «всплывающее окошко», и городить ради выбора языка отдельную WebContentsView незачем.
      {
        label: 'Перевести на',
        submenu: TRANSLATE_TARGETS.map((l) => ({
          label: l.label,
          click: () => dispatchEdit('translate', l.code),
        })),
      },
    ],
  });
  return out;
}

/** Выделенный текст вне поля ввода: копирование, поиск и AI-действия над выделением. */
function selectionSection(host: PageContextMenuHost, wc: WebContents, view: WebContentsView, p: ContextMenuParams, priv: boolean, engine: Engine, hasPrev: boolean): MenuItemConstructorOptions[] {
  const out: MenuItemConstructorOptions[] = hasPrev ? [{ type: 'separator' }] : [];
  out.push(
    { role: 'copy' },
    {
      label: `Поиск «${truncate(p.selectionText)}» в ${engine.name}`,
      click: () => host.openTab(engine.buildUrl(p.selectionText), false, priv),
    },
  );

  const ai = host.aiAction();
  if (!ai) return out;
  // Общий диспетчер для всех AI-действий над выделением — только action меняется,
  // координаты/фоллбэк/лог одни и те же (см. onAiAction в TranslationService.ts).
  const dispatchAiAction = (action: AiAction) => {
    const text = p.selectionText;
    const tClick = performance.now();
    void (async () => {
      // Фоллбэк на координаты клика ПКМ, если запрос rect не удался/не дал результата
      // (напр. выделение снялось до клика по пункту меню — редкий race).
      let local: PageRect;
      let fellBack = false;
      try {
        const scriptResult = await wc.executeJavaScript(SELECTION_RECT_SCRIPT, true);
        if (scriptResult) { local = scriptResult; } else { local = { x: p.x, y: p.y, width: 0, height: 0 }; fellBack = true; }
      } catch {
        local = { x: p.x, y: p.y, width: 0, height: 0 };
        fellBack = true;
      }
      const rect = toWindowRect(view, local);
      console.log(`[popover] selrect: fellBack=${fellBack} local=${JSON.stringify(local)} computed=${JSON.stringify(rect)}`);
      console.log(`[perf] selection->request: ${(performance.now() - tClick).toFixed(0)}ms`);
      ai(action, text, rect, wc);
    })();
  };

  out.push({ label: 'Перевести', click: () => dispatchAiAction('translate') });
  out.push({ label: 'Пересказать проще', click: () => dispatchAiAction('simplify') });
  out.push({ label: 'Объяснить', click: () => dispatchAiAction('explain') });
  // «Краткая выжимка» — только для достаточно длинного выделения (см. SUMMARIZE_MIN_CHARS).
  if (p.selectionText.trim().length >= SUMMARIZE_MIN_CHARS) {
    out.push({ label: 'Краткая выжимка', click: () => dispatchAiAction('summarize') });
  }
  return out;
}

/** Просто страница: ни ссылки, ни картинки, ни выделения. */
function pageSection(wc: WebContents): MenuItemConstructorOptions[] {
  return [
    { label: 'Назад',    enabled: wc.canGoBack(),    click: () => wc.goBack() },
    { label: 'Вперёд',   enabled: wc.canGoForward(), click: () => wc.goForward() },
    { label: 'Обновить',                             click: () => wc.reload() },
    // Пара к «Обновить»: тот же жест, но мимо кэша — когда сайт отдал протухшие стили
    // или скрипт и обычное обновление ничего не меняет.
    { label: 'Обновить без кэша', accelerator: 'Ctrl+F5', click: () => wc.reloadIgnoringCache() },
  ];
}

/** Подписывает вкладку на ПКМ. Вызывается один раз на вкладку, из wirePageEvents. */
export function wirePageContextMenu(host: PageContextMenuHost, id: string, view: WebContentsView): void {
  const wc = view.webContents;

  wc.on('context-menu', (_e, p) => {
    const items: MenuItemConstructorOptions[] = [];
    const engine = getSearchEngine(host.searchEngineId());
    // ⚠️ Всё, что рождается ОТ ЭТОЙ страницы, наследует её приватность. Замерено на стенде
    // (куки как признак сессии): раньше ссылка, открытая из приватной вкладки, присылала куку
    // ОБЫЧНОГО профиля — то есть попадала в дисковую сессию, писалась в историю и в автосейв.
    // Для поиска по выделенному это особенно скверно: наружу уходил выделенный на приватной
    // странице текст, да ещё и с записью в историю. Пункт «Открыть ссылку в инкогнито» внутри
    // остаётся отдельным: он поднимает приватность из ОБЫЧНОЙ вкладки, а это другое действие.
    const priv = host.isIncognito(id);

    if (p.linkURL) items.push(...linkSection(host, id, wc, p, priv));
    if (p.mediaType === 'image' && p.srcURL) items.push(...imageSection(host, wc, p, priv, items.length > 0));
    // isEditable обрабатываем ДО selectionText: cut/copy/paste — главное для инпутов.
    if (p.isEditable) {
      items.push(...editableSection(host, wc, view, p, priv, engine, items.length > 0));
    } else if (p.selectionText.trim()) {
      items.push(...selectionSection(host, wc, view, p, priv, engine, items.length > 0));
    }
    if (!items.length) items.push(...pageSection(wc));

    // Инспектор — всегда в конце; inspectElement подсвечивает элемент под курсором.
    items.push({ type: 'separator' }, {
      label: 'Просмотреть код',
      click: () => {
        if (!wc.isDevToolsOpened()) wc.openDevTools({ mode: 'detach' });
        wc.inspectElement(p.x, p.y);
      },
    });

    Menu.buildFromTemplate(items).popup({ window: host.window() });
  });
}

import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import type { UiLanguage } from '../shared/uiLanguage';

// Ключ — уже существующий русский текст. Такой каталог позволяет переносить экраны по одному,
// не меняя русский интерфейс и не вводя фиктивные идентификаторы для каждой подписи.
const EN: Record<string, string> = {
  'Браузер': 'Browser',
  'Основное': 'Basics',
  'Приватность': 'Privacy',
  'Прочее': 'More',
  'Интерфейс': 'Appearance',
  'Блокировка': 'Blocking',
  'Пароли': 'Passwords',
  'Автозаполнение': 'Autofill',
  'Разрешения': 'Permissions',
  'Профили': 'Profiles',
  'Правила': 'Rules',
  'Справка': 'Help',
  'Поиск по настройкам': 'Search settings',
  'Ищу по смыслу…': 'Searching by meaning…',
  'Найдено по смыслу': 'Found by meaning',
  'Ничего не нашлось': 'Nothing found',
  'скоро': 'soon',
  'Щит': 'Protection',
  'ИИ': 'AI',
  'Приложения': 'Apps',
  'Настройки': 'Settings',
  'VPN и блокировщик': 'VPN and ad blocker',
  'Спросить о странице': 'Ask about a page',
  'Плитки и виджеты стола': 'Desktop tiles and widgets',
  'Тема, палитра, обои': 'Theme, colors, wallpaper',
  'Перенесём ваши данные?': 'Bring your data over?',
  'Закладки, история и пароли переедут из привычного браузера. В нём ничего не изменится — данные только копируются.': 'Copy bookmarks, history and passwords from your old browser. Nothing will be changed there.',
  'Скачать локальную модель?': 'Download a local model?',
  'Про локальную модель': 'About the local model',
  'Перевод, пересказ и поиск по смыслу работают прямо на вашем компьютере — для этого нужен один файл модели. Качается в фоне, пользоваться браузером можно сразу.': 'Translation, summaries and semantic search run on your computer. They need a model file, which downloads in the background while you use the browser.',
  'На этом устройстве локальная модель не пойдёт — видеопамяти не хватит даже самой лёгкой. Всё остальное работает как обычно, без неё.': 'This device does not have enough video memory for even the smallest local model. Everything else still works.',
  'Пока скачивается модель': 'While the model downloads',
  'Напоследок — четыре места': 'Four places to know',
  'Загрузка идёт в фоне и переживёт этот экран — браузером можно пользоваться прямо сейчас. А пока покажем, где что лежит.': 'The download will continue after you close this screen. You can use the browser now; here is where to find things.',
  'Ничего настраивать не нужно, но эти четыре вещи стоит знать заранее — потом найдёте их глазами.': 'There is nothing you need to set up. These four places are worth knowing about.',
  'Подготовить историю к поиску?': 'Prepare your history for search?',
  'Как ему выглядеть?': 'Make it yours',
  'Тему и палитру можно поменять когда угодно — раздел «Интерфейс» в настройках.': 'You can change the theme and colors any time in Settings → Appearance.',
  'Пропустить': 'Skip',
  'Шаг': 'Step',
  'из': 'of',
  'Модель качается —': 'Downloading model —',
  'Можно закрывать этот экран: загрузка продолжится в фоне.': 'You can close this screen; the download will continue.',
  'Назад': 'Back',
  'Не сейчас': 'Not now',
  'Переносим…': 'Importing…',
  'Перенести': 'Import',
  'Скачать модель': 'Download model',
  'Проиндексировать': 'Index history',
  'Начать пользоваться': 'Start browsing',
  'Дальше': 'Next',
  'Уголь': 'Charcoal',
  'Графит': 'Graphite',
  'Сланец': 'Slate',
  'Бумага': 'Paper',
  'Мята': 'Mint',
  'Небо': 'Sky',
  'Светлая': 'Light',
  'Тёмная': 'Dark',
  'Как в системе': 'System',
  'Тема': 'Theme',
  'Палитра': 'Color palette',
  'Что скачаем': 'What you will download',
  'Размер': 'Size',
  'Нужно видеопамяти': 'Video memory needed',
  'Загрузка не удалась:': 'Download failed:',
  'Можно повторить позже в «Настройки → ИИ».': 'You can try again later in Settings → AI.',
  'Качаем —': 'Downloading —',
  'Качаем…': 'Downloading…',
  'Можно идти дальше: загрузка продолжится в фоне.': 'You can continue; the download will run in the background.',
  'Модель скачана — локальный ИИ готов.': 'Model downloaded — local AI is ready.',
  'Читаем страницы —': 'Reading pages —',
  'Можно идти дальше: это продолжится в фоне.': 'You can continue; this will run in the background.',
  'Запустили — дальше браузер сделает это сам.': 'Started — the browser will take it from here.',
  'Что произойдёт': 'What will happen',
  'Без этого шага умный поиск не увидит перенесённые страницы, пока вы сами их не откроете. Сейчас браузер по одной откроет их в фоне и прочитает текст.': 'Without this step, semantic search will not see imported pages until you open them. The browser will open them one by one in the background and read their text.',
  'Это займёт время и потребует сети.': 'This will take time and use your connection.',
  'Всё остальное в это время работает как обычно.': 'You can keep using the browser.',
  'Прочитанное остаётся на вашем компьютере.': 'The content stays on your computer.',
  'Закладки': 'Bookmarks',
  'История': 'History',
  'Ищем браузеры на компьютере…': 'Looking for browsers on this computer…',
  'Других браузеров с данными не нашлось — переносить нечего.': 'No other browser data found to import.',
  'Нашли на этом компьютере': 'Found on this computer',
  'Что перенести': 'What to import',
  'Выбрать CSV-файл': 'Choose CSV file',
  'В файле не нашлось паролей — это точно CSV-экспорт паролей?': 'No passwords found in the file. Is this a password-export CSV?',
  'Не удалось прочитать файл.': 'Could not read the file.',
  'Хранилище паролей недоступно.': 'Password vault is unavailable.',
  'Развернуть панель': 'Expand sidebar',
  'Свернуть панель': 'Collapse sidebar',
  'Новая вкладка (ПКМ — инкогнито / восстановить)': 'New tab (right-click for private tab or restore)',
  'Новая вкладка': 'New tab',
  'История и закладки': 'History and bookmarks',
  'Потяните, чтобы изменить ширину (двойной щелчок — вернуть)': 'Drag to resize (double-click to reset)',
  'Закреплённые': 'Pinned',
  'Открыто': 'Open',
  'Пока пусто. Введите адрес в строке сверху.': 'Nothing here yet. Enter an address above.',
  'Предложение:': 'Suggestion:',
  'и ещё': 'and',
  'Применить': 'Apply',
  'Отмена': 'Cancel',
  'Модель загружается в память, это займёт около минуты, потерпите': 'Loading the model. This may take about a minute…',
  'Читаю вкладки…': 'Reading tabs…',
  'Повторить': 'Try again',
  'Навести порядок': 'Organize tabs',
  'Придумываю названия…': 'Naming tabs…',
  'Порядок наведён': 'Tabs organized',
  'Вкладки сгруппированы': 'Tabs grouped',
  'Вкладки переименованы': 'Tabs renamed',
  'Скрыть': 'Dismiss',
  'названия': 'names',
  'группы': 'groups',
  'Вкладки': 'Tabs',
  'всё': 'all',
  'Вперёд': 'Forward',
  'Обновить': 'Reload',
  'Введите запрос или адрес': 'Search or enter address',
  'Перевожу страницу…': 'Translating page…',
  'симв.': 'chars',
  'Страница переведена — ещё действия': 'Page translated — more actions',
  'Ещё действия со страницей': 'More page actions',
  'Копировать адрес': 'Copy address',
  'Удалить из закладок': 'Remove bookmark',
  'Добавить в закладки': 'Add bookmark',
  'Внешний агент': 'External agent',
  'AI-панель': 'AI panel',
  'Скопированное со страниц — пока пусто': 'Nothing copied from pages yet',
  'Скопированное со страниц (Ctrl+Shift+B)': 'Copied from pages (Ctrl+Shift+B)',
  'Загрузки': 'Downloads',
  'Сайт ждёт ответа на запрос доступа': 'Site is waiting for a permission decision',
  'Сайту отказано по прежнему решению — нажмите, чтобы изменить': 'Site permission was previously denied — click to change',
  'Свернуть': 'Minimize',
  'Вернуть размер': 'Restore window',
  'Развернуть': 'Maximize',
  'Закрыть': 'Close',
  'Поиск из адресной строки, бэнги, загрузки и то, как браузер ведёт себя на этом компьютере.': 'Address-bar search, bangs, downloads, and how the browser behaves on this computer.',
  'Язык интерфейса': 'Interface language',
  'Меняет язык браузера, но не язык сайтов и не язык ответов AI.': 'Changes the browser interface, not website languages or AI replies.',
  'Английский': 'English',
  'Русский': 'Russian',
  'Язык сайтов': 'Website language',
  'Как в приложении': 'Same as app',
};

export function translate(language: UiLanguage, source: string): string {
  return language === 'en' ? (EN[source] ?? source) : source;
}

interface LanguageContextValue {
  language: UiLanguage;
  t(source: string): string;
  setLanguage(language: UiLanguage): Promise<void>;
}

const LanguageContext = createContext<LanguageContextValue | null>(null);

export function LanguageProvider({ children }: { children: ReactNode }) {
  const [language, setLanguageState] = useState<UiLanguage | null>(null);

  useEffect(() => {
    let live = true;
    void window.oblako.getUiLanguage().then((value) => {
      if (live) setLanguageState(value);
    }).catch(() => {
      if (live) setLanguageState('ru');
    });
    const unsubscribe = window.oblako.onUiLanguageChanged((value) => {
      if (live) setLanguageState(value);
    });
    return () => { live = false; unsubscribe(); };
  }, []);

  useEffect(() => {
    if (language) document.documentElement.lang = language;
  }, [language]);

  const value = useMemo<LanguageContextValue | null>(() => language ? {
    language,
    t: (source) => translate(language, source),
    setLanguage: (next) => window.oblako.setUiLanguage(next),
  } : null, [language]);

  // До ответа main окно всё равно скрыто. Не показываем на мгновение неверный язык.
  return value ? <LanguageContext.Provider value={value}>{children}</LanguageContext.Provider> : null;
}

export function useLanguage(): LanguageContextValue {
  const value = useContext(LanguageContext);
  if (!value) throw new Error('LanguageProvider отсутствует');
  return value;
}

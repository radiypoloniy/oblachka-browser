# Oblako Browser — прототип ядра (Этап 1)

Запускаемый каркас браузера на **Electron + TypeScript + Vite + React**.
Открывает реальные сайты в `WebContentsView`, с вертикальным сайдбаром вкладок,
тулбаром и омнибоксом (URL или поиск). Это Этап 1 из дорожной карты — ядро,
на которое нарастают VPN, AI, пароли и прочее.

## Как запустить

Нужен **Node.js 18+** и интернет (для загрузки зависимостей и бинарника Electron).

```bash
npm install        # поставит зависимости + скачает бинарник Electron
npm run dev         # запустит Vite (5173) + Electron в dev-режиме
```

`npm run dev` поднимает dev-сервер Vite для хрома и открывает окно Electron,
который грузит хром с `localhost:5173`. DevTools хрома открываются в отдельном окне.

Прод-сборка:

```bash
npm run build       # vite build (renderer) + tsc (electron)
npm start            # запуск собранного приложения
```

> ⚠️ Если `npm install` падает на скачивании бинарника Electron (403/таймаут) —
> это сетевое ограничение окружения, не код. Поставьте зависимости там, где
> доступен `github.com` / `objects.githubusercontent.com`, либо настройте
> `ELECTRON_MIRROR`. Сам код к этому моменту уже собран и проверен типами.

## Что внутри (архитектура)

Главный приём: **UI браузера и веб-страницы — разные слои**, как и записано в спеке.

- **`electron/main.ts`** — главный процесс. Создаёт окно (`BrowserWindow` с
  `titleBarStyle: 'hidden'` + `titleBarOverlay` — системные кнопки в своём
  оформлении). Кладёт в окно слой хрома (наш React) во всю площадь.
- **`electron/TabManager.ts`** — движок вкладок. Владеет `WebContentsView` для
  каждой реальной страницы, показывает активную и прячет остальные, позиционирует
  активную вьюху в «дырку» под контент. Здесь же: парсинг омнибокса (URL или
  поиск через DuckDuckGo), политика `window.open` → новая вкладка, отдача
  `mailto:`/`tel:` в ОС, заготовка под падение рендер-процесса.
- **`electron/preload.ts`** — безопасный мост: пробрасывает типизированный
  `window.oblako` в хром через `contextBridge` (страницы при этом полностью
  изолированы: `contextIsolation`, `sandbox`, без Node).
- **`shared/ipc.ts`** — единый контракт типов и каналов между хромом и main.
- **`src/App.tsx`** — хром. Меряет область контента (`ResizeObserver`) и сообщает
  main, куда класть `WebContentsView`. Сайдбар, тулбар, хаб — в `src/components/`.
- **`src/styles/tokens/`** — токены дизайн-системы Oblako (Liquid Glass).

## Что уже работает

- Окно с кастомным titlebar, фон под Liquid Glass.
- Сайдбар: вертикальные вкладки (создать / закрыть / переключить), favicon,
  индикатор загрузки, заголовок страницы. Хаб закреплён сверху.
- Тулбар: назад / вперёд / обновить (с учётом доступности), омнибокс с живым
  вводом, копирование URL, мок-пилюля VPN, переключатель темы.
- Омнибокс понимает «URL это или поиск».
- Реальное открытие сайтов, `target=_blank` / `window.open` → новая вкладка.
- Переключение светлая/тёмная тема.

## Чего осознанно ЕЩЁ НЕТ (следующие этапы)

VPN, AI, пароли, усыпление вкладок, split view, закреплённые реальные сайты,
контекстное меню ПКМ, страницы ошибок, проверка орфографии.

### ⚠️ Важное предупреждение про данные

**Периодического автосейва сессии здесь НЕТ** (см. спека 3.7). Это значит:
закрытие приложения или его падение = **потеря всех открытых вкладок** без
восстановления. Для прототипа это нормально, но не держите в нём вкладки,
которые жалко потерять. Автосейв состояния вкладок — задача Этапа 2, и его
стоит сделать до того, как браузером начнут пользоваться всерьёз.

## Bergamot (альтернативный движок перевода страниц, WASM/CPU)

Bergamot (Marian NMT, WASM) — дефолтный движок полностраничного перевода,
специально лёгкий для CPU (в отличие от Qwen-9B, которому нужен GPU) — см.
`electron/ITranslationEngine`-абстракцию (`electron/TranslationEngine.ts`,
`electron/TranslationEngineRegistry.ts`). Переключатель движка — в Settings.tsx;
если для конкретной пары языков у Bergamot нет модели, `TranslationEngineRegistry`
тихо откатывается на Qwen (`electron/TranslationService.ts`), см. её же комментарии.
Сам движок — изолированный сервис (`electron/BergamotService.ts` +
`electron/BergamotWorkerEntry.ts`, крутится в собственном
`node:worker_threads.Worker`, НЕ в renderer) плюс CLI-инструмент для ручной
проверки (см. «Ручная проверка» ниже).

### Патч пакета (`npm install` делает это сам)

`@browsermt/bergamot-translator` (опубликован в 2022, с тех пор не обновлялся)
не работает из коробки в Node на Windows — три реальных бага, найденных живым
прогоном (не в теории), пофикшены `scripts/patch-bergamot.mjs` (идемпотентен,
запускается автоматически из `postinstall`):

1. `worker/translator-worker.js` наследует `"type":"module"` от пакета, но его
   же Node-совместимый слой зовёт голый `require(...)` (CommonJS-only) — под
   ESM это `ReferenceError`. Фикс — `worker/package.json` с `{"type":"commonjs"}`.
2. `self.location` строился как `` new URL(`file://${__filename}`) `` — на
   Windows `__filename` с бэкслешами и буквой диска не парсится как валидный
   URL. Фикс — `pathToFileURL(__filename)`.
3. Та же болезнь в `self.fetch()` для `file://` — читал `url.pathname`
   (`/C:/Users/...`, буквально как путь), получая `ENOENT` вида
   `open 'C:\C:\Users\...'`. Фикс — `fileURLToPath(url)`.

Если версия пакета сменится и патч перестанет находить нужные строки —
скрипт явно упадёт с понятным сообщением, а не молча пропустит фикс.

### Модели

```bash
npm run download-translation-models
```

Скачивает пары `en<->X` для каждого языка из `LANG_NAME`
(`electron/TranslationService.ts`) из реестра Mozilla Remote Settings (реальный
production-CDN Firefox Translations) в `resources/models/translation/{from}-{to}/`
(в `.gitignore`, не бандлится в git). Версия моделей не зафиксирована одним
номером — скрипт берёт самую свежую версию реестра, у которой есть полный
комплект `model.*.bin`/`lex*.bin`/`vocab*.spm` (или раздельные
`srcvocab*.spm`/`trgvocab*.spm`, см. `en-ja`/`en-ko`); совместимость с текущей
WASM-сборкой проверена вживую смоук-тестом на всех языках. Не для всех языков
есть модель в обе стороны (`be` — только `be->en`) или вообще (`zh` — нет
записей в реестре); скрипт логирует такие случаи и не падает.

Приоритет чтения на диске: `{userData}/models/translation/` (реальный
`app.getPath('userData')` — можно докладывать/обновлять без пересборки), а если
там пусто — автоматический фолбэк на бандл `resources/models/translation/`
(см. `bundledModelsDir` в `electron/BergamotWorkerEntry.ts`/`BergamotService.ts`/
`BergamotTranslationEngine.ts`, тот же принцип, что `resolveModelsBase` в
`AppProtocol.ts`). Копировать файлы в userData вручную не нужно — раньше
воркер смотрел ТОЛЬКО в userData, и после ручного скачивания в `resources/`
Bergamot тихо считал себя неготовым и откатывался на Qwen (живой баг, см.
историю) — фолбэк это устраняет.

### Ручная проверка (без UI)

```bash
npm run build:electron   # BergamotWorkerEntry.ts должен быть скомпилирован
npm run bergamot-smoke -- --from en --to ru --text "<p>Hello <b>world</b></p>"
```

`html: true` — Bergamot переносит инлайновую разметку через выравнивание
(alignment), не через простой поиск-замену: `<b>`/`<a href=...>` остаются на
переведённых словах. Печатает время инициализации воркера и время перевода.

## Заметки по реализации

- В спеке окно описано как `BaseWindow`. На практике для слоя хрома взят
  `BrowserWindow`: только он принимает `titleBarOverlay` в конструкторе в
  Electron 31. Дочерние `WebContentsView` добавляются через `win.contentView` —
  механика та же, что у `BaseWindow`. Если позже понадобится строгий `BaseWindow`,
  titlebar-overlay настраивается иначе (вручную).
- Шрифты (`Onest`, `JetBrains Mono`) грузятся с Google Fonts через `@import` в
  `tokens/fonts.css`. Для офлайна / стабильности их стоит забандлить локально
  (`@font-face` на `.woff2`) — как и сказано в readme дизайн-системы.
- Целевая платформа по спеке — Windows x64. Код кроссплатформенный, но
  titlebar-overlay и DPAPI-вещи (позже) — это Windows-специфика.

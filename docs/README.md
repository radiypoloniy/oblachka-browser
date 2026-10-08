# Документация Oblako — индекс

Сверено с кодом 08.10.2026 (версия 0.9.1). Правила работы — в [CLAUDE.md](../CLAUDE.md), продуктовое
описание — в [README.md](../README.md) и [ROADMAP.md](../ROADMAP.md).

⚠️ Файлы делятся на **живые** и **снимки**. Живой описывает, как устроено сейчас, и правится вместе с
кодом. Снимок фиксирует момент (аудит, план захода, протокол проверки): его не переписывают задним
числом, а при расхождении с кодом верит код и живой документ. Снимок узнаётся по дате в имени или
по слову «validation».

## Живые: устройство по областям

Читать ДО правки в своей области (таблица «когда читать» — в CLAUDE.md, «Карта документации»).

| Файл | Область |
| --- | --- |
| [architecture-core.md](architecture-core.md) | Окна и реестр окон, вкладки, сессия v6, адблок, омнибокс, оверлеи, `shared/ipc/` |
| [architecture-data.md](architecture-data.md) | История, закладки, импорт, VPN, пароли, автозаполнение, загрузки, разрешения |
| [architecture-ai.md](architecture-ai.md) | AI-панель, перевод, хаб, блокнот, граф, модели, очередь к Qwen |
| [architecture-mcp.md](architecture-mcp.md) | MCP-сервер: браузер как инструмент внешнего ИИ-клиента |
| [architecture-ui.md](architecture-ui.md) | Новая вкладка и стол, тема и палитры, настройки, онбординг, виджеты, токены |
| [architecture-code.md](architecture-code.md) | Структура кода: где что лежит, пороги размеров, разбор больших файлов |
| [local-ai-program.md](local-ai-program.md) | Критерий пригодности AI-идеи, стенд `npm run ai-bench`, недетерминированность |
| [design-system-color.md](design-system-color.md) | Цветовой закон и его замеры |
| [design-ai-providers.md](design-ai-providers.md) | Слой провайдеров моделей и блок «Модели» в настройках |
| [design-taskmanager.md](design-taskmanager.md) | Диспетчер задач (Shift+Esc): инвентарь компонентов |
| [tab-compare.md](tab-compare.md) | Сравнение товаров: данные, цена запроса, приватность |
| [roadmap.md](roadmap.md) | Техническая карта: что сделано, что осталось, что отложено и почему |
| [usability-roadmap.md](usability-roadmap.md) | Продуктовая карта удобства (сентябрь 2026) |
| [releases/](releases/) | Заметки к выпускам и протоколы их проверки |

## Снимки: планы и аудиты (в репозитории)

| Файл | Что зафиксировано |
| --- | --- |
| [equal-windows-plan.md](equal-windows-plan.md) | План равноправных окон, 04.10.2026 — реализован в 0.9.0 |
| [ai-history-search-plan.md](ai-history-search-plan.md) | План AI-поиска в истории, 02.10.2026 — статус в шапке |
| [search-audit-2026-10-02.md](search-audit-2026-10-02.md) | Аудит поиска в истории перед пакетом улучшений |
| [product-research-2026-09-18.md](product-research-2026-09-18.md) | Продуктовое исследование после split view |
| [history-search-fallback.md](history-search-fallback.md) | Первый этап переработки поиска истории |

## Снимки: протоколы проверки

`equal-windows-validation.md`, `window-routing-validation.md`, `window-lifecycle-validation.md`,
`tab-transfer-validation.md`, `multiwindow-*-validation.md`, `history-paging-validation.md`,
`search-package-validation.md`, `releases/*-validation.md` — что и как проверялось при приёмке
конкретной правки. ⚠️ `window-routing-validation.md` и `multiwindow-overlays-validation.md` не
покрывали Ctrl+F: поиск по странице был сломан с 0.9.0 до правки владельца FindBar
(`scripts/overlay-owner-check.mjs`).

## Локальные (в репозиторий не идут)

Аудиты безопасности, бэклоги паролей и производительности, продуктовая карта, рабочие карты
заходов и черновики — у автора на диске, список шаблонов — в `.gitignore`. Причина — в CLAUDE.md:
описание открытой дыры — инструкция к её эксплуатации, а не прозрачность.

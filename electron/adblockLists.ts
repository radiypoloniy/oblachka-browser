// Откуда адблок берёт фильтры (см. AdBlockManager.#loadBlocker и #refreshEngineIfStale).
//
// Списки — из ПЕРВОИСТОЧНИКОВ, а не из копии внутри репозитория Ghostery, которую по умолчанию
// качают fromPrebuilt*. ⚠️ Та копия обновляется ботом, и бот встал 14.08.2026: движок исправно
// «обновлялся» раз в три дня, но каждый раз теми же августовскими файлами. Живое последствие
// (27.10.2026) — видео YouTube не стартовало вовсе: старые правки запроса /player против нового
// плеера дают ответ, на котором плеер зацикливается («Возникли неполадки?», длительность
// прыгает 00:00 ↔ полная). В той копии к тому же нет filters-2025/2026 — двух лет фильтров uBO.
// Набор тот же, что у adsAndTrackingLists библиотеки, плюс эти два года.
//
// ⚠️ Код скриптлетов (resources.json) fromLists по-прежнему берёт из копии Ghostery: в
// первоисточнике готового файла нет, его собирают из исходников uBlock. Скриптлеты меняются
// куда реже фильтров, и нужные YouTube там есть, но если новый фильтр попросит свежий
// скриптлет — дыра здесь.

const UBO = 'https://ublockorigin.github.io/uAssets/filters';

export const FILTER_LISTS: readonly string[] = [
  'https://easylist.to/easylist/easylist.txt',
  'https://easylist.to/easylist/easyprivacy.txt',
  'https://pgl.yoyo.org/adservers/serverlist.php?hostformat=adblockplus&showintro=1&mimetype=plaintext',
  ...[
    'badware', 'filters', 'filters-2020', 'filters-2021', 'filters-2022', 'filters-2023',
    'filters-2024', 'filters-2025', 'filters-2026', 'quick-fixes', 'resource-abuse', 'unbreak',
    'privacy',
  ].map((name) => `${UBO}/${name}.txt`),
];

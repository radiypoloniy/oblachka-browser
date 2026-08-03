import fs from 'node:fs';

// Схема и миграции базы закладок — ОТДЕЛЬНО от BookmarkManager.ts и намеренно без единого
// импорта из 'electron'. Причина ровно одна: это единственный код в закладках, который трогает
// файл с реальными данными человека, и он обязан проверяться настоящим прогоном, а не чтением
// глазами. Без зависимости от electron его можно вызвать из голого node
// (см. scripts/bookmarks-schema-check.mjs) на временной базе.

type Database = import('better-sqlite3').Database;

export const BOOKMARKS_SCHEMA_VERSION = 2;

/**
 * v2 отличается от v1 тремя вещами, и каждая — не «на будущее», а обязательная для папок:
 *  • kind — папка это или ссылка. У папки нет адреса, а колонка url объявлена NOT NULL, поэтому
 *    отличать их «по пустому url» нельзя: пустая строка — такое же значение, как любое другое,
 *    и она немедленно столкнулась бы в индексе уникальности с другой такой же папкой.
 *  • ON DELETE CASCADE у parent_id. Без него при foreign_keys = ON удаление папки с содержимым
 *    не «оставит сирот», а ПРОВАЛИТСЯ с ошибкой FOREIGN KEY constraint failed. Ограничение в
 *    SQLite через ALTER не меняется — отсюда перестройка таблицы, а не пара ALTER'ов.
 *  • второй частичный индекс — на дубли внутри папки (в v1 был только на корень).
 */
const CREATE_TABLE = `
  CREATE TABLE bookmarks (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    kind        TEXT    NOT NULL DEFAULT 'link' CHECK (kind IN ('link', 'folder')),
    url         TEXT    NOT NULL DEFAULT '',
    title       TEXT    NOT NULL DEFAULT '',
    parent_id   INTEGER REFERENCES bookmarks(id) ON DELETE CASCADE,
    position    INTEGER NOT NULL DEFAULT 0,
    created_at  INTEGER NOT NULL
  );
`;

// ⚠️ Оба индекса уникальности — ЧАСТИЧНЫЕ, и оба ограничены kind = 'link'. Разберём почему,
// потому что на любой из этих граблей ошибка тихая:
//  • корень: обычный UNIQUE(parent_id, url) не сработал бы вовсе — SQLite считает каждый NULL
//    уникальным относительно других NULL даже внутри составного индекса, и дубликаты в корне
//    прошли бы мимо. Частичный индекс с WHERE parent_id IS NULL — одноколоночный в области
//    своего действия, и NULL там ни при чём;
//  • kind = 'link' в обоих: у папок url пустой, и без этого условия ДВЕ папки в одном родителе
//    считались бы дубликатом друг друга — вторая молча не создалась бы.
const CREATE_INDEXES = `
  CREATE INDEX IF NOT EXISTS idx_bookmarks_parent_position
    ON bookmarks(parent_id, position);
  CREATE UNIQUE INDEX IF NOT EXISTS idx_bookmarks_no_dup_root
    ON bookmarks(url) WHERE parent_id IS NULL AND kind = 'link';
  CREATE UNIQUE INDEX IF NOT EXISTS idx_bookmarks_no_dup_folder
    ON bookmarks(parent_id, url) WHERE parent_id IS NOT NULL AND kind = 'link';
`;

export type SchemaOutcome =
  | { action: 'created' }                          // базы не было
  | { action: 'migrated'; from: number; backup: string | null }
  | { action: 'current' };                         // уже v2, делать нечего

function tableExists(db: Database, name: string): boolean {
  const row = db.prepare(`SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?`).get(name);
  return row !== undefined;
}

function hasColumn(db: Database, table: string, column: string): boolean {
  const rows = db.prepare(`PRAGMA table_info(${table})`).all() as { name: string }[];
  return rows.some((r) => r.name === column);
}

/**
 * Снимок базы рядом с ней же, перед разрушающей правкой схемы.
 *
 * ⚠️ Именно `VACUUM INTO`, а не копирование файла средствами fs: база открыта и работает в
 * режиме WAL, то есть часть свежих данных лежит в отдельном -wal файле. Копия одного лишь
 * .sqlite взяла бы состояние без них — то есть тихо потеряла бы последние закладки ровно в тот
 * момент, когда копия и нужна. VACUUM INTO делает согласованный снимок силами самого SQLite.
 */
function backupBefore(db: Database, dbPath: string, fromVersion: number): string | null {
  const dest = `${dbPath}.v${fromVersion}-backup`;
  try {
    // VACUUM INTO отказывается писать в существующий файл — прошлый снимок уносим в сторону,
    // а не перетираем: он мог остаться от миграции, которая прошла плохо, и он там ценнее нового.
    if (fs.existsSync(dest)) fs.renameSync(dest, `${dest}.${Date.now()}`);
    db.prepare('VACUUM INTO ?').run(dest);
    return dest;
  } catch (e) {
    console.warn('[Bookmarks] снимок перед миграцией не сделан:', (e as Error).message);
    return null;
  }
}

/**
 * Приводит базу к актуальной версии. Идемпотентна: повторный вызов на готовой базе ничего не
 * делает. Бросает, если миграция не удалась, — вызывающая сторона решает, что показать человеку.
 */
export function setupBookmarksSchema(db: Database, dbPath: string): SchemaOutcome {
  db.pragma('journal_mode = WAL');

  if (!tableExists(db, 'bookmarks')) {
    db.pragma('foreign_keys = ON');
    db.exec(CREATE_TABLE + CREATE_INDEXES);
    db.pragma(`user_version = ${BOOKMARKS_SCHEMA_VERSION}`);
    return { action: 'created' };
  }

  // Версию определяем по НАЛИЧИЮ КОЛОНКИ, а не по user_version: у всех баз, созданных до этой
  // правки, user_version остался нулём (его никто не выставлял), и отличить по нему v1 от
  // свежесозданной базы невозможно. Колонка — факт, а не запись о факте.
  if (hasColumn(db, 'bookmarks', 'kind')) {
    db.pragma('foreign_keys = ON');
    db.exec(CREATE_INDEXES); // догоняем индексы, если прошлый заход оборвался между шагами
    db.pragma(`user_version = ${BOOKMARKS_SCHEMA_VERSION}`);
    return { action: 'current' };
  }

  const backup = backupBefore(db, dbPath, 1);

  // ⚠️ Порядок шагов — тот, что предписан документацией SQLite для смены ограничений таблицы.
  // foreign_keys выключается ДО транзакции: внутри транзакции этот pragma молча не действует, а
  // с включёнными ключами DROP TABLE со старой таблицы обнулил бы parent_id у детей (или упал).
  db.pragma('foreign_keys = OFF');
  try {
    db.transaction(() => {
      db.exec(`
        ALTER TABLE bookmarks RENAME TO bookmarks_v1;
        ${CREATE_TABLE}
        INSERT INTO bookmarks (id, kind, url, title, parent_id, position, created_at)
          SELECT id, 'link', url, title, parent_id, position, created_at FROM bookmarks_v1;
        DROP TABLE bookmarks_v1;
      `);
      db.exec(CREATE_INDEXES);
      // Проверяем ссылочную целостность ДО коммита: если в v1 завалялась строка с parent_id на
      // несуществующую запись, лучше откатить всё и остаться на рабочей v1, чем закрепить брак.
      const broken = db.pragma('foreign_key_check') as unknown[];
      if (broken.length > 0) throw new Error(`нарушена ссылочная целостность: ${broken.length} строк`);
      db.pragma(`user_version = ${BOOKMARKS_SCHEMA_VERSION}`);
    })();
  } finally {
    db.pragma('foreign_keys = ON');
  }

  return { action: 'migrated', from: 1, backup };
}

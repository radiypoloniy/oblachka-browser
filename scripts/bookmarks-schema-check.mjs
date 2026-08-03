// Проверка миграции базы закладок v1 → v2 на ВРЕМЕННОЙ базе.
//
// Зачем отдельным скриптом: миграция — единственное место в закладках, которое перестраивает
// таблицу с реальными данными человека, и проверять её чтением глазами нельзя. Схема вынесена в
// electron/bookmarksSchema.ts без импортов из 'electron' ровно для того, чтобы её можно было
// прогнать отсюда, голым node.
//
// Ничего в профиле пользователя не трогает: работает в своей папке в os.tmpdir() и убирает её за
// собой. Требует свежей сборки main (npm run build либо tsc -p electron/tsconfig.json).
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

// ⚠️ better-sqlite3 в этом проекте пересобран под ABI Electron (см. postinstall), и системный
// node его не загрузит — упрётся в NODE_MODULE_VERSION. Поэтому скрипт при первом же отказе
// перезапускает сам себя нодой, встроенной в Electron: ELECTRON_RUN_AS_NODE даёт обычный node
// с нужным ABI и без единого окна. Ради этого же schema-модуль и не импортирует 'electron'.
let Database;
try {
  Database = require('better-sqlite3');
  // ⚠️ Именно открыть базу, а не просто require: сам модуль подгружается без ошибки, а нативную
  // часть тянет лениво уже конструктор — на одном require несовпадение ABI не всплывает.
  new Database(':memory:').close();
} catch (e) {
  if (process.env.OBLAKO_RELAUNCHED) throw e;
  const electron = path.join(ROOT, 'node_modules', 'electron', 'dist', 'electron.exe');
  if (!fs.existsSync(electron)) throw e;
  const r = spawnSync(electron, [fileURLToPath(import.meta.url)], {
    stdio: 'inherit',
    env: { ...process.env, ELECTRON_RUN_AS_NODE: '1', OBLAKO_RELAUNCHED: '1' },
  });
  process.exit(r.status ?? 1);
}
const { setupBookmarksSchema, BOOKMARKS_SCHEMA_VERSION } = require('../dist-electron/electron/bookmarksSchema.js');

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'oblako-bm-'));
const dbPath = path.join(dir, 'bookmarks.sqlite');

let failed = 0;
const check = (name, cond, extra = '') => {
  if (cond) { console.log(`  ok   ${name}`); } else { failed++; console.log(`  ПРОВАЛ ${name} ${extra}`); }
};

// ── 1. Строим базу СТАРОГО формата, ровно как её создавал прежний код ────────────────────────
console.log('v1 → v2 на базе с данными');
{
  const db = new Database(dbPath);
  db.pragma('journal_mode = WAL');
  db.exec(`
    CREATE TABLE bookmarks (
      id          INTEGER PRIMARY KEY AUTOINCREMENT,
      url         TEXT    NOT NULL,
      title       TEXT    NOT NULL DEFAULT '',
      parent_id   INTEGER REFERENCES bookmarks(id),
      position    INTEGER NOT NULL DEFAULT 0,
      created_at  INTEGER NOT NULL
    );
    CREATE INDEX idx_bookmarks_parent_position ON bookmarks(parent_id, position);
    CREATE UNIQUE INDEX idx_bookmarks_no_dup_root ON bookmarks(url) WHERE parent_id IS NULL;
  `);
  const ins = db.prepare(`INSERT INTO bookmarks (url, title, parent_id, position, created_at) VALUES (?, ?, NULL, ?, ?)`);
  for (let i = 0; i < 50; i++) ins.run(`https://site${i}.example/page`, `Сайт ${i}`, i, 1700000000000 + i);
  db.close();
}

// ── 2. Миграция ──────────────────────────────────────────────────────────────────────────────
{
  const db = new Database(dbPath);
  const out = setupBookmarksSchema(db, dbPath);
  check('отчитался о миграции', out.action === 'migrated', JSON.stringify(out));
  check('снимок перед миграцией создан', !!out.backup && fs.existsSync(out.backup));

  const rows = db.prepare(`SELECT id, kind, url, title, position, created_at FROM bookmarks ORDER BY position`).all();
  check('все 50 записей на месте', rows.length === 50, `получено ${rows.length}`);
  check('данные не переврались', rows[7].url === 'https://site7.example/page' && rows[7].title === 'Сайт 7');
  check('id сохранены', rows[0].id === 1);
  check('время создания сохранено', rows[0].created_at === 1700000000000);
  check('всё стало ссылками', rows.every((r) => r.kind === 'link'));
  check('версия схемы записана', db.pragma('user_version', { simple: true }) === BOOKMARKS_SCHEMA_VERSION);

  // Снимок обязан быть ЧИТАЕМОЙ базой со всеми записями, иначе он бесполезен.
  const bak = new Database(out.backup, { readonly: true });
  check('в снимке те же 50 записей', bak.prepare(`SELECT COUNT(*) c FROM bookmarks`).get().c === 50);
  bak.close();

  // ── 3. Ради чего всё затевалось: папки ──
  db.pragma('foreign_keys = ON');
  const folder = db.prepare(`INSERT INTO bookmarks (kind, url, title, parent_id, position, created_at) VALUES ('folder','',?,NULL,?,?)`)
    .run('Работа', 100, Date.now()).lastInsertRowid;
  const folder2 = db.prepare(`INSERT INTO bookmarks (kind, url, title, parent_id, position, created_at) VALUES ('folder','',?,NULL,?,?)`)
    .run('Учёба', 101, Date.now()).lastInsertRowid;
  check('две папки в корне уживаются', folder !== folder2);

  db.prepare(`INSERT INTO bookmarks (kind, url, title, parent_id, position, created_at) VALUES ('link',?,?,?,?,?)`)
    .run('https://site7.example/page', 'копия в папке', folder, 0, Date.now());
  check('тот же адрес можно положить и в папку', true);

  let dupBlocked = false;
  try {
    db.prepare(`INSERT INTO bookmarks (kind, url, title, parent_id, position, created_at) VALUES ('link',?,?,?,?,?)`)
      .run('https://site7.example/page', 'дубль', folder, 1, Date.now());
  } catch { dupBlocked = true; }
  check('дубль ВНУТРИ одной папки отбит', dupBlocked);

  let dupRootBlocked = false;
  try {
    db.prepare(`INSERT INTO bookmarks (kind, url, title, parent_id, position, created_at) VALUES ('link',?,?,NULL,?,?)`)
      .run('https://site7.example/page', 'дубль в корне', 999, Date.now());
  } catch { dupRootBlocked = true; }
  check('дубль в корне отбит', dupRootBlocked);

  // Главное, ради чего перестраивали таблицу: удаление папки уносит содержимое, а не падает.
  const before = db.prepare(`SELECT COUNT(*) c FROM bookmarks`).get().c;
  db.prepare(`DELETE FROM bookmarks WHERE id = ?`).run(folder);
  const after = db.prepare(`SELECT COUNT(*) c FROM bookmarks`).get().c;
  check('удаление папки унесло содержимое (CASCADE)', after === before - 2, `было ${before}, стало ${after}`);

  db.close();
}

// ── 4. Повторный вызов ничего не ломает ─────────────────────────────────────────────────────
console.log('идемпотентность');
{
  const db = new Database(dbPath);
  const out = setupBookmarksSchema(db, dbPath);
  check('вторая миграция не запускается', out.action === 'current', JSON.stringify(out));
  check('записи на месте', db.prepare(`SELECT COUNT(*) c FROM bookmarks`).get().c === 51);
  db.close();
}

// ── 5. Пустая база ──────────────────────────────────────────────────────────────────────────
console.log('чистая установка');
{
  const p = path.join(dir, 'fresh.sqlite');
  const db = new Database(p);
  const out = setupBookmarksSchema(db, p);
  check('создана с нуля', out.action === 'created', JSON.stringify(out));
  check('версия проставлена', db.pragma('user_version', { simple: true }) === BOOKMARKS_SCHEMA_VERSION);
  db.close();
}

// ── 6. Работа с папками через сам BookmarkManager ────────────────────────────────────────────
// Именно через менеджер, а не запросами: проверяем не схему, а логику — защиту от кольца при
// переносе и сборку дерева. Менеджер запускается вне Electron, потому что ему передан путь.
console.log('папки через BookmarkManager');
{
  const { BookmarkManager } = require('../dist-electron/electron/BookmarkManager.js');
  const bm = new BookmarkManager(path.join(dir, 'api.sqlite'));
  await bm.initialize();

  const work = bm.createFolder('Работа');
  const inner = bm.createFolder('Проекты', work.id);
  check('папка создана', work && work.kind === 'folder' && work.url === '');
  check('вложенная папка создана', inner && inner.parentId === work.id);

  const a = bm.add('https://a.example/', 'A');
  const b = bm.add('https://b.example/', 'B', inner.id);
  check('ссылка в корне', a && a.parentId === null && a.kind === 'link');
  check('ссылка в папке', b && b.parentId === inner.id);

  // Повторное добавление того же адреса в тот же родитель — обновление заголовка, не дубль.
  const again = bm.add('https://b.example/', 'B новое имя', inner.id);
  check('повтор в той же папке не плодит дубль', again.id === b.id && again.title === 'B новое имя');
  check('тот же адрес в другом родителе — отдельная запись', bm.add('https://b.example/', 'B в корне').id !== b.id);

  // ⚠️ Главное: кольца. Ни одну из трёх попыток схема не отбила бы — только код.
  check('папку нельзя перенести в саму себя', bm.move(work.id, work.id) === false);
  check('папку нельзя перенести в своего потомка', bm.move(work.id, inner.id) === false);
  check('нельзя переносить внутрь ссылки', bm.move(inner.id, a.id) === false);
  check('перенос в нормальную папку проходит', bm.move(a.id, inner.id) === true);

  const tree = bm.listTree();
  const workNode = tree.find((n) => n.id === work.id);
  const innerNode = workNode?.children?.find((n) => n.id === inner.id);
  check('дерево собралось', !!workNode && !!innerNode);
  check('вложенность верная', innerNode.children.length === 2, `детей ${innerNode?.children?.length}`);
  check('у ссылки нет children', tree.find((n) => n.kind === 'link')?.children === undefined);
  check('папки идут выше ссылок', tree[0].kind === 'folder');

  check('переименование работает', bm.rename(work.id, 'Работа 2') && bm.list()[0].title === 'Работа 2');
  check('адрес правится', bm.setUrl(b.id, 'https://b2.example/'));
  check('у папки адрес не выставить', bm.setUrl(work.id, 'https://x.example/') === false);

  const ids = innerNode.children.map((n) => n.id).reverse();
  bm.reorder(inner.id, ids);
  check('порядок переписан', bm.list(inner.id).map((n) => n.id).join() === ids.join());

  // Удаление папки уносит поддерево целиком — через менеджер, а не голым DELETE.
  bm.remove(work.id);
  check('удаление папки унесло поддерево', bm.listTree().every((n) => n.id !== work.id)
    && bm.list(inner.id).length === 0);
}

// Уборка «по возможности»: последняя база осталась открытой менеджером, а Windows не даёт
// удалить файл под живым дескриптором. Заводить close() в менеджере ради одного скрипта не
// стали — ни у одного другого менеджера в проекте его нет, а временную папку подчистит система.
try { fs.rmSync(dir, { recursive: true, force: true }); } catch { /* см. выше */ }
console.log(failed ? `\n${failed} проверок провалено` : '\nвсе проверки пройдены');
process.exit(failed ? 1 : 0);

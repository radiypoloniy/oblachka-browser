import { app } from 'electron';
import path from 'node:path';
import fs from 'node:fs';
import type {
  GraphDoc, GraphEdge, GraphMeta, GraphNode, GraphNodeKind, GraphStructure,
  GraphNodeVersion,
} from '../shared/graph';
import type { ImagePreset } from '../shared/imagePresets';

// Хранилище граф-воркспейсов. Свой файл, не таблица внутри истории/закладок — тот же приём
// «один менеджер, один файл», что у bookmarks.sqlite и passwords.sqlite: у графов свой
// жизненный цикл и свой профиль риска, и чистка истории физически не может их задеть.
//
// Почему SQLite, а не JSON-документ на воркспейс: перетаскивание узлов — это непрерывный
// поток правок, переписывать документ целиком на каждое движение накладно, а частичная
// запись JSON при падении даёт битый файл. Здесь — транзакция и дебаунс на стороне вызова.
//
// ⚠️ Ключевое разделение прав на запись: СТРУКТУРУ (узлы, позиции, конфиг, связи) пишет
// только renderer через saveStructure, РЕЗУЛЬТАТЫ (output/inputHash/error) — только движок
// через setNodeResult. Иначе автосохранение холста, ушедшее из renderer со своей — уже
// устаревшей — копией узла, затирало бы выхлоп, который движок только что дописал.

type Database = import('better-sqlite3').Database;
type BetterSqlite3 = typeof import('better-sqlite3');

interface NodeRow {
  id: string;
  kind: string;
  x: number;
  y: number;
  w: number | null;
  h: number | null;
  title: string;
  config: string;
  input_hash: string | null;
  output: string | null;
  output_title: string | null;
  error: string | null;
}

interface EdgeRow {
  id: string;
  from_node: string;
  from_port: string;
  to_node: string;
  to_port: string;
}

export class GraphStore {
  #db: Database | null = null;
  #dbPath: string;

  constructor() {
    this.#dbPath = path.join(app.getPath('userData'), 'graphs.sqlite');
  }

  async initialize(): Promise<void> {
    let SqliteConstructor: BetterSqlite3 | null = null;
    try {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      SqliteConstructor = require('better-sqlite3') as BetterSqlite3;
    } catch (e) {
      console.warn('[Graph] better-sqlite3 не загружен — графы отключены:', (e as Error).message);
      return;
    }

    try {
      this.#db = new SqliteConstructor(this.#dbPath);
      this.#setup();
      console.log('[Graph] база инициализирована:', this.#dbPath);
    } catch (e) {
      console.error('[Graph] не удалось открыть БД:', (e as Error).message);
      // Пересоздание уместно только здесь: графы — новая фича, терять при повреждении
      // нечего, кроме самих графов, а неработающая вкладка хуже пустого холста.
      try {
        fs.unlinkSync(this.#dbPath);
        this.#db = new SqliteConstructor!(this.#dbPath);
        this.#setup();
        console.log('[Graph] БД пересоздана после ошибки');
      } catch (e2) {
        console.error('[Graph] пересоздание провалилось — графы отключены:', (e2 as Error).message);
        this.#db = null;
      }
    }
  }

  get available(): boolean {
    return this.#db !== null;
  }

  list(): GraphMeta[] {
    if (!this.#db) return [];
    try {
      return this.#db.prepare(`
        SELECT id, title, created_at AS createdAt, updated_at AS updatedAt
        FROM graphs ORDER BY updated_at DESC
      `).all() as GraphMeta[];
    } catch (e) {
      console.warn('[Graph] list error:', (e as Error).message);
      return [];
    }
  }

  create(title: string): GraphMeta | null {
    if (!this.#db) return null;
    try {
      const now = Date.now();
      const info = this.#db.prepare(
        `INSERT INTO graphs (title, created_at, updated_at) VALUES (?, ?, ?)`,
      ).run(title || 'Новый граф', now, now);
      return { id: Number(info.lastInsertRowid), title: title || 'Новый граф', createdAt: now, updatedAt: now };
    } catch (e) {
      console.warn('[Graph] create error:', (e as Error).message);
      return null;
    }
  }

  get(graphId: number): GraphDoc | null {
    if (!this.#db) return null;
    try {
      const meta = this.#db.prepare(`
        SELECT id, title, created_at AS createdAt, updated_at AS updatedAt FROM graphs WHERE id = ?
      `).get(graphId) as GraphMeta | undefined;
      if (!meta) return null;

      const nodeRows = this.#db.prepare(`
        SELECT id, kind, x, y, w, h, title, config, input_hash, output, output_title, error
        FROM graph_nodes WHERE graph_id = ?
      `).all(graphId) as NodeRow[];
      const edgeRows = this.#db.prepare(`
        SELECT id, from_node, from_port, to_node, to_port FROM graph_edges WHERE graph_id = ?
      `).all(graphId) as EdgeRow[];

      const nodes: GraphNode[] = nodeRows.map((r) => ({
        id: r.id,
        kind: r.kind as GraphNodeKind,
        x: r.x,
        y: r.y,
        w: r.w,
        h: r.h,
        title: r.title,
        // Битый JSON конфига не должен ронять открытие всего графа — узел просто откроется пустым.
        config: safeParseConfig(r.config),
        inputHash: r.input_hash,
        output: r.output,
        outputTitle: r.output_title,
        error: r.error,
      }));
      const edges: GraphEdge[] = edgeRows.map((r) => ({
        id: r.id,
        fromNode: r.from_node,
        fromPort: r.from_port,
        toNode: r.to_node,
        toPort: r.to_port,
      }));
      return { meta, nodes, edges };
    } catch (e) {
      console.warn('[Graph] get error:', (e as Error).message);
      return null;
    }
  }

  rename(graphId: number, title: string): void {
    if (!this.#db) return;
    try {
      this.#db.prepare(`UPDATE graphs SET title = ?, updated_at = ? WHERE id = ?`)
        .run(title || 'Без названия', Date.now(), graphId);
    } catch (e) {
      console.warn('[Graph] rename error:', (e as Error).message);
    }
  }

  remove(graphId: number): void {
    if (!this.#db) return;
    try {
      // Узлы и связи уходят каскадом (foreign_keys = ON + ON DELETE CASCADE).
      this.#db.prepare(`DELETE FROM graphs WHERE id = ?`).run(graphId);
    } catch (e) {
      console.warn('[Graph] remove error:', (e as Error).message);
    }
  }

  // Пишет ТОЛЬКО структурные колонки. output/input_hash/error намеренно не перечислены
  // в UPDATE — см. шапку файла: их владелец движок, и renderer не должен их трогать даже
  // случайно. Новые узлы приходят с пустыми результатами, это верно (их ещё не считали).
  saveStructure(graphId: number, structure: GraphStructure): void {
    if (!this.#db) return;
    const db = this.#db;
    try {
      const run = db.transaction(() => {
        const upsertNode = db.prepare(`
          INSERT INTO graph_nodes (graph_id, id, kind, x, y, w, h, title, config)
          VALUES (@graphId, @id, @kind, @x, @y, @w, @h, @title, @config)
          ON CONFLICT(graph_id, id) DO UPDATE SET
            kind = excluded.kind, x = excluded.x, y = excluded.y,
            w = excluded.w, h = excluded.h,
            title = excluded.title, config = excluded.config
        `);
        for (const n of structure.nodes) {
          upsertNode.run({
            graphId, id: n.id, kind: n.kind, x: Math.round(n.x), y: Math.round(n.y),
            w: n.w === null || n.w === undefined ? null : Math.round(n.w),
            h: n.h === null || n.h === undefined ? null : Math.round(n.h),
            title: n.title ?? '', config: JSON.stringify(n.config ?? {}),
          });
        }

        // Удаляем то, чего в присланной структуре больше нет. Пустой список — валидный
        // случай (человек очистил холст), поэтому NOT IN () обрабатываем отдельно:
        // "NOT IN ()" в SQL синтаксически невозможен.
        const keptNodes = structure.nodes.map((n) => n.id);
        if (keptNodes.length === 0) {
          db.prepare(`DELETE FROM graph_nodes WHERE graph_id = ?`).run(graphId);
          db.prepare(`DELETE FROM graph_node_history WHERE graph_id = ?`).run(graphId);
        } else {
          const marks = keptNodes.map(() => '?').join(',');
          db.prepare(`DELETE FROM graph_nodes WHERE graph_id = ? AND id NOT IN (${marks})`)
            .run(graphId, ...keptNodes);
          // История удалённого узла уходит вместе с ним: каскада тут нет (ключ узла
          // составной и на него нет внешней ссылки), поэтому чистим явно.
          db.prepare(`DELETE FROM graph_node_history WHERE graph_id = ? AND node_id NOT IN (${marks})`)
            .run(graphId, ...keptNodes);
        }

        // Связи проще переложить целиком: их мало, у них нет собственного состояния,
        // и так не нужно ловить переподключение ручки как пару вставка+удаление.
        db.prepare(`DELETE FROM graph_edges WHERE graph_id = ?`).run(graphId);
        const insertEdge = db.prepare(`
          INSERT INTO graph_edges (graph_id, id, from_node, from_port, to_node, to_port)
          VALUES (?, ?, ?, ?, ?, ?)
        `);
        for (const e of structure.edges) {
          insertEdge.run(graphId, e.id, e.fromNode, e.fromPort, e.toNode, e.toPort);
        }

        db.prepare(`UPDATE graphs SET updated_at = ? WHERE id = ?`).run(Date.now(), graphId);
      });
      run();
    } catch (e) {
      console.warn('[Graph] saveStructure error:', (e as Error).message);
    }
  }

  // Владелец результатов — движок. Узел мог быть удалён с холста, пока считался, поэтому
  // UPDATE по несуществующей строке — норма, а не ошибка.
  setNodeResult(
    graphId: number,
    nodeId: string,
    result: { inputHash: string | null; output: string | null; outputTitle: string | null; error: string | null },
  ): void {
    if (!this.#db) return;
    try {
      this.#db.prepare(`
        UPDATE graph_nodes SET input_hash = ?, output = ?, output_title = ?, error = ?
        WHERE graph_id = ? AND id = ?
      `).run(result.inputHash, result.output, result.outputTitle, result.error, graphId, nodeId);
    } catch (e) {
      console.warn('[Graph] setNodeResult error:', (e as Error).message);
    }
  }

  // ── История результатов узла ────────────────────────────────────────────────

  // Сколько прошлых результатов храним на узел. Пять — чтобы сравнить пару-тройку
  // формулировок промпта и не раздуть базу текстами страниц.
  static readonly HISTORY_LIMIT = 5;

  pushNodeHistory(graphId: number, nodeId: string, output: string, outputTitle: string | null): void {
    if (!this.#db || !output) return;
    const db = this.#db;
    try {
      const run = db.transaction(() => {
        db.prepare(`
          INSERT INTO graph_node_history (graph_id, node_id, at, output, output_title)
          VALUES (?, ?, ?, ?, ?)
        `).run(graphId, nodeId, Date.now(), output, outputTitle);
        // Подрезаем сразу при вставке: иначе история узла, который гоняют десятками раз,
        // росла бы без предела текстами по сотне килобайт.
        db.prepare(`
          DELETE FROM graph_node_history
          WHERE graph_id = ? AND node_id = ? AND rowid NOT IN (
            SELECT rowid FROM graph_node_history
            WHERE graph_id = ? AND node_id = ? ORDER BY at DESC LIMIT ?
          )
        `).run(graphId, nodeId, graphId, nodeId, GraphStore.HISTORY_LIMIT);
      });
      run();
    } catch (e) {
      console.warn('[Graph] pushNodeHistory error:', (e as Error).message);
    }
  }

  listNodeHistory(graphId: number, nodeId: string): GraphNodeVersion[] {
    if (!this.#db) return [];
    try {
      return this.#db.prepare(`
        SELECT at, output, output_title AS outputTitle
        FROM graph_node_history WHERE graph_id = ? AND node_id = ?
        ORDER BY at DESC
      `).all(graphId, nodeId) as GraphNodeVersion[];
    } catch (e) {
      console.warn('[Graph] listNodeHistory error:', (e as Error).message);
      return [];
    }
  }

  // ── Пресеты картинок ────────────────────────────────────────────────────────

  listImagePresets(): ImagePreset[] {
    if (!this.#db) return [];
    try {
      return this.#db.prepare(
        `SELECT id, label, emoji, guidance FROM image_presets ORDER BY created_at ASC`,
      ).all() as ImagePreset[];
    } catch (e) {
      console.warn('[Graph] listImagePresets error:', (e as Error).message);
      return [];
    }
  }

  saveImagePreset(preset: ImagePreset): void {
    if (!this.#db) return;
    try {
      this.#db.prepare(`
        INSERT INTO image_presets (id, label, emoji, guidance, created_at)
        VALUES (@id, @label, @emoji, @guidance, @createdAt)
        ON CONFLICT(id) DO UPDATE SET
          label = excluded.label, emoji = excluded.emoji, guidance = excluded.guidance
      `).run({
        id: preset.id, label: preset.label || 'Свой пресет',
        emoji: preset.emoji || '🎨', guidance: preset.guidance || '',
        createdAt: Date.now(),
      });
    } catch (e) {
      console.warn('[Graph] saveImagePreset error:', (e as Error).message);
    }
  }

  deleteImagePreset(id: string): void {
    if (!this.#db) return;
    try {
      this.#db.prepare(`DELETE FROM image_presets WHERE id = ?`).run(id);
    } catch (e) {
      console.warn('[Graph] deleteImagePreset error:', (e as Error).message);
    }
  }

  // ── Приватное ────────────────────────────────────────────────────────────────

  #setup(): void {
    const db = this.#db!;
    db.pragma('journal_mode = WAL');
    db.pragma('foreign_keys = ON');
    db.exec(`
      CREATE TABLE IF NOT EXISTS graphs (
        id          INTEGER PRIMARY KEY AUTOINCREMENT,
        title       TEXT    NOT NULL DEFAULT '',
        created_at  INTEGER NOT NULL,
        updated_at  INTEGER NOT NULL
      );
      CREATE TABLE IF NOT EXISTS graph_nodes (
        graph_id     INTEGER NOT NULL REFERENCES graphs(id) ON DELETE CASCADE,
        id           TEXT    NOT NULL,
        kind         TEXT    NOT NULL,
        x            INTEGER NOT NULL DEFAULT 0,
        y            INTEGER NOT NULL DEFAULT 0,
        w            INTEGER,
        h            INTEGER,
        title        TEXT    NOT NULL DEFAULT '',
        config       TEXT    NOT NULL DEFAULT '{}',
        input_hash   TEXT,
        output       TEXT,
        output_title TEXT,
        error        TEXT,
        PRIMARY KEY (graph_id, id)
      );
      CREATE TABLE IF NOT EXISTS graph_edges (
        graph_id  INTEGER NOT NULL REFERENCES graphs(id) ON DELETE CASCADE,
        id        TEXT    NOT NULL,
        from_node TEXT    NOT NULL,
        from_port TEXT    NOT NULL,
        to_node   TEXT    NOT NULL,
        to_port   TEXT    NOT NULL,
        PRIMARY KEY (graph_id, id)
      );
      CREATE INDEX IF NOT EXISTS idx_graph_edges_graph ON graph_edges(graph_id);
      -- Прошлые результаты узлов. Отдельная таблица, а не колонка-JSON в graph_nodes:
      -- версии добавляются по одной и подрезаются по количеству, для чего строки удобнее.
      CREATE TABLE IF NOT EXISTS graph_node_history (
        graph_id     INTEGER NOT NULL REFERENCES graphs(id) ON DELETE CASCADE,
        node_id      TEXT    NOT NULL,
        at           INTEGER NOT NULL,
        output       TEXT    NOT NULL,
        output_title TEXT
      );
      CREATE INDEX IF NOT EXISTS idx_graph_history_node ON graph_node_history(graph_id, node_id, at DESC);
      -- Пользовательские пресеты генератора промптов для картинок. Своя таблица здесь, а не
      -- отдельный файл: данные графовые, мелкие и живут ровно столько же, сколько воркспейсы.
      CREATE TABLE IF NOT EXISTS image_presets (
        id         TEXT PRIMARY KEY,
        label      TEXT NOT NULL,
        emoji      TEXT NOT NULL DEFAULT '🎨',
        guidance   TEXT NOT NULL,
        created_at INTEGER NOT NULL
      );
    `);

    // Колонки размера появились после первой версии схемы: CREATE TABLE IF NOT EXISTS их
    // в уже существующую таблицу не добавит. Миграция неразрушающая — только ADD COLUMN,
    // существующие узлы получают NULL («размер по содержимому»).
    const columns = new Set(
      (db.pragma('table_info(graph_nodes)') as { name: string }[]).map((c) => c.name),
    );
    if (!columns.has('w')) db.exec(`ALTER TABLE graph_nodes ADD COLUMN w INTEGER`);
    if (!columns.has('h')) db.exec(`ALTER TABLE graph_nodes ADD COLUMN h INTEGER`);
  }
}

function safeParseConfig(raw: string): GraphNode['config'] {
  try {
    const parsed: unknown = JSON.parse(raw);
    return parsed && typeof parsed === 'object' ? (parsed as GraphNode['config']) : {};
  } catch {
    return {};
  }
}

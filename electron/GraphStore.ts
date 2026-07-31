import { app } from 'electron';
import path from 'node:path';
import fs from 'node:fs';
import type {
  GraphDoc, GraphEdge, GraphMeta, GraphNode, GraphNodeKind, GraphStructure,
} from '../shared/graph';

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
        SELECT id, kind, x, y, title, config, input_hash, output, output_title, error
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
          INSERT INTO graph_nodes (graph_id, id, kind, x, y, title, config)
          VALUES (@graphId, @id, @kind, @x, @y, @title, @config)
          ON CONFLICT(graph_id, id) DO UPDATE SET
            kind = excluded.kind, x = excluded.x, y = excluded.y,
            title = excluded.title, config = excluded.config
        `);
        for (const n of structure.nodes) {
          upsertNode.run({
            graphId, id: n.id, kind: n.kind, x: Math.round(n.x), y: Math.round(n.y),
            title: n.title ?? '', config: JSON.stringify(n.config ?? {}),
          });
        }

        // Удаляем то, чего в присланной структуре больше нет. Пустой список — валидный
        // случай (человек очистил холст), поэтому NOT IN () обрабатываем отдельно:
        // "NOT IN ()" в SQL синтаксически невозможен.
        const keptNodes = structure.nodes.map((n) => n.id);
        if (keptNodes.length === 0) {
          db.prepare(`DELETE FROM graph_nodes WHERE graph_id = ?`).run(graphId);
        } else {
          const marks = keptNodes.map(() => '?').join(',');
          db.prepare(`DELETE FROM graph_nodes WHERE graph_id = ? AND id NOT IN (${marks})`)
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
    `);
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

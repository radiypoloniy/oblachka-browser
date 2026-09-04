// Подключение к чужому MCP-клиенту в одно нажатие: где лежит его конфиг и как туда попасть.
//
// ⚠️ Форма записи и слияние живут в shared/mcpClientConfig.ts под проверкой; здесь только то, что
// без операционной системы не проверить, — пути, чтение диска, копия и запись.
//
// ⚠️ ПУТИ ПЛАТФОРМЕННЫЕ, и они собраны В ОДНОЙ функции ровно поэтому (правило CLAUDE.md про
// macOS-порт): на Windows конфиги живут в %APPDATA%, на macOS — в ~/Library/Application Support,
// и размазать это ветвление по коду значило бы искать его потом по всему файлу.
//
// ⚠️ ПИШЕМ ТОЛЬКО ПО ЯВНОМУ ДЕЙСТВИЮ ЧЕЛОВЕКА. Осмотр (scanClients) чужие файлы лишь читает;
// правит их одна функция, и зовётся она из карточки, где показано, что именно будет дописано.

import { app } from 'electron';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { McpClientTarget, McpInstallResult } from '../../shared/ipc';
import {
  MCP_CLIENT_SPECS, mergeMcpServer, serverBlockText, specById,
  type McpClientSpec, type McpServerEntry,
} from '../../shared/mcpClientConfig';
import { endpointPath } from './McpPipe';

/**
 * Где клиент держит свой конфиг и по чему видно, что он вообще установлен.
 *
 * ⚠️ Установленность проверяем по КАТАЛОГУ, а не по файлу конфига: у только что поставленного
 * клиента файла ещё нет — он появляется при первой настройке. Проверяя файл, мы объявили бы
 * ненайденным ровно того, кому наша кнопка нужнее всего.
 */
function locate(spec: McpClientSpec): { dir: string; file: string } | null {
  const home = os.homedir();
  const mac = process.platform === 'darwin';
  const appData = process.platform === 'win32'
    ? process.env['APPDATA'] ?? path.join(home, 'AppData', 'Roaming')
    : path.join(home, 'Library', 'Application Support');

  switch (spec.id) {
    case 'claude-desktop': {
      if (!mac && process.platform !== 'win32') return null;
      const dir = path.join(appData, 'Claude');
      return { dir, file: path.join(dir, 'claude_desktop_config.json') };
    }
    case 'cursor': {
      // ⚠️ У Cursor путь одинаковый на всех системах — он кладёт конфиг в домашний каталог, а не
      // в системный каталог приложений.
      const dir = path.join(home, '.cursor');
      return { dir, file: path.join(dir, 'mcp.json') };
    }
    case 'vscode': {
      if (!mac && process.platform !== 'win32') return null;
      const dir = path.join(appData, 'Code', 'User');
      return { dir, file: path.join(dir, 'mcp.json') };
    }
    default:
      return null;
  }
}

/**
 * Наша запись: чем запускать шим и куда ему стучаться.
 *
 * ⚠️ Ровно то же, что в connectCommand() (см. mcp/index.ts), только разобранное на части: команда
 * и запись обязаны описывать один и тот же запуск. Разъехавшись, они дадут худший вид поломки —
 * «по команде работает, по кнопке нет».
 */
export function serverEntry(): McpServerEntry {
  const shim = app.isPackaged
    ? path.join(process.resourcesPath, 'mcp', 'shim.mjs')
    : path.join(app.getAppPath(), 'resources', 'mcp', 'shim.mjs');
  return {
    type: 'stdio',
    command: process.execPath,
    args: [shim, '--endpoint', endpointPath()],
    env: { ELECTRON_RUN_AS_NODE: '1' },
  };
}

/** Кого нашли на этой машине и что с ним будет по нажатию. */
export function scanClients(): McpClientTarget[] {
  const entry = serverEntry();
  const out: McpClientTarget[] = [];

  for (const spec of MCP_CLIENT_SPECS) {
    const at = locate(spec);
    if (at === null || !exists(at.dir)) continue;

    const text = readIfAny(at.file);
    const merged = mergeMcpServer(text, spec.section, entry);
    out.push({
      id: spec.id,
      label: spec.label,
      file: at.file,
      block: serverBlockText(spec.section, entry),
      ...(merged.ok ? { plan: merged.plan } : { plan: 'blocked', problem: merged.problem }),
    });
  }
  return out;
}

/**
 * Дописать нашу запись в конфиг клиента.
 *
 * ⚠️ РЕЗЕРВНАЯ КОПИЯ ПЕРЕД ЗАПИСЬЮ, и копия дня НЕ ПЕРЕЗАПИСЫВАЕТСЯ. Ценна именно первая — та,
 * что снята до нашего первого касания; затирая её вторым нажатием, мы сохраняли бы копию уже
 * изменённого файла, то есть теряли бы ровно то, ради чего копия делается.
 *
 * ⚠️ Запись атомарная (временный файл и переименование): прерваться посреди неё — значит оставить
 * человеку обрезанный конфиг, с которым его клиент не запустится вовсе.
 */
export function installClient(id: string): McpInstallResult {
  const spec = specById(id);
  const at = spec ? locate(spec) : null;
  if (spec === null || at === null) return { ok: false, error: 'Такой программы мы не знаем.' };
  if (!exists(at.dir)) return { ok: false, error: `${spec.label} на этой машине не найдена.` };

  const text = readIfAny(at.file);
  const merged = mergeMcpServer(text, spec.section, serverEntry());
  if (!merged.ok) return { ok: false, error: explain(merged.problem, spec.label) };
  // Уже прописано ровно так — трогать файл незачем, и резервная копия ни к чему.
  if (merged.plan === 'same') return { ok: true, plan: 'same', file: at.file };

  let backup: string | null = null;
  try {
    if (text !== null) backup = keepBackup(at.file);
    const tmp = `${at.file}.oblako-tmp`;
    fs.writeFileSync(tmp, merged.text, 'utf8');
    fs.renameSync(tmp, at.file);
  } catch (e) {
    return { ok: false, error: `Не удалось записать файл: ${e instanceof Error ? e.message : String(e)}` };
  }
  return { ok: true, plan: merged.plan, file: at.file, ...(backup !== null ? { backup } : {}) };
}

/** Копия рядом с оригиналом: человек найдёт её там же, где ищет сам конфиг. */
function keepBackup(file: string): string | null {
  const day = new Date().toISOString().slice(0, 10);
  const copy = `${file}.oblako-backup-${day}`;
  if (exists(copy)) return copy;
  fs.copyFileSync(file, copy);
  return copy;
}

function readIfAny(file: string): string | null {
  try {
    return fs.readFileSync(file, 'utf8');
  } catch {
    return null;
  }
}

function exists(p: string): boolean {
  try {
    return fs.existsSync(p);
  } catch {
    return false;
  }
}

/**
 * ⚠️ Отказ обязан говорить, ЧТО человеку делать дальше. «Не удалось» без причины оставляет его
 * ровно там же, откуда он пришёл, — с командой на три сотни знаков и без понимания, почему кнопка
 * не сработала.
 */
function explain(problem: 'not-json' | 'not-object' | 'section-not-object', label: string): string {
  switch (problem) {
    case 'not-json':
      return `Конфиг ${label} не читается как строгий JSON — вероятно, в нём есть комментарии. Мы его не трогали: скопируйте блок и вставьте сами.`;
    case 'not-object':
      return `Конфиг ${label} устроен неожиданно (в корне не объект). Мы его не трогали.`;
    case 'section-not-object':
      return `В конфиге ${label} список серверов занят чем-то другим. Мы его не трогали.`;
  }
}

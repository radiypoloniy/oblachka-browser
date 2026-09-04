import fs from 'node:fs';
import path from 'node:path';
import { app } from 'electron';
import { getActiveProfile } from '../ProfileStore';
import {
  canonicalToolName, normalizeDomainRule, MCP_TOOLS, type McpStance,
} from '../../shared/mcpPolicy';
import { askMcp, dropMcpPrompts } from '../McpPromptManager';

// Кто подключён к браузеру и что ему позволено.
//
// ⚠️ ВКЛЮЧЁННЫЙ СЕРВЕР — НЕ СОГЛАСИЕ НА КОНКРЕТНУЮ ПРОГРАММУ. В первом заходе это было одно и то
// же, и это была временная неправда: человек включал «браузер как инструмент», а получал доступ
// для любого процесса, узнавшего токен. Теперь у каждого клиента своя карточка, и отзывается он
// отдельно от сервера.
//
// ⚠️ ЛИЧНОСТЬ КЛИЕНТА НЕПРОВЕРЯЕМА, и запись на диске этого не меняет: ключ — это имя, которым
// программа сама себя назвала. Отсюда честная граница: карточка спрашивает не «вы доверяете
// Claude Desktop?», а «что-то представилось так и просит доступ». Настоящий барьер — токен канала
// (McpPipe.ts) и то, что человек видит подключение и журнал.
//
// ⚠️ ОТКАЗ ЗАПОМИНАЕТСЯ НА ВРЕМЯ. Программа, которой отказали, обычно повторяет вызов сразу же:
// без паузы человек получил бы то же окно снова и снова и в конце концов нажал бы «Разрешить»,
// чтобы оно отстало. Это не гипотеза, а известный способ выбить согласие измором.

const FILE = 'mcp-clients.json';
const DENY_COOLDOWN_MS = 5 * 60_000;
/**
 * Сколько ждём ответа человека, прежде чем ответить программе.
 *
 * ⚠️ 25 секунд, а не минута, по той же причине, что в McpConfirm: клиент рвёт вызов по своему
 * таймауту, и молчание дольше него агент показывает человеку как поломку сервера. Ответить
 * раньше — значит дать агенту сказать, чего от человека ждут. Карточка при этом не снимается,
 * и подтвердивший позже всё равно будет услышан.
 */
const WAIT_MS = 25_000;

export interface McpClientRecord {
  key: string;
  label: string;
  approvedAt: number;
  lastSeen: number;
  /**
   * Профиль, В КОТОРОМ программу подключили.
   *
   * ⚠️ Заведено потому, что разрешение выдаётся ОДИН РАЗ, а инструменты работают с АКТИВНЫМ
   * профилем — каким бы он ни был в момент вызова. Человек отдал агенту рабочий профиль,
   * переключился в личный, и та же программа с тем же разрешением читает личную историю.
   * Разрешение обязано жить в границах того профиля, для которого его дали.
   *
   * ⚠️ Может отсутствовать у записей прошлой версии: их привязываем к активному профилю при
   * первом же обращении, а не запрещаем задним числом — человек этих подключений не отменял.
   */
  profileId?: string;
  /** Имя профиля на момент подключения — для интерфейса. Id переживает переименование, имя нет. */
  profileName?: string;
  /**
   * Белый список сайтов. ПУСТО — без ограничений (см. разбор в shared/mcpPolicy.ts).
   *
   * ⚠️ Хранится нормализованным: правила приводятся к домену при записи, а не при каждой проверке.
   * Иначе одно и то же ограничение живёт в файле в трёх видах («https://github.com/», «GitHub.com»,
   * «github.com»), и человек, глядя в список, не понимает, почему два одинаковых правила.
   */
  domains?: string[];
  /**
   * Решения человека по инструментам: 'ask' | 'allow' | 'deny'.
   *
   * ⚠️ Пришло на смену списку выключенных, и это не переименование: раньше выбора было два
   * («спрашивать» или «нельзя»), а нужного третьего — «делай молча» — не существовало, отчего
   * каждый вызов и превращался в вопрос.
   */
  stances: Record<string, McpStance>;
}

let clients: McpClientRecord[] = [];
let loaded = false;

const denied = new Map<string, number>();
const asking = new Map<string, Promise<boolean>>();

function file(): string {
  return path.join(app.getPath('userData'), FILE);
}

function load(): void {
  if (loaded) return;
  loaded = true;
  try {
    const raw = JSON.parse(fs.readFileSync(file(), 'utf8')) as unknown;
    if (!Array.isArray(raw)) return;
    clients = raw.filter((c): c is McpClientRecord =>
      typeof c === 'object' && c !== null
      && typeof (c as McpClientRecord).key === 'string'
      && typeof (c as McpClientRecord).label === 'string');
    for (const c of clients) {
      // ⚠️ Записи прошлой версии несли список выключенных инструментов. Переводим их, а не
      // выбрасываем: человек уже принимал эти решения, и терять их при обновлении нельзя.
      const old = (c as unknown as { disabled?: unknown }).disabled;
      if (!c.stances || typeof c.stances !== 'object') c.stances = {};
      if (Array.isArray(old)) {
        for (const t of old) if (typeof t === 'string') c.stances[t] = 'deny';
        delete (c as unknown as { disabled?: unknown }).disabled;
      }
      // ⚠️ Права, выданные под ПРЕЖНИМИ именами через точку, переносим на канонические. Человек
      // нажимал «Разрешать всегда» для «Открыть вкладку», а не для строки 'tabs.open' — потерять
      // это при переименовании значило бы заставить его отвечать на те же вопросы заново.
      const moved: Record<string, McpStance> = {};
      for (const [name, stance] of Object.entries(c.stances)) {
        moved[canonicalToolName(name)] = stance;
      }
      c.stances = moved;
    }
  } catch { /* файла ещё нет — это чистая установка, а не поломка */ }
}

function save(): void {
  try {
    fs.writeFileSync(file(), JSON.stringify(clients, null, 2), 'utf8');
  } catch (e) {
    console.warn('[mcp] не удалось записать список клиентов:', (e as Error).message);
  }
}

export function listClients(): McpClientRecord[] {
  load();
  return clients.map((c) => ({ ...c, stances: { ...c.stances } }));
}

export function isApproved(key: string): boolean {
  load();
  return clients.some((c) => c.key === key);
}

/**
 * Тот ли это профиль, для которого программу подключали.
 *
 * ⚠️ Записи прошлой версии профиля не знают — привязываем их к текущему при первом обращении.
 * Запрещать задним числом нельзя: человек эти подключения не отменял, и «вчера работало, сегодня
 * нет» он прочитает как поломку, а не как защиту.
 */
export function profileMatches(key: string): { ok: true } | { ok: false; connected: string; now: string } {
  load();
  const c = clients.find((x) => x.key === key);
  const profile = getActiveProfile();
  if (!c) return { ok: true }; // неподключённого остановит проверка выше
  if (!c.profileId) {
    c.profileId = profile.id;
    c.profileName = profile.name;
    save();
    return { ok: true };
  }
  if (c.profileId === profile.id) {
    // Имя могли поменять — держим его свежим, чтобы интерфейс не показывал старое.
    if (c.profileName !== profile.name) { c.profileName = profile.name; save(); }
    return { ok: true };
  }
  return { ok: false, connected: c.profileName ?? c.profileId, now: profile.name };
}

/** Белый список сайтов клиента. Пустой — без ограничений. */
export function domainsFor(key: string): string[] {
  load();
  return [...(clients.find((c) => c.key === key)?.domains ?? [])];
}

/**
 * Задать белый список.
 *
 * ⚠️ Правила нормализуем ЗДЕСЬ и молча выбрасываем негодные: человек пишет их руками, копируя
 * адрес целиком или с опечаткой, и падать на этом нельзя — иначе одна кривая строка стоит ему
 * всего списка. Что осталось, он видит в интерфейсе.
 */
export function setDomains(key: string, raw: readonly unknown[]): void {
  load();
  const c = clients.find((x) => x.key === key);
  if (!c) return;
  const seen = new Set<string>();
  for (const item of raw) {
    const rule = normalizeDomainRule(item);
    if (rule) seen.add(rule);
  }
  c.domains = [...seen];
  save();
}

export function stancesFor(key: string): Record<string, McpStance> {
  load();
  return clients.find((c) => c.key === key)?.stances ?? {};
}

export function touchClient(key: string): void {
  load();
  const c = clients.find((x) => x.key === key);
  if (!c) return;
  c.lastSeen = Date.now();
  save();
}

/**
 * Отозвать доступ.
 *
 * ⚠️ Выданные подтверждения на запись гасит ВЫЗЫВАЮЩИЙ (electron/ipc/mcp.ts), а не этот модуль,
 * и это не мелочь стиля: обратный порядок делал бы McpClients и McpConfirm взаимно
 * импортирующими друг друга. Цикл в main-процессе живёт тихо ровно до дня, когда в одном из
 * модулей появится работа на верхнем уровне.
 */
export function revokeClient(key: string): void {
  load();
  clients = clients.filter((c) => c.key !== key);
  denied.delete(key);
  // Висящий вопрос отключённой программы отвечать некому — снимаем.
  dropMcpPrompts();
  save();
}

/** Как поступать с инструментом у этой программы: спрашивать, разрешать молча или не давать. */
export function setStance(key: string, tool: string, stance: McpStance): void {
  load();
  const c = clients.find((x) => x.key === key);
  // ⚠️ Имя приводим к каноническому: интерфейс шлёт его из каталога, а прежние профили и клиенты
  // знают написание через точку (см. findTool). Хранить два ключа на один инструмент нельзя —
  // разойдутся ровно в тот момент, когда человек поменяет решение.
  const name = canonicalToolName(tool);
  if (!c || !MCP_TOOLS.some((t) => t.name === name)) return;
  c.stances = { ...c.stances, [name]: stance };
  save();
}

/**
 * Подключить программу задним числом — из журнала обращений в разделе «Агенты».
 *
 * ⚠️ Нужно потому, что вопрос задаётся не вовремя по самой природе дела: человек сидит в чужой
 * программе — оттуда он и спрашивает, — а карточка появляется в окне браузера, куда он в этот
 * момент не смотрит. Живой случай: карточку не увидели, агент ответил «не подключено», и фича
 * выглядела сломанной. Здесь человек видит, кто именно стучался, и подключает его сам.
 *
 * ⚠️ Это ТО ЖЕ САМОЕ согласие, а не обход карточки: решение принимает человек, в браузере, руками.
 * Разница только в моменте — не в секунду вызова, а когда он дошёл до окна.
 *
 * ⚠️ Имя программы НИЧЕМ НЕ ПОДТВЕРЖДЕНО (она назвалась им сама, см. mcpPolicy), и интерфейс
 * обязан говорить это рядом с кнопкой — иначе мы предлагаем доверять строке из чужого запроса.
 */
export function approveClient(key: string, label: string): void {
  load();
  const key0 = key.trim();
  if (key0 === '' || isApproved(key0)) return;
  const profile = getActiveProfile();
  clients = [...clients, {
    key: key0, label: label.trim() || key0, approvedAt: Date.now(), lastSeen: Date.now(),
    profileId: profile.id, profileName: profile.name, stances: {},
  }];
  // Пауза после прежнего отказа снимается: человек только что решил иначе, и его решение свежее.
  denied.delete(key0);
  save();
}

/**
 * Спросить человека про НОВУЮ программу.
 *
 * ⚠️ Один вопрос на клиента за раз и пауза после отказа — см. разбор в шапке. Здесь же
 * единственное место, где запись о клиенте появляется на диске: без нажатия «Подключить» её нет.
 */
export async function askToConnect(key: string, label: string): Promise<boolean> {
  load();
  if (isApproved(key)) return true;

  const until = denied.get(key) ?? 0;
  if (Date.now() < until) return false;

  let ask = asking.get(key);
  if (!ask) {
    ask = prompt(label).then((yes) => {
      asking.delete(key);
      if (!yes) {
        denied.set(key, Date.now() + DENY_COOLDOWN_MS);
        return false;
      }
      const profile = getActiveProfile();
      clients = [
        ...clients.filter((c) => c.key !== key),
        {
          key, label, approvedAt: Date.now(), lastSeen: Date.now(),
          profileId: profile.id, profileName: profile.name, stances: {},
        },
      ];
      save();
      return true;
    });
    asking.set(key, ask);
  }

  // ⚠️ Таймаут решает, что ответить программе, и НЕ закрывает окно (разбор — в McpConfirm.ts):
  // человек, подошедший к машине через пять минут, всё равно подключит клиента, а тот пройдёт
  // со следующей попытки. Без ответа вызов висел бы, пока не оборвётся сам клиент.
  const timeout = new Promise<boolean>((resolve) => { setTimeout(() => resolve(false), WAIT_MS); });
  return Promise.race([ask, timeout]);
}

async function prompt(label: string): Promise<boolean> {
  const read = MCP_TOOLS.filter((t) => t.mode === 'read').map((t) => `• ${t.title}`).join('\n');
  const res = await askMcp({
    kind: 'connect',
    client: label,
    title: 'Подключить программу?',
    // ⚠️ ПРОФИЛЬ НАЗЫВАЕТСЯ ПЕРВЫМ, и это не украшение вопроса. Человек отдаёт не «браузер», а
    // конкретный профиль со своими вкладками, историей и логинами: в рабочем это одно решение, в
    // личном — совсем другое. Не сказав, о каком идёт речь, мы получаем согласие не на то.
    detail:
      `Профиль «${getActiveProfile().name}»\n\n`
      + `Сможет без отдельного вопроса:\n${read}\n\n`
      + 'Изменения — открыть, переключить или закрыть вкладку — спрашиваются отдельно. '
      + 'Пароли, куки и приватные вкладки не отдаются вовсе. В других профилях программа '
      + 'отвечать не будет.',
    // ⚠️ У подключения «всегда» нет: сам ответ «Подключить» и есть решение навсегда, а вторая
    // кнопка с тем же смыслом читалась бы как «а эта — ещё сильнее?».
    canRemember: false,
  });
  return res.granted;
}

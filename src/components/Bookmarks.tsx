import { useEffect, useMemo, useState } from 'react';
import { X, Download, Loader2, Folder, Sparkles } from 'lucide-react';
import type { BookmarkEntry, BookmarkNode, BookmarkFolderProposal, BookmarkImportSource } from '../../shared/ipc';
import { islandPlate } from '../styles/island';
import { RADIUS, TEXT, motion, pad, sp } from '../styles/system';
import { GroupCap, Row, Rows, SideNav, SplitView, type LibrarySummary } from './library/kit';
import { btnGhost } from './settings/kit';
import SiteFavicon from './SiteFavicon';
import { EmptyState } from './EmptyState';
import { StarGlyph, SearchGlyph } from './glyphs';
import { sectionCache } from './library/sectionCache';

// Ссылка вместе с именем папки, в которой лежит — панель плоская, и без этого нельзя понять,
// откуда запись. null — корень.
type FlatBookmark = BookmarkEntry & { folderTitle: string | null };

interface BookmarksProps {
  /** Строка поиска — общая на всю библиотеку, живёт в оболочке (LibraryShell). */
  query: string;
  onSummary: (s: LibrarySummary) => void;
}

function domainOf(url: string): string {
  try { return new URL(url).hostname.replace(/^www\./, ''); } catch { return url; }
}

// Упрощённая копия History.tsx: без группировки по дням (закладки не хронология, порядок —
// position/id), без Qwen-«умного поиска» — список маленький, фильтр на клиенте достаточен,
// не нужен отдельный IPC-запрос на каждое нажатие.
// ⚠️ Последний показанный список — переживает размонтирование раздела и ЗАБЫВАЕТСЯ при смене
// профиля (разбор — в шапке library/sectionCache.ts).
const cachedFlat = sectionCache<FlatBookmark[]>([]);
const cachedTree = sectionCache<BookmarkNode[]>([]);

export default function Bookmarks({ query, onSummary }: BookmarksProps) {
  const [entries, setEntries] = useState<FlatBookmark[]>(cachedFlat.get);
  // Дерево держим рядом с плоским списком: колонка папок строится из него, а список — из
  // плоского. Один запрос, два представления — иначе счётчики разошлись бы с содержимым.
  const [tree, setTree] = useState<BookmarkNode[]>(cachedTree.get);
  const [folderId, setFolderId] = useState<number | null>(null);
  // Умная раскладка. 'idle' → 'computing' → 'preview'. ⚠️ Между computing и применением стоит
  // ЯВНОЕ согласие человека: раскладка не применяется сама ни при каком исходе.
  const [organize, setOrganize] = useState<'idle' | 'computing' | 'preview'>('idle');
  const [proposals, setProposals] = useState<BookmarkFolderProposal[]>([]);
  // Папки, от которых человек отказался прямо в предложении: применяем только оставшиеся.
  const [dropped, setDropped] = useState<Set<string>>(new Set());
  // Импорт из других браузеров (Feature 2) — открытый дропдаун со списком РЕАЛЬНО найденных на
  // диске источников (см. electron/bookmarkImport/), тот же паттерн, что clearOpen в History.tsx.
  const [importOpen, setImportOpen] = useState(false);
  const [importSources, setImportSources] = useState<BookmarkImportSource[]>([]);
  const [importingId, setImportingId] = useState<string | null>(null);
  const [importMessage, setImportMessage] = useState<string | null>(null);

  // ⚠️ Читаем ДЕРЕВО и раскладываем в плоский список ссылок, а не берём корень через
  // listBookmarks(). Иначе закладка, убранная в папку из сайдбара, пропадала бы из этой панели
  // совсем — а она тут архив и поиск по всему, что сохранено. Сами папки строками не рисуем:
  // эта панель отвечает на вопрос «где я это сохранял», а не «как разложено».
  const load = async () => {
    const roots = await window.oblako.listBookmarkTree();
    const flat: FlatBookmark[] = [];
    const walk = (nodes: BookmarkNode[], folder: string | null): void => {
      for (const n of nodes) {
        if (n.kind === 'folder') walk(n.children ?? [], n.title);
        else flat.push({ ...n, folderTitle: folder });
      }
    };
    walk(roots, null);
    cachedTree.set(roots);
    cachedFlat.set(flat);
    setTree(roots);
    setEntries(flat);
  };

  useEffect(() => { void load(); }, []);
  // Мутация где угодно (например, звезду сняли прямо в омнибоксе, пока эта панель открыта) —
  // перечитываем список.
  useEffect(() => window.oblako.onBookmarksChanged(() => void load()), []);

  const searching = query.trim().length > 0;

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return entries;
    return entries.filter((e) => e.title.toLowerCase().includes(q) || e.url.toLowerCase().includes(q));
  }, [entries, query]);

  // Содержимое выбранной папки. null — «Все закладки», то есть весь сейф целиком: раздел это
  // архив, и ответ на «где-то у меня это было» должен находиться без хождения по папкам.
  const visible = useMemo(
    () => (folderId === null ? entries : entries.filter((e) => e.parentId === folderId)),
    [entries, folderId],
  );

  // Быстрый доступ по id — предложение раскладки приходит номерами, а показать надо названия.
  const byId = useMemo(() => new Map(entries.map((e) => [e.id, e])), [entries]);
  // Кнопка раскладки нужна, только когда есть что раскладывать: разбираем корень.
  const rootLinkCount = useMemo(() => entries.filter((e) => e.parentId === null).length, [entries]);

  // Плоский перечень папок с отступами и счётчиками. Считается из того же дерева, что и список:
  // второй источник правды здесь означал бы расхождение счётчиков с содержимым.
  const folderNav = useMemo(() => {
    const out: { id: number; title: string; depth: number; count: number }[] = [];
    const walk = (nodes: BookmarkNode[], depth: number): void => {
      for (const n of nodes) {
        if (n.kind !== 'folder') continue;
        // Считаем ТОЛЬКО прямые ссылки: цифра рядом с папкой должна совпадать с тем, что
        // человек увидит, кликнув по ней, — иначе она врёт про вложенные.
        out.push({
          id: n.id, title: n.title, depth,
          count: (n.children ?? []).filter((c) => c.kind === 'link').length,
        });
        walk(n.children ?? [], depth + 1);
      }
    };
    walk(tree, 0);
    return out;
  }, [tree]);

  async function handleDelete(id: number) {
    await window.oblako.removeBookmark(id);
    void load();
  }

  // ⚠️ Удаление папки уносит ВСЁ её содержимое (CASCADE в схеме) и отменить это нечем —
  // спрашиваем прямо, с числом закладок внутри. Молча тут не делается ничего.
  async function handleDeleteFolder(id: number, title: string, count: number) {
    const what = count > 0 ? ` вместе с ${count} закладками` : '';
    if (!window.confirm(`Удалить папку «${title}»${what}? Это действие нельзя отменить.`)) return;
    if (folderId === id) setFolderId(null);
    await window.oblako.removeBookmark(id);
    void load();
  }

  async function runOrganize() {
    setOrganize('computing');
    setDropped(new Set());
    const result = await window.oblako.suggestBookmarkFolders().catch(() => []);
    setProposals(result);
    setOrganize('preview');
  }

  async function applyOrganize() {
    const keep = proposals.filter((p) => !dropped.has(p.label));
    setOrganize('idle');
    if (keep.length === 0) return;
    await window.oblako.applyBookmarkFolders(keep);
    void load();
  }

  async function toggleImport() {
    if (importOpen) { setImportOpen(false); return; }
    setImportOpen(true);
    setImportMessage(null);
    setImportSources(await window.oblako.listBookmarkImportSources());
  }

  async function handleImport(source: BookmarkImportSource) {
    if (importingId) return; // уже что-то импортируется — второй клик игнорируем
    setImportingId(source.id);
    setImportMessage(null);
    try {
      const result = await window.oblako.runBookmarkImport(source.id);
      setImportMessage(
        result
          ? `${source.label}: добавлено ${result.inserted}, пропущено (уже были) ${result.skipped}`
          : `${source.label}: импорт не удался`,
      );
      void load(); // BOOKMARK_CHANGED тоже перечитает, но не ждём push ради мгновенного отклика
    } finally {
      setImportingId(null);
    }
  }

  // ⚠️ Сводка считается здесь, из уже загруженного дерева: все числа честные, дополнительных
  // запросов не нужно (в отличие от истории, которая приходит страницами).
  const rootless = entries.filter((e) => e.folderTitle === null).length;
  const monthAgo = Date.now() - 30 * 86_400_000;
  const freshCount = entries.filter((e) => (e.createdAt ?? 0) > monthAgo).length;
  const biggest = folderNav.reduce<{ title: string; count: number } | null>(
    (best, f) => (best === null || f.count > best.count ? { title: f.title, count: f.count } : best), null);
  useEffect(() => {
    onSummary({
      hero: entries.length === 0 ? '—' : String(entries.length),
      heroLabel: entries.length === 0
        ? 'вы пока ничего не сохранили'
        : `сохранено · в ${folderNav.length} ${plural(folderNav.length, 'папке', 'папках', 'папках')}, ${rootless} без папки`,
      facts: [
        { label: 'Всего', hint: 'ссылок в сейфе', value: String(entries.length), active: entries.length > 0 },
        { label: 'Папок', hint: biggest ? `самая большая — «${biggest.title}»` : 'папок пока нет', value: String(folderNav.length), active: folderNav.length > 0 },
        { label: 'Без папки', hint: 'лежат в общей куче', value: String(rootless) },
        { label: 'За месяц', hint: 'добавлено новых', value: String(freshCount), active: freshCount > 0 },
      ],
    });
  }, [onSummary, entries.length, folderNav.length, rootless, freshCount, biggest?.title]);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: sp(3) }}>
      {/* Управление разделом. Крестика тут больше нет — он один и стоит в шапке библиотеки. */}
      <div style={{ display: 'flex', alignItems: 'center', gap: sp(2), flexWrap: 'wrap', position: 'relative' }}>
        <span style={{ flex: 1 }} />
        <button
          onClick={() => void toggleImport()}
          style={{ ...btnGhost, display: 'inline-flex', alignItems: 'center', gap: sp(2) }}
        ><Download size={14} /> Импортировать</button>
        {importOpen && (
          <div style={{
            position: 'absolute', top: 40, right: 0, zIndex: 200, minWidth: 210,
            ...islandPlate, borderRadius: RADIUS.box, overflow: 'hidden',
          }}>
            {importSources.length === 0 ? (
              <div style={{ padding: pad(2, 3), ...TEXT.body, color: 'var(--text-muted)' }}>
                Ни один браузер не найден
              </div>
            ) : importSources.map((source) => (
              <button
                key={source.id}
                onClick={() => void handleImport(source)}
                disabled={importingId !== null}
                style={{
                  display: 'flex', alignItems: 'center', gap: sp(2), width: '100%', textAlign: 'left',
                  padding: pad(2, 3), background: 'none', border: 'none', cursor: 'default',
                  ...TEXT.body, color: 'var(--text-body)',
                  transition: motion.hover('background'),
                }}
                onMouseEnter={(e) => { if (!importingId) e.currentTarget.style.background = 'var(--surface-hover)'; }}
                onMouseLeave={(e) => { e.currentTarget.style.background = 'none'; }}
              >
                {importingId === source.id && <Loader2 size={13} style={{ animation: 'oblako-spin 1s linear infinite' }} />}
                {source.label}
              </button>
            ))}
          </div>
        )}
      </div>

      {importMessage && (
        <div style={{
          display: 'flex', alignItems: 'center', gap: sp(2), ...TEXT.body, color: 'var(--text-muted)',
        }}>
          {importMessage}
          <button onClick={() => setImportMessage(null)} style={{
            marginLeft: 'auto', background: 'none', border: 'none', cursor: 'default',
            color: 'inherit', display: 'flex', padding: 2,
          }}><X size={12} /></button>
        </div>
      )}

      {/* ⚠️ При поиске колонка папок ПРЯЧЕТСЯ: искать положено по всему сейфу, а не внутри
          выбранной папки, иначе найденное молча зависит от того, что выбрано слева. */}
      {searching ? (
        filtered.length === 0 ? (
          <EmptyState
            icon={<SearchGlyph size={22} />}
            title="Ничего не нашлось"
            hint="Поиск смотрит по названию закладки и по адресу — и всегда по всему сейфу, а не внутри выбранной папки."
          />
        ) : (
          <Rows>
            <GroupCap title="Найдено" note={`${filtered.length} ${plural(filtered.length, 'ссылка', 'ссылки', 'ссылок')}`} />
            {filtered.map((entry) => (
              <BookmarkRow key={entry.id} entry={entry} onDelete={handleDelete} />
            ))}
          </Rows>
        )
      ) : (
        <SplitView side={(
          <div style={{ width: 172, flex: 'none', display: 'flex', flexDirection: 'column', gap: sp(2) }}>
            <SideNav
              caption="папки"
              activeKey={folderId === null ? 'all' : String(folderId)}
              items={[
                { key: 'all', label: 'Все закладки', note: String(entries.length) },
                ...folderNav.map((f) => ({ key: String(f.id), label: f.title, note: String(f.count), removable: true })),
              ]}
              onPick={(key) => setFolderId(key === 'all' ? null : Number(key))}
              onRemove={(key) => {
                const f = folderNav.find((x) => String(x.id) === key);
                if (f) void handleDeleteFolder(f.id, f.title, f.count);
              }}
            />
            {/* Умная раскладка живёт ЗДЕСЬ, в колонке папок, а не в шапке: она про то, какие
                папки будут, то есть про эту колонку. Кнопки нет, пока раскладывать нечего. */}
            {rootLinkCount >= 4 && (
              <button
                onClick={() => void runOrganize()}
                disabled={organize === 'computing'}
                style={{ ...btnGhost, display: 'inline-flex', alignItems: 'center', gap: sp(2), justifyContent: 'center' }}
              >
                <Sparkles size={13} strokeWidth={2} />
                {organize === 'computing' ? 'Разбираю…' : 'Разложить по папкам'}
              </button>
            )}
          </div>
        )}>
          {organize === 'preview' ? (
            <OrganizePreview
              proposals={proposals} dropped={dropped} setDropped={setDropped}
              byId={byId}
              onApply={() => void applyOrganize()}
              onCancel={() => setOrganize('idle')}
            />
          ) : visible.length === 0 ? (
            <EmptyState
              icon={<StarGlyph size={22} />}
              title={folderId === null ? 'Закладок пока нет' : 'В этой папке пусто'}
              hint="Звёздочка в адресной строке сохраняет страницу сюда."
            />
          ) : (
            <Rows>
              <GroupCap
                title={folderId === null ? 'Все закладки' : (folderNav.find((f) => f.id === folderId)?.title ?? 'Папка')}
                note={`${visible.length} ${plural(visible.length, 'ссылка', 'ссылки', 'ссылок')}`}
              />
              {visible.map((entry) => (
                <BookmarkRow key={entry.id} entry={entry} onDelete={handleDelete} />
              ))}
            </Rows>
          )}
        </SplitView>
      )}
    </div>
  );
}

/** Русское склонение: 1 ссылка, 2 ссылки, 5 ссылок. */
function plural(n: number, one: string, few: string, many: string): string {
  const mod100 = n % 100;
  if (mod100 >= 11 && mod100 <= 14) return many;
  const mod10 = n % 10;
  if (mod10 === 1) return one;
  if (mod10 >= 2 && mod10 <= 4) return few;
  return many;
}

// Предложение раскладки. ⚠️ Ничего ещё не применено: пока человек не нажал «Разложить», в базе
// не изменилось ни строки. Каждую папку можно выкинуть из предложения по отдельности — иначе
// выбор был бы «всё или ничего», и одна неудачная папка отменяла бы девять удачных.
function OrganizePreview({ proposals, dropped, setDropped, byId, onApply, onCancel }: {
  proposals: BookmarkFolderProposal[];
  dropped: Set<string>;
  setDropped: (s: Set<string>) => void;
  byId: Map<number, FlatBookmark>;
  onApply: () => void;
  onCancel: () => void;
}) {
  const keep = proposals.filter((p) => !dropped.has(p.label));
  const total = keep.reduce((n, p) => n + p.ids.length, 0);

  if (proposals.length === 0) {
    return (
      <div style={{ paddingTop: 24 }}>
        <Empty text="Осмысленных папок не нашлось — закладки слишком разные. Это нормальный исход." />
        <div style={{ display: 'flex', justifyContent: 'center', marginTop: 12 }}>
          <button onClick={onCancel} style={GHOST_BTN}>Закрыть</button>
        </div>
      </div>
    );
  }

  return (
    <div style={{ paddingTop: 12 }}>
      <div style={{ fontSize: 'var(--fs-sm)', color: 'var(--text-muted)', marginBottom: 12 }}>
        Предложение: {keep.length} {keep.length === 1 ? 'папка' : keep.length < 5 ? 'папки' : 'папок'},
        {' '}{total} закладок. Ничего ещё не изменено — папки создадутся только по кнопке ниже.
      </div>

      {proposals.map((p) => {
        const off = dropped.has(p.label);
        return (
          <div key={p.label} style={{
            border: '1px solid var(--divider-strong)', borderRadius: 'var(--radius-sm)',
            marginBottom: 8, overflow: 'hidden', opacity: off ? 0.45 : 1,
          }}>
            <div style={{
              display: 'flex', alignItems: 'center', gap: 8,
              padding: '7px 10px', background: 'var(--surface-hover)',
            }}>
              <Folder size={13} strokeWidth={2} style={{ flexShrink: 0, color: 'var(--text-muted)' }} />
              <span style={{ flex: 1, fontSize: 'var(--fs-sm)', fontWeight: 600, color: 'var(--text-strong)' }}>
                {p.label}
              </span>
              <span style={{ fontSize: 'var(--fs-xs)', color: 'var(--text-faint)' }}>{p.ids.length}</span>
              <button
                onClick={() => {
                  const next = new Set(dropped);
                  if (off) next.delete(p.label); else next.add(p.label);
                  setDropped(next);
                }}
                style={{ ...GHOST_BTN, padding: '2px 8px', fontSize: 'var(--fs-xs)' }}
              >{off ? 'Вернуть' : 'Не надо'}</button>
            </div>
            <div style={{ padding: '4px 10px 8px' }}>
              {p.ids.map((id) => (
                <div key={id} style={{
                  fontSize: 'var(--fs-xs)', color: 'var(--text-muted)', padding: '2px 0',
                  whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
                }}>
                  {byId.get(id)?.title || byId.get(id)?.url || `#${id}`}
                </div>
              ))}
            </div>
          </div>
        );
      })}

      <div style={{ display: 'flex', gap: 8, marginTop: 12 }}>
        <button
          onClick={onApply}
          disabled={keep.length === 0}
          style={{
            padding: '7px 14px', borderRadius: 'var(--radius-sm)', border: 'none',
            background: keep.length ? 'var(--accent)' : 'var(--surface-hover)',
            color: keep.length ? 'var(--on-accent)' : 'var(--text-faint)',
            fontSize: 'var(--fs-sm)', fontWeight: 600, cursor: 'default',
          }}
        >Разложить</button>
        <button onClick={onCancel} style={GHOST_BTN}>Отмена</button>
      </div>
    </div>
  );
}

const GHOST_BTN: React.CSSProperties = {
  padding: '7px 14px', borderRadius: 'var(--radius-sm)',
  border: '1px solid var(--divider-strong)', background: 'transparent',
  color: 'var(--text-body)', fontSize: 'var(--fs-sm)', cursor: 'default',
};

// Пустое состояние закладок. ⚠️ Подсказка зависит от того, ПОЧЕМУ пусто: не найдено по запросу,
// пусто в папке или закладок нет вовсе — это три разные ситуации и три разных следующих шага.
function Empty({ text }: { text: string }) {
  const searching = text === 'Ничего не найдено';
  const inFolder = text === 'В этой папке пусто';
  return (
    <EmptyState
      icon={searching ? <SearchGlyph size={22} /> : <StarGlyph size={22} />}
      title={searching ? 'Ничего не нашлось' : inFolder ? 'В этой папке пусто' : 'Закладок пока нет'}
      hint={searching
        ? 'Поиск идёт по названию и адресу — попробуйте другое слово.'
        : inFolder
          ? 'Перетащите сюда закладку из другой папки или добавьте новую звёздочкой в адресной строке.'
          : 'Звёздочка в адресной строке сохранит страницу сюда, а папку под неё браузер предложит сам.'}
    />
  );
}

// Строка навигации по папкам — визуально та же, что строка даты в Истории. Отступ показывает
// вложенность: дерево тут плоское списком, потому что папок у человека десятки, а не тысячи,
// и раскрывающиеся уровни в колонке 170 px читались бы хуже, чем один сплошной перечень.
function BookmarkRow({ entry, onDelete }: { entry: FlatBookmark; onDelete: (id: number) => void }) {
  return (
    <Row
      icon={<SiteFavicon url={entry.url} size={22} />}
      title={entry.title || entry.url}
      subtitle={domainOf(entry.url)}
      // Папка — отдельной правой колонкой. Раньше она стояла В ОДНОЙ строке с заголовком и
      // доменом: три разные вещи слипались в одну серую строку, и заголовок терял ширину.
      // У корневых закладок метки нет вовсе — пустой значок папки только шумел бы.
      meta={entry.folderTitle ? (
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
          <Folder size={11} strokeWidth={2} style={{ flexShrink: 0 }} />
          {entry.folderTitle}
        </span>
      ) : undefined}
      title2={entry.url}
      onClick={() => { void window.oblako.createTab(entry.url); }}
      actions={(
        <button
          onClick={(e) => { e.stopPropagation(); onDelete(entry.id); }}
          title="Удалить из закладок"
          style={{
            display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
            width: 26, height: 26, border: 'none', borderRadius: RADIUS.control,
            background: 'transparent', color: 'var(--text-faint)', cursor: 'default',
          }}
          onMouseEnter={(e) => { e.currentTarget.style.background = 'var(--surface-sunken)'; e.currentTarget.style.color = 'var(--text-body)'; }}
          onMouseLeave={(e) => { e.currentTarget.style.background = 'transparent'; e.currentTarget.style.color = 'var(--text-faint)'; }}
        ><X size={14} /></button>
      )}
    />
  );
}

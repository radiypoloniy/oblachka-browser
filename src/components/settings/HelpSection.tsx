import { useMemo, useState } from 'react';
import { CAPS, MEASURE, RADIUS, TEXT, motion, sp } from '../../styles/system';
import { CapsLabel, Read, SectionHeader, Subsection, TextField } from './kit';
import { HELP_GROUPS, HELP_KEYS, HELP_LEDGER, HELP_TOTAL, type HelpItem } from './helpContent';
import { useLanguage } from '../../i18n';

// ── Раздел «Справка»: что умеет браузер, одним списком ────────────────────────
//
// ⚠️ Раздел ПОСЛЕДНИЙ в меню и намеренно: он ничего не настраивает. Все остальные разделы
// отвечают на вопрос «как это включить», справка — на вопрос «а что тут вообще есть», и её
// открывают один-два раза за всё время. Ставить её выше значило бы двигать вниз то, чем
// пользуются каждую неделю.
//
// ⚠️ У раздела СВОЙ поиск, отдельный от строки вверху панели. Та ищет по реестру настроек
// (shared/settingsIndex.ts) и приводит к нужному блоку; здесь же ищется по описаниям функций —
// разные вопросы. Слить их в одну строку нельзя: находка «Ctrl+Shift+M» из справки не открывает
// никакой настройки, а находка «Поиск по умолчанию» — не объясняет, что это.
//
// ⚠️ Текст лежит в helpContent.ts, здесь только вёрстка. Разбор — в шапке того файла.

/** Клавиша аккорда. Моноширинная, с кромкой: глаз отличает её от обычного текста без подписи. */
function Key({ children }: { children: React.ReactNode }) {
  return (
    <span style={{
      fontFamily: 'var(--font-mono)', fontSize: TEXT.caption.fontSize, fontWeight: 500,
      padding: `2px ${sp(2)}px`, borderRadius: RADIUS.tight,
      border: '1px solid var(--divider-strong)',
      color: 'var(--text-strong)', whiteSpace: 'nowrap',
    }}>{children}</span>
  );
}

/** Правая колонка строки: аккорд клавиш, место в интерфейсе или пометка «локально». */
function ItemMeta({ item }: { item: HelpItem }) {
  const { t } = useLanguage();
  if (item.keys) {
    return (
      <div style={{ display: 'flex', gap: sp(1), alignItems: 'center', flexWrap: 'wrap', justifyContent: 'flex-end' }}>
        {item.keys.map((k) => <Key key={k}>{k}</Key>)}
      </div>
    );
  }
  const label = t(item.where ?? (item.mark === 'local' ? 'локально' : 'наружу'));
  return (
    <span style={{
      ...TEXT.caption, color: 'var(--text-faint)', textAlign: 'right',
      // ⚠️ Пометка про локальность набирается моношринной: это ярлык, а не фраза, и в столбце
      // из семидесяти строк он обязан читаться как одно и то же слово, а не как продолжение текста.
      ...(item.where ? {} : { fontFamily: 'var(--font-mono)', letterSpacing: '0.04em' }),
    }}>{label}</span>
  );
}

/** Строка функции: название, что делает, где найти. */
function HelpRow({ item }: { item: HelpItem }) {
  const { t } = useLanguage();
  return (
    <div style={{
      display: 'grid', gridTemplateColumns: 'minmax(0, 1fr) auto',
      gap: sp(4), alignItems: 'start',
      padding: `${sp(3)}px 0`,
      borderTop: '1px solid var(--divider)',
    }}>
      <div>
        <div style={{ ...TEXT.body, fontWeight: 600, color: 'var(--text-strong)' }}>{t(item.name)}</div>
        <div style={{ ...TEXT.body, color: 'var(--text-muted)', maxWidth: MEASURE, marginTop: sp(1) }}>
          {t(item.desc)}
        </div>
      </div>
      <ItemMeta item={item} />
    </div>
  );
}

/** Таблица клавиш: одна группа. */
function KeyBlock({ title, rows }: { title: string; rows: { keys: string[]; what: string }[] }) {
  const { t } = useLanguage();
  return (
    <div>
      <CapsLabel>{t(title)}</CapsLabel>
      <div style={{ display: 'flex', flexDirection: 'column' }}>
        {rows.map((r) => (
          <div key={r.what} style={{
            display: 'grid', gridTemplateColumns: '160px minmax(0, 1fr)', gap: sp(4),
            alignItems: 'center', padding: `${sp(2)}px 0`, borderTop: '1px solid var(--divider)',
          }}>
            <div style={{ display: 'flex', gap: sp(1) }}>{r.keys.map((k) => <Key key={k}>{k}</Key>)}</div>
            <div style={{ ...TEXT.body, color: 'var(--text-muted)' }}>{t(r.what)}</div>
          </div>
        ))}
      </div>
    </div>
  );
}

/**
 * Колонка реестра «что уходит наружу».
 *
 * ⚠️ Точка статуса и НИКАКОЙ заливки — цветовой закон: заливка означает «выбрано», а здесь
 * ничего не выбирают. Зелёное, оранжевое и красное живут значком и словом.
 */
function LedgerColumn({ title, kind, items }: { title: string; kind: 'local' | 'outside' | 'never'; items: string[] }) {
  const { t } = useLanguage();
  const dot = kind === 'local' ? 'var(--success-500)' : kind === 'outside' ? 'var(--warning-500)' : 'var(--danger-500)';
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: sp(2), minWidth: 0 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: sp(2) }}>
        <span style={{ width: 8, height: 8, borderRadius: RADIUS.pill, flex: 'none', background: dot }} />
        <span style={{ ...TEXT.body, fontWeight: 600, color: 'var(--text-strong)' }}>{t(title)}</span>
      </div>
      {items.map((line) => (
        <div key={line} style={{ ...TEXT.caption, color: 'var(--text-muted)', paddingLeft: sp(4) }}>{t(line)}</div>
      ))}
    </div>
  );
}

export default function HelpSection() {
  const { t } = useLanguage();
  const [query, setQuery] = useState('');

  // Фильтр по всем полям строки разом: человек ищет и по названию («сплит»), и по описанию
  // («kill switch»), и по клавише («Ctrl+E»). Английский ищет по переводу тех же полей.
  const groups = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return HELP_GROUPS;
    const words = q.split(/\s+/);
    return HELP_GROUPS
      .map((g) => ({
        ...g,
        items: g.items.filter((it) => {
          const hay = `${it.name} ${it.desc} ${it.where ?? ''} ${t(it.name)} ${t(it.desc)} ${t(it.where ?? '')} ${(it.keys ?? []).join('+')}`.toLowerCase();
          return words.every((w) => hay.includes(w));
        }),
      }))
      .filter((g) => g.items.length > 0);
  }, [query, t]);

  const found = groups.reduce((n, g) => n + g.items.length, 0);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: sp(2) }}>
      <SectionHeader title={t('Справка')} hero={HELP_TOTAL} heroLabel={t('функций в браузере')}>
        {t('Всё, что умеет Oblako, одним списком: что делает функция, где её найти и на какой клавише она живёт. Раздел ничего не настраивает — он отвечает на вопрос «а что тут вообще есть».')}
      </SectionHeader>

      <Read>
        <TextField
          value={query}
          onChange={setQuery}
          placeholder={t('Найти функцию: «сплит», «пароли», «перевод»…')}
        />
      </Read>

      {query.trim() !== '' && (
        <div style={{ ...CAPS }}>{found === 0 ? t('Ничего не нашлось') : t('Найдено: {n}', { n: found })}</div>
      )}

      {groups.map((g) => (
        <Subsection key={g.title} blockId={g.title} title={t(g.title)} description={t(g.description)}>
          <div style={{ display: 'flex', flexDirection: 'column' }}>
            {g.items.map((it) => <HelpRow key={it.name} item={it} />)}
          </div>
        </Subsection>
      ))}

      {/* Клавиши и реестр не фильтруются вместе со списком: это справочные таблицы, а не
          функции. Прятать их при поиске значило бы терять ответ на «а какая там клавиша». */}
      <Subsection
        blockId="Горячие клавиши"
        title={t('Горячие клавиши')}
        description={t('Спорные аккорды намеренно оставлены странице: в Google Таблицах Ctrl+D — «заполнить вниз», и браузер не имеет права это отбирать.')}
      >
        <div style={{ display: 'flex', flexDirection: 'column', gap: sp(6) }}>
          {HELP_KEYS.map((k) => <KeyBlock key={k.title} title={k.title} rows={k.rows} />)}
        </div>
      </Subsection>

      <Subsection
        blockId="Что уходит наружу"
        title={t('Что уходит наружу')}
        description={t('Честная формулировка: не «ИИ только локальный», а «локальный там, где речь о вас». Телеметрии нет вообще, шрифты вшиты в приложение.')}
      >
        <div style={{
          display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))', gap: sp(6),
        }}>
          {HELP_LEDGER.map((c) => <LedgerColumn key={c.title} title={c.title} kind={c.kind} items={c.items} />)}
        </div>
      </Subsection>

      <div style={{ ...CAPS, paddingTop: sp(6), transition: motion.state('color') }}>
        {t('Oblako · Windows x64 · телеметрии нет')}
      </div>
    </div>
  );
}

import { useCallback, useEffect, useState } from 'react';
import { Zap, Trash2, Download, Plus, Wand2 } from 'lucide-react';
import { StatusCard, btnPrimary, btnGhost, TextField, InputRow, fieldFlex, InlineError, InlineHint, CapsLabel } from './kit';
import type { BangsSnapshot, BangDefWire, DerivedBangCandidate } from '../../../shared/ipc';

// Блок «Бэнги» раздела «Браузер». Только рисует то, что прислал main (см. CLAUDE.md): разбор
// строки и хранилище живут в electron/BangStore.ts + shared/bangs.ts, здесь — список и форма.

export default function BangsBlock() {
  const [snap, setSnap] = useState<BangsSnapshot | null>(null);
  const [key, setKey] = useState('');
  const [name, setName] = useState('');
  const [template, setTemplate] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [importing, setImporting] = useState(false);
  const [importNote, setImportNote] = useState<string | null>(null);
  // null — распознавание ещё не запускали (показываем кнопку), [] — запускали и не нашли.
  const [found, setFound] = useState<DerivedBangCandidate[] | null>(null);

  async function detect() {
    setFound(await window.oblako.deriveBangsFromTabs());
  }

  const reload = useCallback(() => { void window.oblako.listBangs().then(setSnap); }, []);
  useEffect(reload, [reload]);

  async function add() {
    setError(null);
    const reason = await window.oblako.upsertBang({ key, name, template } as BangDefWire);
    if (reason) { setError(reason); return; }
    setKey(''); setName(''); setTemplate('');
    reload();
  }

  async function remove(k: string) {
    await window.oblako.removeBang(k);
    reload();
  }

  async function importDdg() {
    setImporting(true);
    setImportNote(null);
    const res = await window.oblako.importDuckDuckGoBangs();
    setImporting(false);
    setImportNote(res.ok ? `Импортировано ${res.imported}` : (res.error ?? 'Не удалось импортировать'));
    reload();
  }

  async function clearImported() {
    await window.oblako.clearImportedBangs();
    setImportNote(null);
    reload();
  }

  if (!snap) return null;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
      <InlineHint>
        Введите в адресной строке «!yt котики» — запрос уйдёт сразу на YouTube, минуя поисковик.
        Бэнг можно ставить и в конце: «котики !yt». Один «!ключ» без запроса открывает главную сайта.
      </InlineHint>

      {/* Свои бэнги */}
      {snap.user.length > 0 && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          <CapsLabel>Свои</CapsLabel>
          {snap.user.map((b) => (
            <StatusCard
              key={b.key}
              icon={<Zap size={18} style={{ color: 'var(--accent)' }} />}
              title={`!${b.key} — ${b.name}`}
              subtitle={b.template}
              actions={
                <button style={btnGhost} onClick={() => void remove(b.key)} title="Удалить бэнг">
                  <Trash2 size={14} />
                </button>
              }
            />
          ))}
        </div>
      )}

      {/* Заготовки из открытых вкладок — главный способ добавить бэнг без возни с URL */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        <CapsLabel>Взять из открытой вкладки</CapsLabel>
        {found === null ? (
          <StatusCard
            icon={<Wand2 size={18} style={{ color: 'var(--accent)' }} />}
            title="Распознать поиск на открытых сайтах"
            subtitle="Откройте сайт, выполните на нём любой поиск — и браузер сам составит шаблон по адресу результатов."
            actions={<button style={btnPrimary} onClick={() => void detect()}>Распознать</button>}
          />
        ) : found.length === 0 ? (
          <InlineHint>
            Среди открытых вкладок поиска не нашлось. Откройте нужный сайт, найдите на нём
            что-нибудь и нажмите «Распознать» ещё раз.{' '}
            <span style={{ cursor: 'default', textDecoration: 'underline' }} onClick={() => setFound(null)}>Скрыть</span>
          </InlineHint>
        ) : (
          found.map((c) => (
            <StatusCard
              key={c.template}
              icon={<Wand2 size={18} style={{ color: 'var(--accent)' }} />}
              title={`${c.name} — параметр «${c.param}»`}
              subtitle={c.template}
              actions={
                <button style={btnPrimary} onClick={() => {
                  // Не сохраняем сразу: человек должен увидеть ключ и при желании сократить его
                  // («overgear» → «og») до того, как бэнг появится в списке.
                  setKey(c.key); setName(c.name); setTemplate(c.template); setError(null); setFound(null);
                }}>
                  Заполнить
                </button>
              }
            />
          ))
        )}
      </div>

      {/* Форма добавления */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        <CapsLabel>Добавить свой</CapsLabel>
        <InputRow>
          <TextField value={key} onChange={setKey} placeholder="ключ, напр. og" style={{ flex: '0 1 140px' }} />
          <TextField value={name} onChange={setName} placeholder="название, напр. Overgear" style={fieldFlex} />
        </InputRow>
        <InputRow>
          <TextField
            value={template}
            onChange={setTemplate}
            placeholder="https://overgear.com/search?q={query}"
            style={fieldFlex}
          />
          <button style={btnPrimary} onClick={() => void add()} disabled={!key || !template}>
            <Plus size={14} style={{ marginRight: 6, verticalAlign: -2 }} />
            Добавить
          </button>
        </InputRow>
        {error && <InlineError>{error}</InlineError>}
        <InlineHint>
          В шаблоне обязателен {'{query}'} — на это место подставится запрос. Адрес можно взять из
          строки браузера, выполнив поиск на нужном сайте.
        </InlineHint>
      </div>

      {/* Импорт готового набора */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        <CapsLabel>Готовый набор</CapsLabel>
        <StatusCard
          icon={<Download size={18} style={{ color: 'var(--text-muted)' }} />}
          title={snap.importedCount > 0 ? `Набор DuckDuckGo: ${snap.importedCount}` : 'Набор DuckDuckGo'}
          subtitle={
            snap.importedCount > 0
              ? 'Свои и встроенные бэнги всё равно имеют приоритет над импортированными.'
              : 'Несколько тысяч готовых бэнгов. Скачивается в ваш профиль, в приложение не входит.'
          }
          actions={
            <div style={{ display: 'flex', gap: 8 }}>
              {snap.importedCount > 0 && (
                <button style={btnGhost} onClick={() => void clearImported()}>Удалить</button>
              )}
              <button style={btnPrimary} onClick={() => void importDdg()} disabled={importing}>
                {importing ? 'Загрузка…' : snap.importedCount > 0 ? 'Обновить' : 'Скачать'}
              </button>
            </div>
          }
        />
        {importNote && <InlineHint>{importNote}</InlineHint>}
      </div>

      {/* Встроенные — только для справки, менять их нельзя */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
        <CapsLabel>Встроенные</CapsLabel>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
          {snap.builtin.map((b) => (
            <span
              key={b.key}
              title={`${b.name} — ${b.template}`}
              style={{
                fontSize: 'var(--fs-xs)', color: 'var(--text-muted)',
                padding: '3px 8px', borderRadius: 'var(--radius-sm)',
                background: 'var(--surface-sunken)', fontFamily: 'var(--font-mono)',
              }}
            >
              !{b.key}
            </span>
          ))}
        </div>
      </div>
    </div>
  );
}

import { useCallback, useEffect, useState } from 'react';
import { Trash2, Download, Plus, Wand2, Zap } from 'lucide-react';
import {
  btnPrimary, btnGhost, TextField, InputRow, fieldFlex, InlineError, InlineHint, CapsLabel,
  SpotCard, InkFrame, MonoChip, FactGrid, Fact,
} from './kit';
import { sp } from '../../styles/system';
import type { BangsSnapshot, BangDefWire, DerivedBangCandidate } from '../../../shared/ipc';

// Блок «Бэнги» раздела «Браузер». Только рисует то, что прислал main: разбор строки и
// хранилище живут в electron/BangStore.ts + shared/bangs.ts.

export default function BangsBlock() {
  const [snap, setSnap] = useState<BangsSnapshot | null>(null);
  const [key, setKey] = useState('');
  const [name, setName] = useState('');
  const [template, setTemplate] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [importing, setImporting] = useState(false);
  const [importNote, setImportNote] = useState<string | null>(null);
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
    <div style={{ display: 'flex', flexDirection: 'column', gap: sp(4) }}>
      {/* ⚠️ Сводка плитками, а не абзацем. Блок стоит посреди цветных разделов, и до неё он
          читался канцелярией: три подписи, поле ввода и стопка серых строк. Четыре факта
          отвечают на то, ради чего сюда заходят, — «сколько их и что писать в строке». */}
      <FactGrid>
        <Fact
          label="Свои"
          hint={snap.user.length > 0 ? `ключ !${snap.user[0]!.key} → ${snap.user[0]!.name}` : 'своих пока нет'}
          value={snap.user.length > 0 ? String(snap.user.length) : '—'}
          active={snap.user.length > 0}
        />
        <Fact label="Встроенные" hint="Google, YouTube, GitHub…" value={String(snap.builtin.length)} active />
        <Fact
          label="Набор DuckDuckGo"
          hint="в профиле, не в приложении"
          value={snap.importedCount > 0 ? snap.importedCount.toLocaleString('ru-RU') : 'Не скачан'}
          active={snap.importedCount > 0}
        />
        <Fact label="Пример" hint="в адресной строке" value="!yt котики" />
      </FactGrid>

      <InlineHint>
        Бэнг можно ставить и в конце: «котики !yt». Один «!ключ» без запроса открывает главную сайта.
      </InlineHint>

      {snap.user.length > 0 && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: sp(2) }}>
          <CapsLabel>Свои</CapsLabel>
          {snap.user.map((b) => (
            <SpotCard
              key={b.key}
              compact
              stain="var(--tile-orange)"
              icon={<Zap size={18} style={{ color: 'var(--text-strong)' }} />}
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

      <div style={{ display: 'flex', flexDirection: 'column', gap: sp(2) }}>
        <CapsLabel>Взять из открытой вкладки</CapsLabel>
        {found === null ? (
          <SpotCard
            compact
            stain="var(--tile-teal)"
            icon={<Wand2 size={18} />}
            title="Распознать поиск на открытых сайтах"
            subtitle="Откройте сайт, найдите на нём что-нибудь — шаблон соберётся по адресу результатов."
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
            <SpotCard
              key={c.template}
              compact
              stain="var(--tile-teal)"
              icon={<Wand2 size={18} />}
              title={`${c.name} — параметр «${c.param}»`}
              subtitle={c.template}
              actions={
                <button style={btnPrimary} onClick={() => {
                  setKey(c.key); setName(c.name); setTemplate(c.template); setError(null); setFound(null);
                }}>
                  Заполнить
                </button>
              }
            />
          ))
        )}
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: sp(2) }}>
        <CapsLabel>Добавить свой</CapsLabel>
        <InkFrame>
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
            В шаблоне обязателен {'{query}'} — на это место подставится запрос.
          </InlineHint>
        </InkFrame>
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: sp(2) }}>
        <CapsLabel>Готовый набор</CapsLabel>
        <SpotCard
          compact
          stain="var(--tile-brown)"
          icon={<Download size={18} />}
          title={snap.importedCount > 0 ? `Набор DuckDuckGo: ${snap.importedCount}` : 'Набор DuckDuckGo'}
          subtitle={
            snap.importedCount > 0
              ? 'Свои и встроенные бэнги всё равно имеют приоритет над импортированными.'
              : 'Несколько тысяч готовых бэнгов. Скачивается в ваш профиль, в приложение не входит.'
          }
          actions={
            <div style={{ display: 'flex', gap: sp(2) }}>
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

      <div style={{ display: 'flex', flexDirection: 'column', gap: sp(2) }}>
        <CapsLabel>Встроенные</CapsLabel>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: sp(2) }}>
          {snap.builtin.map((b) => (
            <MonoChip key={b.key} strong title={`${b.name} — ${b.template}`}>
              !{b.key}
            </MonoChip>
          ))}
        </div>
      </div>
    </div>
  );
}

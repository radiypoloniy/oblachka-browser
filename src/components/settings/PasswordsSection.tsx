import { useEffect, useMemo, useRef, useState } from 'react';
import { Plus, Trash2, Check, Lock, Eye, EyeOff, Copy, Pencil, RefreshCw, Download, Upload, Search, ChevronRight, FileUp, Loader2 } from 'lucide-react';
import type { PasswordMeta, PasswordCopyField } from '../../../shared/ipc';
import { islandPlate } from '../../styles/island';
import Toggle from '../Toggle';
import {
  btnPrimary, btnGhost, IconBtn, SectionHeader, CapsLabel, LoadingNote,
  InlineError, InlineHint, TextField, TextArea, InputRow, fieldFlex, Favicon,
} from './kit';

// Геометрия списка. LIST_VIEWPORT держит потолок высоты (см. комментарий у самого списка),
// ROW_OVERSCAN — сколько строк рисуем сверх видимых, чтобы при быстрой прокрутке не мелькала
// пустота. ROW_PITCH_GUESS — только до первого замера живой строки.
const LIST_VIEWPORT = 420;
const ROW_GAP = 4;
const ROW_OVERSCAN = 4;
const ROW_PITCH_GUESS = 60;

// ── Секция «Пароли» — сейф на этом устройстве (менеджер паролей, шаг 1) ───────
// Только хранилище/CRUD/генератор/экспорт-импорт на этом шаге — автозаполнение в веб-формы
// (шаг 2) и внешние коннекторы (Bitwarden и т.п.) сюда не входят, ниже только disabled-заглушка
// подраздела под них. Пароль пересекает IPC только по явному действию (reveal/copy/generate) —
// listPasswords секретов не возвращает (см. shared/ipc.ts::OblakoApi).
export default function PasswordsSection() {
  const [entries, setEntries] = useState<PasswordMeta[] | null>(null);
  const [revealed, setRevealed] = useState<Record<number, string>>({});
  const [copiedKey, setCopiedKey] = useState<string | null>(null);
  const [query, setQuery] = useState('');
  const [authEnabled, setAuthEnabled] = useState(true);
  // Список свёрнут по умолчанию. Две причины, и вторая важнее косметической:
  // (1) при десятках записей секция превращалась в простыню, и до экспорта/импорта и подключения
  //     внешнего менеджера внизу приходилось листать весь сейф;
  // (2) каждая строка рисует <Favicon>, а тот идёт в сеть НА КАЖДЫЙ домен сохранённого пароля —
  //     то есть простое открытие настроек рассылало серверам список аккаунтов человека
  //     (пункт 4 «бэклога усиления паролей» в CLAUDE.md). Свёрнутый список туда не ходит.
  const [listOpen, setListOpen] = useState(false);

  const [formOpen, setFormOpen] = useState(false);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [urlInput, setUrlInput] = useState('');
  const [usernameInput, setUsernameInput] = useState('');
  const [passwordInput, setPasswordInput] = useState('');
  const [notesInput, setNotesInput] = useState('');
  const [formError, setFormError] = useState('');
  const [saving, setSaving] = useState(false);

  const [generatorOpen, setGeneratorOpen] = useState(false);
  const [genLength, setGenLength] = useState(16);
  const [genLower, setGenLower] = useState(true);
  const [genUpper, setGenUpper] = useState(true);
  const [genDigits, setGenDigits] = useState(true);
  const [genSymbols, setGenSymbols] = useState(false);

  const [exportOpen, setExportOpen] = useState(false);
  const [exportPassphrase, setExportPassphrase] = useState('');
  const [exportBusy, setExportBusy] = useState(false);
  const [exportMsg, setExportMsg] = useState('');
  const [importOpen, setImportOpen] = useState(false);
  const [importPassphrase, setImportPassphrase] = useState('');
  const [importBusy, setImportBusy] = useState(false);
  const [importMsg, setImportMsg] = useState('');
  // Импорт из другого браузера через CSV — отдельно от зашифрованного бэкапа выше. Это то место,
  // куда человек идёт за «перенести пароли из Chrome» (см. разбор находимости в истории задач:
  // сначала попадали в passphrase-импорт нашей копии и получали «повреждён»).
  const [csvBusy, setCsvBusy] = useState(false);
  const [csvMsg, setCsvMsg] = useState('');

  function refresh() {
    window.oblako.listPasswords().then(setEntries);
  }

  useEffect(() => {
    let mounted = true;
    window.oblako.listPasswords().then((list) => { if (mounted) setEntries(list); });
    window.oblako.getPasswordAuthEnabled().then((v) => { if (mounted) setAuthEnabled(v); });
    const unsub = window.oblako.onPasswordsChanged(() => {
      window.oblako.listPasswords().then((list) => { if (mounted) setEntries(list); });
    });
    return () => { mounted = false; unsub(); };
  }, []);

  async function handleToggleAuth() {
    const next = await window.oblako.setPasswordAuthEnabled(!authEnabled);
    setAuthEnabled(next);
  }

  function openAddForm() {
    setListOpen(true); // форма живёт внутри свёрнутого блока — иначе кнопка «Добавить» ничего не даёт
    setEditingId(null);
    setUrlInput(''); setUsernameInput(''); setPasswordInput(''); setNotesInput('');
    setFormError(''); setGeneratorOpen(false); setFormOpen(true);
  }

  function openEditForm(entry: PasswordMeta) {
    setEditingId(entry.id);
    setUrlInput(entry.url); setUsernameInput(entry.username);
    // Пароль не подгружаем автоматически при открытии формы — не тянем secret без явного
    // reveal-действия пользователя. Пустое поле здесь значит «не менять».
    setPasswordInput(''); setNotesInput('');
    setFormError(''); setGeneratorOpen(false); setFormOpen(true);
  }

  async function handleSave() {
    const rawUrl = urlInput.trim();
    const username = usernameInput.trim();
    if (!rawUrl) { setFormError('Введите адрес сайта'); return; }
    if (editingId === null && !passwordInput) { setFormError('Введите пароль'); return; }

    const normalizedUrl = /^https?:\/\//i.test(rawUrl) ? rawUrl : `https://${rawUrl}`;
    let title = rawUrl;
    try { title = new URL(normalizedUrl).hostname; } catch { /* оставляем исходную строку */ }

    setSaving(true);
    setFormError('');
    const ok = editingId === null
      ? await window.oblako.addPassword({
          url: normalizedUrl, username, password: passwordInput, title,
          notes: notesInput.trim() || undefined,
        })
      : await window.oblako.updatePassword({
          id: editingId, url: normalizedUrl, username, title,
          password: passwordInput || undefined,
          notes: notesInput.trim() || undefined,
        });
    setSaving(false);
    if (ok) { setFormOpen(false); refresh(); } else { setFormError('Не удалось сохранить'); }
  }

  async function handleDelete(id: number) {
    await window.oblako.deletePassword(id);
    setRevealed((r) => { if (!(id in r)) return r; const next = { ...r }; delete next[id]; return next; });
  }

  async function handleReveal(id: number) {
    if (id in revealed) {
      setRevealed((r) => { const next = { ...r }; delete next[id]; return next; });
      return;
    }
    const value = await window.oblako.revealPassword(id);
    if (value !== null) setRevealed((r) => ({ ...r, [id]: value }));
  }

  async function handleCopy(id: number, field: PasswordCopyField) {
    const ok = await window.oblako.copyPasswordField(id, field);
    if (!ok) return;
    const key = `${id}:${field}`;
    setCopiedKey(key);
    setTimeout(() => setCopiedKey((k) => (k === key ? null : k)), 1500);
  }

  async function handleGenerate() {
    const value = await window.oblako.generatePassword({
      length: genLength, lower: genLower, upper: genUpper, digits: genDigits, symbols: genSymbols,
    });
    setPasswordInput(value);
  }

  async function handleExport() {
    if (!exportPassphrase.trim()) { setExportMsg('Введите парольную фразу'); return; }
    setExportBusy(true); setExportMsg('');
    const ok = await window.oblako.exportPasswords(exportPassphrase);
    setExportBusy(false);
    setExportMsg(ok ? 'Экспортировано.' : 'Отменено или не удалось сохранить.');
    if (ok) setExportPassphrase('');
  }

  async function handleImport() {
    if (!importPassphrase.trim()) { setImportMsg('Введите парольную фразу'); return; }
    setImportBusy(true); setImportMsg('');
    const count = await window.oblako.importPasswords(importPassphrase);
    setImportBusy(false);
    setImportMsg(count > 0
      ? `Импортировано записей: ${count}.`
      : 'Не удалось импортировать — неверная фраза, файл не выбран или повреждён.');
    if (count > 0) { setImportPassphrase(''); refresh(); }
  }

  // Импорт паролей из CSV-экспорта другого браузера (Chrome/Edge/Firefox). Никакой парольной
  // фразы — это не наш зашифрованный бэкап, а открытый CSV, который человек выгрузил из браузера.
  async function handleCsvImport() {
    if (csvBusy) return;
    setCsvBusy(true); setCsvMsg('');
    const res = await window.oblako.importPasswordsCsv();
    setCsvBusy(false);
    switch (res.status) {
      case 'canceled':          break; // диалог закрыт — молчим
      case 'ok':                setCsvMsg(res.inserted > 0
        ? `Добавлено паролей: ${res.inserted}${res.skipped > 0 ? `, пропущено (уже были) ${res.skipped}` : ''}. Удалите CSV-файл — пароли в нём открытым текстом.`
        : `Ничего не добавлено — все ${res.skipped} записей уже были в сейфе.`); break;
      case 'empty':             setCsvMsg('В файле не нашлось паролей — это точно CSV-экспорт паролей из браузера?'); break;
      case 'read-error':        setCsvMsg('Не удалось прочитать файл.'); break;
      case 'vault-unavailable': setCsvMsg('Хранилище паролей на этом компьютере недоступно.'); break;
    }
    if (res.status === 'ok' && res.inserted > 0) refresh();
  }

  // Клиентский фильтр по сайту/логину — список может быть на десятки записей, без поиска нужную
  // не найти. entries === null (ещё грузим) обрабатывается ниже, здесь уже массив либо null.
  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q || !entries) return entries ?? [];
    return entries.filter((e) =>
      e.title.toLowerCase().includes(q) ||
      e.origin.toLowerCase().includes(q) ||
      e.username.toLowerCase().includes(q));
  }, [entries, query]);

  // ── Оконный список ──
  // Шаг строки меряется по ЖИВОЙ первой строке, а не задан числом: высота зависит от кегля и
  // масштаба Windows, а ошибка в шаге — это разъезжающаяся прокрутка. До первого замера работает
  // оценка, и она же остаётся, если строк нет вовсе.
  const listRef = useRef<HTMLDivElement>(null);
  const rowProbeRef = useRef<HTMLDivElement>(null);
  const [scrollTop, setScrollTop] = useState(0);
  const [rowPitch, setRowPitch] = useState(ROW_PITCH_GUESS);
  useEffect(() => {
    const h = rowProbeRef.current?.getBoundingClientRect().height;
    if (h && Math.abs(h + ROW_GAP - rowPitch) > 1) setRowPitch(h + ROW_GAP);
  });
  // Поиск меняет набор — прокрутку возвращаем в начало, иначе окно указывало бы в пустоту.
  useEffect(() => { setScrollTop(0); if (listRef.current) listRef.current.scrollTop = 0; }, [query]);

  const firstVisible = Math.max(0, Math.floor(scrollTop / rowPitch) - ROW_OVERSCAN);
  const lastVisible = Math.min(
    filtered.length,
    Math.ceil((scrollTop + LIST_VIEWPORT) / rowPitch) + ROW_OVERSCAN,
  );
  const visibleRows = filtered.slice(firstVisible, lastVisible);
  const topSpacer = firstVisible * rowPitch;
  const bottomSpacer = Math.max(0, (filtered.length - lastVisible) * rowPitch);

  // ⚠️ Раньше вся секция отдавала <LoadingNote/>, пока грузился список, — из-за одного запроса к
  // сейфу не рисовались ни тумблер Windows-подтверждения, ни экспорт. Теперь ожидание локально
  // внутри списка, остальное видно сразу.
  const count = entries?.length ?? null;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 24, maxWidth: 560 }}>
      <SectionHeader title="Пароли">
        Зашифрованный сейф на этом устройстве — записи защищены ключом, привязанным к вашей
        учётной записи Windows. Автозаполнение в веб-формы появится отдельным шагом.
      </SectionHeader>

      {/* Доп. защита: подтверждение Windows перед показом/копированием пароля (electron/osAuth.ts) */}
      <div style={{
        display: 'flex', alignItems: 'center', gap: 12, padding: '12px 16px',
        ...islandPlate, borderRadius: 'var(--radius-sm)',
      }}>
        <Lock size={18} style={{ color: 'var(--text-faint)', flex: 'none' }} />
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: 'var(--fs-sm)', fontWeight: 600, color: 'var(--text-strong)' }}>
            Подтверждение Windows для показа пароля
          </div>
          <div style={{ fontSize: 'var(--fs-xs)', color: 'var(--text-faint)', marginTop: 2 }}>
            Спрашивать пароль/PIN Windows перед тем, как показать или скопировать сохранённый пароль.
          </div>
        </div>
        <Toggle checked={authEnabled} onChange={() => void handleToggleAuth()} />
      </div>

      {/* Список сохранённых записей — раскрывается по требованию, см. listOpen выше */}
      <div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 8 }}>
          <button
            onClick={() => setListOpen((v) => !v)}
            style={{
              flex: 1, minWidth: 0, display: 'flex', alignItems: 'center', gap: 6,
              background: 'none', border: 'none', padding: 0, cursor: 'default', textAlign: 'left',
            }}
          >
            {/* Поворот стрелки, а не подмена иконки: один элемент, который едет по --dur-fast,
                читается как «раскрылось», а не как «сменилась картинка». */}
            <ChevronRight
              size={14}
              style={{
                color: 'var(--text-faint)', flex: 'none',
                transform: listOpen ? 'rotate(90deg)' : 'none',
                transition: 'transform var(--dur-fast) var(--ease-standard)',
              }}
            />
            <CapsLabel style={{
              minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis',
              whiteSpace: 'nowrap', marginBottom: 0,
            }}>
              Сохранённые пароли
            </CapsLabel>
            {/* Счётчик — единственная причина, по которой метаданные всё же читаются при открытии
                настроек: это локальный запрос к SQLite без сети, а без числа свёрнутый блок
                не отвечает на вопрос «а есть ли там вообще что-то». */}
            {count !== null && (
              <span style={{ fontSize: 'var(--fs-xs)', color: 'var(--text-faint)', flex: 'none' }}>
                {count}
              </span>
            )}
          </button>
          {!formOpen && (
            <button onClick={openAddForm} style={{ ...btnPrimary, display: 'flex', gap: 6, alignItems: 'center' }}>
              <Plus size={14} /> Добавить
            </button>
          )}
        </div>

        {listOpen && entries === null && <LoadingNote />}

        {listOpen && entries !== null && (
        <>
        {formOpen && (
          <PasswordForm
            editing={editingId !== null}
            urlInput={urlInput} onUrlChange={setUrlInput}
            usernameInput={usernameInput} onUsernameChange={setUsernameInput}
            passwordInput={passwordInput} onPasswordChange={setPasswordInput}
            notesInput={notesInput} onNotesChange={setNotesInput}
            formError={formError} saving={saving}
            generatorOpen={generatorOpen} onToggleGenerator={() => setGeneratorOpen((v) => !v)}
            genLength={genLength} onGenLength={setGenLength}
            genLower={genLower} onGenLower={setGenLower}
            genUpper={genUpper} onGenUpper={setGenUpper}
            genDigits={genDigits} onGenDigits={setGenDigits}
            genSymbols={genSymbols} onGenSymbols={setGenSymbols}
            onGenerate={() => void handleGenerate()}
            onSave={() => void handleSave()}
            onCancel={() => setFormOpen(false)}
          />
        )}

        {entries.length === 0 && !formOpen && (
          <div style={{ fontSize: 'var(--fs-sm)', color: 'var(--text-faint)', padding: '8px 4px' }}>
            Записей пока нет.
          </div>
        )}

        {/* Поиск — показываем, когда есть что искать (несколько записей). Инлайн-плита в стиле
            поиска Истории/Закладок, чтобы список из десятков паролей был обозрим. */}
        {entries.length > 1 && (
          <div style={{
            display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8,
            ...islandPlate, borderRadius: 'var(--radius-sm)', padding: '6px 10px',
          }}>
            <Search size={14} style={{ color: 'var(--text-faint)', flexShrink: 0 }} />
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Поиск по сайту или логину…"
              style={{
                flex: 1, minWidth: 0, background: 'none', border: 'none', outline: 'none',
                fontSize: 'var(--fs-sm)', color: 'var(--text-body)',
              }}
            />
            {query && (
              <button
                onClick={() => setQuery('')}
                title="Очистить"
                style={{ background: 'none', border: 'none', cursor: 'default', padding: 2, color: 'var(--text-faint)', display: 'flex', fontSize: 'var(--fs-md)', lineHeight: 1 }}
              >×</button>
            )}
          </div>
        )}

        {/* Своя прокрутка с потолком высоты: даже раскрытый сейф на сотню записей не должен
            отодвигать экспорт и подключение внешнего менеджера за край страницы.
            ⚠️ РИСУЮТСЯ ТОЛЬКО ВИДИМЫЕ СТРОКИ. Замер на фикстуре из 300 записей: раскрытие списка
            занимало кадр в 263 мс (плюс серия длинных задач 123/93/123/93) — то есть заметную
            заморозку интерфейса ровно в момент, когда человек нажал «показать». Видно из них
            от силы семь: остальное — работа в никуда. Место несуществующих строк держат распорки
            сверху и снизу, поэтому полоса прокрутки и её положение остаются честными. */}
        <div
          ref={listRef}
          onScroll={(e) => setScrollTop(e.currentTarget.scrollTop)}
          style={{ maxHeight: LIST_VIEWPORT, overflowY: 'auto' }}
        >
          {topSpacer > 0 && <div style={{ height: topSpacer }} />}
          {visibleRows.map((entry) => (
            <div key={entry.id} ref={rowProbeRef} style={{ marginBottom: ROW_GAP }}>
              <PasswordRow
                entry={entry}
                revealedValue={revealed[entry.id]}
                copiedKey={copiedKey}
                onToggleReveal={() => void handleReveal(entry.id)}
                onCopy={(field) => void handleCopy(entry.id, field)}
                onEdit={() => openEditForm(entry)}
                onDelete={() => void handleDelete(entry.id)}
              />
            </div>
          ))}
          {bottomSpacer > 0 && <div style={{ height: bottomSpacer }} />}
          {entries.length > 0 && filtered.length === 0 && (
            <div style={{ fontSize: 'var(--fs-sm)', color: 'var(--text-faint)', padding: '8px 4px' }}>
              Ничего не найдено.
            </div>
          )}
        </div>
        </>
        )}
      </div>

      {/* Импорт из другого браузера (CSV). Отдельно и ВЫШЕ зашифрованной копии: это то, за чем
          человек сюда обычно и приходит («перенести пароли из Chrome»). Пароли современного Chrome
          с диска не читаются (App-Bound), поэтому путь — экспорт CSV из самого браузера. */}
      <div style={{ paddingTop: 20, borderTop: '1px solid var(--divider)' }}>
        <CapsLabel>Перенести из другого браузера</CapsLabel>
        <p style={{ margin: '0 0 12px', fontSize: 'var(--fs-sm)', color: 'var(--text-faint)' }}>
          Пароли современного Chrome зашифрованы и напрямую не переносятся. Экспортируйте их в самом
          браузере: <b>Настройки → Пароли → ⋮ → Экспорт паролей</b> — и выберите полученный
          CSV-файл здесь.
        </p>
        <button
          onClick={() => void handleCsvImport()}
          disabled={csvBusy}
          style={{ ...btnGhost, display: 'flex', gap: 6, alignItems: 'center', opacity: csvBusy ? 0.5 : 1 }}
        >
          {csvBusy
            ? <Loader2 size={14} style={{ animation: 'oblako-spin 1s linear infinite' }} />
            : <FileUp size={14} />}
          Выбрать CSV-файл
        </button>
        {csvMsg && (
          <p style={{ margin: '8px 0 0', fontSize: 'var(--fs-sm)', color: 'var(--text-body)' }}>{csvMsg}</p>
        )}
      </div>

      {/* Экспорт / импорт зашифрованной КОПИИ нашего сейфа (не путать с импортом из браузера выше:
          здесь наш формат под парольной фразой, туда — открытый CSV чужого браузера). */}
      <div style={{ paddingTop: 20, borderTop: '1px solid var(--divider)' }}>
        <CapsLabel>Зашифрованная копия сейфа</CapsLabel>
        <p style={{ margin: '0 0 12px', fontSize: 'var(--fs-sm)', color: 'var(--text-faint)' }}>
          Ключ сейфа привязан к этому Windows-профилю и не переживёт переустановку — сохраните
          зашифрованную копию отдельной парольной фразой, чтобы не потерять пароли.
        </p>
        <div style={{ display: 'flex', gap: 8, marginBottom: 8 }}>
          <button
            onClick={() => { setExportOpen((v) => !v); setImportOpen(false); setExportMsg(''); }}
            style={{ ...btnGhost, display: 'flex', gap: 6, alignItems: 'center' }}
          ><Download size={14} /> Экспорт</button>
          <button
            onClick={() => { setImportOpen((v) => !v); setExportOpen(false); setImportMsg(''); }}
            style={{ ...btnGhost, display: 'flex', gap: 6, alignItems: 'center' }}
          ><Upload size={14} /> Импорт</button>
        </div>

        {exportOpen && (
          <PassphrasePrompt
            label="Парольная фраза для экспорта"
            value={exportPassphrase} onChange={setExportPassphrase}
            busy={exportBusy} msg={exportMsg}
            actionLabel="Сохранить файл"
            onConfirm={() => void handleExport()}
          />
        )}
        {importOpen && (
          <PassphrasePrompt
            label="Парольная фраза для импорта"
            value={importPassphrase} onChange={setImportPassphrase}
            busy={importBusy} msg={importMsg}
            actionLabel="Выбрать файл"
            onConfirm={() => void handleImport()}
          />
        )}
      </div>

      {/* Внешние коннекторы — плейсхолдер, коннекторов пока нет */}
      <div style={{
        paddingTop: 20, borderTop: '1px solid var(--divider)', opacity: 0.45,
      }}>
        <CapsLabel>Подключить внешний менеджер</CapsLabel>
        <div style={{
          display: 'flex', alignItems: 'center', gap: 12, padding: '12px 16px',
          ...islandPlate, borderRadius: 'var(--radius-sm)',
        }}>
          <Lock size={18} style={{ color: 'var(--text-faint)', flex: 'none' }} />
          <span style={{ flex: 1, fontSize: 'var(--fs-sm)', color: 'var(--text-faint)' }}>
            Bitwarden и другие менеджеры
          </span>
          <span style={{ fontSize: 'var(--fs-xs)', color: 'var(--text-faint)', fontWeight: 600 }}>скоро</span>
        </div>
      </div>
    </div>
  );
}

// ── Строка одной записи (список секции «Пароли») ──────────────────────────────

interface PasswordRowProps {
  entry: PasswordMeta;
  revealedValue: string | undefined;
  copiedKey: string | null;
  onToggleReveal: () => void;
  onCopy: (field: PasswordCopyField) => void;
  onEdit: () => void;
  onDelete: () => void;
}

function hostOf(origin: string): string {
  try { return new URL(origin).hostname.replace(/^www\./, ''); } catch { return origin; }
}

function PasswordRow({ entry, revealedValue, copiedKey, onToggleReveal, onCopy, onEdit, onDelete }: PasswordRowProps) {
  const revealed = revealedValue !== undefined;
  return (
    <div style={{
      display: 'flex', alignItems: 'center', gap: 10, padding: '10px 12px',
      borderRadius: 'var(--radius-sm)', background: 'var(--surface)',
    }}>
      <Favicon host={hostOf(entry.origin)} />
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{
          fontSize: 'var(--fs-sm)', fontWeight: 600, color: 'var(--text-strong)',
          overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
        }}>
          {entry.title || entry.origin}
        </div>
        <div style={{
          fontSize: 'var(--fs-xs)', color: 'var(--text-faint)', marginTop: 2,
          overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', fontFamily: 'monospace',
        }}>
          {entry.username || '—'}{revealed ? `  ·  ${revealedValue}` : ''}
        </div>
      </div>
      <IconBtn title="Копировать логин" active={copiedKey === `${entry.id}:username`} onClick={() => onCopy('username')}>
        {copiedKey === `${entry.id}:username` ? <Check size={14} /> : <Copy size={14} />}
      </IconBtn>
      <IconBtn title="Копировать пароль" active={copiedKey === `${entry.id}:password`} onClick={() => onCopy('password')}>
        {copiedKey === `${entry.id}:password` ? <Check size={14} /> : <Copy size={14} />}
      </IconBtn>
      <IconBtn title={revealed ? 'Скрыть пароль' : 'Показать пароль'} onClick={onToggleReveal}>
        {revealed ? <EyeOff size={14} /> : <Eye size={14} />}
      </IconBtn>
      <IconBtn title="Изменить" onClick={onEdit}><Pencil size={14} /></IconBtn>
      <IconBtn title="Удалить" onClick={onDelete}><Trash2 size={14} /></IconBtn>
    </div>
  );
}

// ── Форма добавления/редактирования записи ─────────────────────────────────────

interface PasswordFormProps {
  editing: boolean;
  urlInput: string; onUrlChange: (v: string) => void;
  usernameInput: string; onUsernameChange: (v: string) => void;
  passwordInput: string; onPasswordChange: (v: string) => void;
  notesInput: string; onNotesChange: (v: string) => void;
  formError: string; saving: boolean;
  generatorOpen: boolean; onToggleGenerator: () => void;
  genLength: number; onGenLength: (v: number) => void;
  genLower: boolean; onGenLower: (v: boolean) => void;
  genUpper: boolean; onGenUpper: (v: boolean) => void;
  genDigits: boolean; onGenDigits: (v: boolean) => void;
  genSymbols: boolean; onGenSymbols: (v: boolean) => void;
  onGenerate: () => void;
  onSave: () => void;
  onCancel: () => void;
}

function PasswordForm({
  editing, urlInput, onUrlChange, usernameInput, onUsernameChange, passwordInput, onPasswordChange,
  notesInput, onNotesChange, formError, saving, generatorOpen, onToggleGenerator,
  genLength, onGenLength, genLower, onGenLower, genUpper, onGenUpper, genDigits, onGenDigits,
  genSymbols, onGenSymbols, onGenerate, onSave, onCancel,
}: PasswordFormProps) {
  return (
    <div style={{
      display: 'flex', flexDirection: 'column', gap: 10, padding: '14px 16px', marginBottom: 10,
      ...islandPlate, borderRadius: 'var(--radius-sm)',
    }}>
      <TextField value={urlInput} placeholder="example.com" onChange={onUrlChange} />
      <TextField value={usernameInput} placeholder="Логин / e-mail" onChange={onUsernameChange} />
      <InputRow>
        <TextField
          value={passwordInput}
          placeholder={editing ? 'Новый пароль (не менять — оставить пустым)' : 'Пароль'}
          mono
          onChange={onPasswordChange}
          style={fieldFlex}
        />
        <button
          title="Генератор паролей" onClick={onToggleGenerator}
          style={{ ...btnGhost, flex: 'none', display: 'flex', alignItems: 'center' }}
        ><RefreshCw size={14} /></button>
      </InputRow>

      {generatorOpen && (
        <div style={{
          display: 'flex', flexDirection: 'column', gap: 10, padding: '12px 14px',
          borderRadius: 'var(--radius-sm)', background: 'var(--surface-hover)',
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <span style={{ fontSize: 'var(--fs-xs)', color: 'var(--text-faint)', flex: 'none' }}>Длина: {genLength}</span>
            <input
              type="range" min={8} max={64} value={genLength}
              onChange={(e) => onGenLength(Number(e.target.value))}
              style={{ flex: 1 }}
            />
          </div>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 12 }}>
            <GenToggle label="a-z" checked={genLower} onChange={() => onGenLower(!genLower)} />
            <GenToggle label="A-Z" checked={genUpper} onChange={() => onGenUpper(!genUpper)} />
            <GenToggle label="0-9" checked={genDigits} onChange={() => onGenDigits(!genDigits)} />
            <GenToggle label="!@#" checked={genSymbols} onChange={() => onGenSymbols(!genSymbols)} />
          </div>
          <button onClick={onGenerate} style={{ ...btnPrimary, alignSelf: 'flex-start' }}>Сгенерировать</button>
        </div>
      )}

      <TextArea
        value={notesInput} placeholder="Заметки (необязательно)" rows={2} onChange={onNotesChange}
      />

      {formError && <InlineError>{formError}</InlineError>}

      <div style={{ display: 'flex', gap: 8 }}>
        <button onClick={onSave} disabled={saving} style={{ ...btnPrimary, opacity: saving ? 0.6 : 1 }}>
          {saving ? 'Сохранение…' : 'Сохранить'}
        </button>
        <button onClick={onCancel} style={btnGhost}>Отмена</button>
      </div>
    </div>
  );
}

function GenToggle({ label, checked, onChange }: { label: string; checked: boolean; onChange: () => void }) {
  return (
    <label style={{ display: 'flex', alignItems: 'center', gap: 6, cursor: 'default' }}>
      <Toggle checked={checked} onChange={onChange} />
      <span style={{ fontSize: 'var(--fs-xs)', color: 'var(--text-body)', fontFamily: 'monospace' }}>{label}</span>
    </label>
  );
}

// ── Инлайн-запрос парольной фразы (экспорт/импорт) ─────────────────────────────

function PassphrasePrompt({
  label, value, onChange, busy, msg, actionLabel, onConfirm,
}: {
  label: string; value: string; onChange: (v: string) => void; busy: boolean; msg: string;
  actionLabel: string; onConfirm: () => void;
}) {
  return (
    <div style={{
      display: 'flex', flexDirection: 'column', gap: 8, padding: '12px 14px', marginBottom: 8,
      ...islandPlate, borderRadius: 'var(--radius-sm)',
    }}>
      <InlineHint>{label}</InlineHint>
      <InputRow>
        <TextField
          type="password" value={value} onChange={onChange} onEnter={onConfirm}
          style={fieldFlex}
        />
        <button onClick={onConfirm} disabled={busy} style={{ ...btnPrimary, opacity: busy ? 0.6 : 1, flex: 'none' }}>
          {busy ? '…' : actionLabel}
        </button>
      </InputRow>
      {msg && <InlineHint>{msg}</InlineHint>}
    </div>
  );
}


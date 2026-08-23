import { useEffect, useState } from 'react';
import { sp } from '../../styles/system';
import { Plus, Trash2, Pencil, MapPin, CreditCard, Eye, EyeOff } from 'lucide-react';
import type { AddressProfile, AddressInput, CardMeta, ParsedAddressPart } from '../../../shared/ipc';
import {
  btnPrimary, btnGhost, IconBtn, SectionHeader, Subsection, LoadingNote,
  InlineError, TextField, InputRow, fieldFlex, OptionList, settingsBox,
} from './kit';

// Секция «Автозаполнение» — адреса и банковские карты (electron/AutofillManager.ts). Только
// хранилище/CRUD на этом шаге; подстановка в веб-формы — отдельными заходами. Номер карты в
// renderer приходит только маской (last4); полный — по кнопке «показать» под Windows Hello
// (revealCardNumber, гейт в main), как у паролей. CVC не храним (PCI).
export default function AutofillSection() {
  const [addresses, setAddresses] = useState<AddressProfile[] | null>(null);
  const [cards, setCards] = useState<CardMeta[] | null>(null);
  const [addrFormOpen, setAddrFormOpen] = useState(false);
  const [editingAddr, setEditingAddr] = useState<AddressProfile | null>(null);
  const [cardFormOpen, setCardFormOpen] = useState(false);
  const [editingCard, setEditingCard] = useState<CardMeta | null>(null);
  const [revealedCards, setRevealedCards] = useState<Record<number, string>>({});

  function refresh() {
    void window.oblako.listAddresses().then(setAddresses);
    void window.oblako.listCards().then(setCards);
  }

  useEffect(() => {
    let mounted = true;
    window.oblako.listAddresses().then((a) => { if (mounted) setAddresses(a); });
    window.oblako.listCards().then((c) => { if (mounted) setCards(c); });
    const unsub = window.oblako.onAutofillChanged(() => { if (mounted) refresh(); });
    return () => { mounted = false; unsub(); };
  }, []);

  async function handleRevealCard(id: number) {
    if (id in revealedCards) {
      setRevealedCards((r) => { const next = { ...r }; delete next[id]; return next; });
      return;
    }
    const num = await window.oblako.revealCardNumber(id);
    if (num !== null) setRevealedCards((r) => ({ ...r, [id]: num }));
  }

  if (addresses === null || cards === null) return <LoadingNote />;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: sp(6) }}>
      <SectionHeader title="Автозаполнение">
        Адреса и банковские карты для быстрого заполнения форм. Данные зашифрованы на этом
        устройстве; CVC/CVV карт не сохраняется. Подстановка в формы появится следующим шагом.
      </SectionHeader>

      {/* ── Адреса ── */}
      <Subsection title="Адреса" description="Имя, контакты и адрес доставки для форм заказа.">
        {addrFormOpen ? (
          <AddressForm
            initial={editingAddr}
            onCancel={() => { setAddrFormOpen(false); setEditingAddr(null); }}
            onSaved={() => { setAddrFormOpen(false); setEditingAddr(null); refresh(); }}
          />
        ) : (
          <>
            {addresses.length === 0 && (
              <div style={{ fontSize: 'var(--fs-sm)', color: 'var(--text-faint)', padding: '4px' }}>Адресов пока нет.</div>
            )}
            <OptionList>
              {addresses.map((a) => (
                <div key={a.id} style={rowStyle}>
                  <MapPin size={16} style={{ color: 'var(--text-muted)', flex: 'none' }} />
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={rowTitle}>{a.fullName || a.email || a.phone || 'Без имени'}</div>
                    <div style={rowSub}>{[a.street, a.city, a.country].filter(Boolean).join(', ') || '—'}</div>
                  </div>
                  <IconBtn title="Изменить" onClick={() => { setEditingAddr(a); setAddrFormOpen(true); }}><Pencil size={14} /></IconBtn>
                  <IconBtn title="Удалить" onClick={() => void window.oblako.deleteAddress(a.id)}><Trash2 size={14} /></IconBtn>
                </div>
              ))}
            </OptionList>
            <button onClick={() => { setEditingAddr(null); setAddrFormOpen(true); }} style={{ ...btnPrimary, display: 'flex', gap: 8, alignItems: 'center', alignSelf: 'flex-start' }}>
              <Plus size={14} /> Добавить адрес
            </button>
          </>
        )}
      </Subsection>

      {/* ── Карты ── */}
      <Subsection title="Банковские карты" description="Номер карты хранится зашифрованным; для показа запросим подтверждение Windows.">
        {cardFormOpen ? (
          <CardForm
            initial={editingCard}
            onCancel={() => { setCardFormOpen(false); setEditingCard(null); }}
            onSaved={() => { setCardFormOpen(false); setEditingCard(null); refresh(); }}
          />
        ) : (
          <>
            {cards.length === 0 && (
              <div style={{ fontSize: 'var(--fs-sm)', color: 'var(--text-faint)', padding: '4px' }}>Карт пока нет.</div>
            )}
            <OptionList>
              {cards.map((c) => (
                <div key={c.id} style={rowStyle}>
                  <CreditCard size={16} style={{ color: 'var(--text-muted)', flex: 'none' }} />
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={rowTitle}>{[c.brand, `•••• ${c.last4}`].filter(Boolean).join(' ')}</div>
                    <div style={{ ...rowSub, fontFamily: revealedCards[c.id] ? 'var(--font-mono)' : undefined }}>
                      {revealedCards[c.id]
                        ? formatCardNumber(revealedCards[c.id]!)
                        : `${c.cardholder || '—'}  ·  ${fmtExp(c.expMonth, c.expYear)}`}
                    </div>
                  </div>
                  <IconBtn title={revealedCards[c.id] ? 'Скрыть номер' : 'Показать номер'} onClick={() => void handleRevealCard(c.id)}>
                    {revealedCards[c.id] ? <EyeOff size={14} /> : <Eye size={14} />}
                  </IconBtn>
                  <IconBtn title="Изменить" onClick={() => { setEditingCard(c); setCardFormOpen(true); }}><Pencil size={14} /></IconBtn>
                  <IconBtn title="Удалить" onClick={() => void window.oblako.deleteCard(c.id)}><Trash2 size={14} /></IconBtn>
                </div>
              ))}
            </OptionList>
            <button onClick={() => { setEditingCard(null); setCardFormOpen(true); }} style={{ ...btnPrimary, display: 'flex', gap: 8, alignItems: 'center', alignSelf: 'flex-start' }}>
              <Plus size={14} /> Добавить карту
            </button>
          </>
        )}
      </Subsection>
    </div>
  );
}

// ⚠️ Заливки у строки нет: группу держит рамка OptionList и волосяные разделители между
// строками (см. разбор в kit.tsx). Прежний `background: var(--surface)` совпадал с цветом самой
// панели, то есть не делал ничего — кроме как мешал, когда панель была подкрашена.
const rowStyle: React.CSSProperties = {
  display: 'flex', alignItems: 'center', gap: 12, padding: '12px 12px',
};
const rowTitle: React.CSSProperties = {
  fontSize: 'var(--fs-sm)', fontWeight: 600, color: 'var(--text-strong)',
  overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
};
const rowSub: React.CSSProperties = {
  fontSize: 'var(--fs-xs)', color: 'var(--text-faint)', marginTop: 4,
  overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
};

function fmtExp(m: number, y: number): string {
  if (!m || !y) return '—';
  return `${String(m).padStart(2, '0')}/${String(y).slice(-2)}`;
}
function formatCardNumber(digits: string): string {
  return digits.replace(/(.{4})/g, '$1 ').trim();
}

// ── Форма адреса ──────────────────────────────────────────────────────────────
function AddressForm({ initial, onCancel, onSaved }: { initial: AddressProfile | null; onCancel: () => void; onSaved: () => void }) {
  const [f, setF] = useState<AddressInput>({
    fullName: initial?.fullName ?? '', organization: initial?.organization ?? '',
    email: initial?.email ?? '', phone: initial?.phone ?? '', street: initial?.street ?? '',
    city: initial?.city ?? '', region: initial?.region ?? '', postalCode: initial?.postalCode ?? '',
    country: initial?.country ?? '',
  });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const set = (k: keyof AddressInput) => (v: string) => setF((p) => ({ ...p, [k]: v }));

  async function save() {
    // Хоть одно значимое поле — иначе пустая карточка бессмысленна.
    if (!f.fullName.trim() && !f.email.trim() && !f.phone.trim() && !f.street.trim()) {
      setError('Заполните хотя бы имя, e-mail, телефон или адрес'); return;
    }
    setSaving(true); setError('');
    const ok = initial
      ? await window.oblako.updateAddress({ id: initial.id, ...f })
      : await window.oblako.addAddress(f);
    setSaving(false);
    if (ok) onSaved(); else setError('Не удалось сохранить');
  }

  return (
    <div style={formStyle}>
      {/* Заполнить карточку одной строкой (AI-IDEAS.md №1). Тот же разбор, что у вставки на
          странице; здесь он вход в форму, а не предложение — поля видны рядом и правятся сразу,
          поэтому отдельного предпросмотра не нужно. Показываем только при СОЗДАНИИ: при правке
          человек пришёл поменять одно поле, а не заменить карточку целиком. */}
      {!initial && <AddressPasteBox onParsed={(parts) => {
        setF((p) => {
          const next = { ...p };
          for (const part of parts) {
            // Ключи разбора — подмножество полей карточки; чужие игнорируем молча.
            if (part.key in next) next[part.key as keyof AddressInput] = part.value;
          }
          return next;
        });
      }} />}
      <TextField value={f.fullName} placeholder="Имя и фамилия" onChange={set('fullName')} />
      <InputRow>
        <TextField value={f.email} placeholder="E-mail" onChange={set('email')} style={fieldFlex} />
        <TextField value={f.phone} placeholder="Телефон" onChange={set('phone')} style={fieldFlex} />
      </InputRow>
      <TextField value={f.organization} placeholder="Организация (необязательно)" onChange={set('organization')} />
      <TextField value={f.street} placeholder="Улица, дом, квартира" onChange={set('street')} />
      <InputRow>
        <TextField value={f.city} placeholder="Город" onChange={set('city')} style={fieldFlex} />
        <TextField value={f.postalCode} placeholder="Индекс" onChange={set('postalCode')} style={fieldFlex} />
      </InputRow>
      <InputRow>
        <TextField value={f.region} placeholder="Область / регион" onChange={set('region')} style={fieldFlex} />
        <TextField value={f.country} placeholder="Страна" onChange={set('country')} style={fieldFlex} />
      </InputRow>
      {error && <InlineError>{error}</InlineError>}
      <div style={{ display: 'flex', gap: 8 }}>
        <button onClick={() => void save()} disabled={saving} style={{ ...btnPrimary, opacity: saving ? 0.6 : 1 }}>
          {saving ? 'Сохранение…' : 'Сохранить'}
        </button>
        <button onClick={onCancel} style={btnGhost}>Отмена</button>
      </div>
    </div>
  );
}

// Поле «вставьте адрес одной строкой» над формой адреса.
//
// ⚠️ Модель здесь ВТОРАЯ дорожка, а не единственная: форма ниже работает как работала, и у
// человека без скачанной модели раздел не ломается. То же правило, из-за которого разбор фразы
// в правилах стал второй дорожкой к обычной форме (см. «Программа» в CLAUDE.md).
function AddressPasteBox({ onParsed }: { onParsed: (parts: ParsedAddressPart[]) => void }) {
  const [text, setText] = useState('');
  const [working, setWorking] = useState(false);
  const [note, setNote] = useState('');

  async function run() {
    const raw = text.trim();
    if (!raw) return;
    setWorking(true); setNote('');
    const parts = await window.oblako.parseAddressText(raw).catch(() => [] as ParsedAddressPart[]);
    setWorking(false);
    if (parts.length === 0) {
      // Честный отказ. Причин две — модели нет либо строка не разобралась, — и человеку они
      // одинаковы: он просто заполняет поля руками, как раньше.
      setNote('Не разобралось — заполните поля вручную');
      return;
    }
    onParsed(parts);
    setText('');
    setNote(`Заполнено полей: ${parts.length}. Проверьте перед сохранением.`);
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
      <InputRow>
        <TextField
          value={text}
          placeholder="Вставьте адрес одной строкой — разложим по полям"
          onChange={setText}
          style={fieldFlex}
        />
        <button
          onClick={() => void run()}
          disabled={working || !text.trim()}
          style={{ ...btnGhost, opacity: working || !text.trim() ? 0.6 : 1 }}
        >
          {working ? 'Разбираю…' : 'Разобрать'}
        </button>
      </InputRow>
      {note && <div style={{ fontSize: 'var(--fs-xs)', color: 'var(--text-faint)' }}>{note}</div>}
    </div>
  );
}

// ── Форма карты ───────────────────────────────────────────────────────────────
function CardForm({ initial, onCancel, onSaved }: { initial: CardMeta | null; onCancel: () => void; onSaved: () => void }) {
  const editing = initial !== null;
  const [cardholder, setCardholder] = useState(initial?.cardholder ?? '');
  const [number, setNumber] = useState('');
  const [expMonth, setExpMonth] = useState(initial ? String(initial.expMonth || '') : '');
  const [expYear, setExpYear] = useState(initial ? String(initial.expYear || '') : '');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  async function save() {
    const digits = number.replace(/\D/g, '');
    if (!editing && digits.length < 12) { setError('Введите номер карты'); return; }
    const m = Number(expMonth), y = normalizeYear(expYear);
    setSaving(true); setError('');
    const ok = editing
      // Пустой номер при редактировании — не менять (undefined). Непустой — заменить.
      ? await window.oblako.updateCard({ id: initial.id, cardholder, expMonth: m, expYear: y, number: digits ? digits : undefined })
      : await window.oblako.addCard({ cardholder, number: digits, expMonth: m, expYear: y });
    setSaving(false);
    if (ok) onSaved(); else setError('Не удалось сохранить');
  }

  return (
    <div style={formStyle}>
      <TextField value={cardholder} placeholder="Владелец карты" onChange={setCardholder} />
      <TextField
        value={number} mono
        placeholder={editing ? 'Новый номер (пусто — не менять)' : 'Номер карты'}
        onChange={(v) => setNumber(v)}
      />
      <InputRow>
        <TextField value={expMonth} placeholder="Месяц (MM)" onChange={setExpMonth} style={fieldFlex} />
        <TextField value={expYear} placeholder="Год (ГГ или ГГГГ)" onChange={setExpYear} style={fieldFlex} />
      </InputRow>
      {error && <InlineError>{error}</InlineError>}
      <div style={{ display: 'flex', gap: 8 }}>
        <button onClick={() => void save()} disabled={saving} style={{ ...btnPrimary, opacity: saving ? 0.6 : 1 }}>
          {saving ? 'Сохранение…' : 'Сохранить'}
        </button>
        <button onClick={onCancel} style={btnGhost}>Отмена</button>
      </div>
    </div>
  );
}

const formStyle: React.CSSProperties = {
  display: 'flex', flexDirection: 'column', gap: 12, padding: '16px 16px',
  ...settingsBox,
};

// «29» → 2029, «2029» → 2029. 0/пусто → 0 (main отбросит как невалидный).
function normalizeYear(s: string): number {
  const n = Number(s.replace(/\D/g, ''));
  if (!n) return 0;
  return n < 100 ? 2000 + n : n;
}

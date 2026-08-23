import { Shield, ShieldOff, Plus, Trash2, RotateCcw } from 'lucide-react';
import type { AdBlockState } from '../../../shared/ipc';
import Toggle from '../Toggle';
import {
  btnPrimary, btnGhost, IconBtn, SectionHeader, CapsLabel, LoadingNote,
  StatusCard, TextField, InputRow, fieldFlex, OptionList, settingsBox,
} from './kit';

// ── Секция «Блокировка рекламы» ───────────────────────────────────────────────

interface AdBlockSectionProps {
  state: AdBlockState | null;
  domainInput: string;
  inputError: string;
  pendingReload: string | null;
  inputRef: React.RefObject<HTMLInputElement>;
  onToggle: () => void;
  onDomainChange: (v: string) => void;
  onAddDomain: () => void;
  onRemoveDomain: (domain: string) => void;
  onReload: () => void;
  onDismissReload: () => void;
}

export default function AdBlockSection({
  state, domainInput, inputError, pendingReload, inputRef,
  onToggle, onDomainChange, onAddDomain, onRemoveDomain, onReload, onDismissReload,
}: AdBlockSectionProps) {
  if (!state) {
    return <LoadingNote />;
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 24, maxWidth: 560 }}>
      {/* ⚠️ Герой — счётчик за сеанс, а не название раздела: ради этого числа сюда и заходят.
          Раньше оно лежало подписью внутри строки состояния, тем же кеглем, что и всё остальное. */}
      <SectionHeader
        title="Блокировка рекламы"
        hero={state.sessionBlockCount.toLocaleString('ru')}
        heroLabel={state.sessionBlockCount === 1 ? 'запрос заблокирован за сеанс' : 'запросов заблокировано за сеанс'}
      >
        EasyList и EasyPrivacy на уровне сетевых запросов — быстрее расширений браузера.
      </SectionHeader>

      {/* Уведомление о перезагрузке */}
      {pendingReload !== null && (
        <div style={{
          display: 'flex', alignItems: 'center', gap: 12, padding: '12px 16px', flexWrap: 'wrap',
          ...settingsBox,
          borderRadius: 'var(--radius-sm)', fontSize: 'var(--fs-sm)',
        }}>
          <RotateCcw size={15} style={{ color: 'var(--warning-500)', flex: 'none' }} />
          <span style={{ flex: '1 1 160px', minWidth: 0, color: 'var(--text-body)' }}>
            {pendingReload === 'all'
              ? 'Обновить открытые вкладки, чтобы применить изменения?'
              : `Обновить вкладки ${pendingReload}?`}
          </span>
          <button onClick={onReload} style={btnPrimary}>Обновить</button>
          <button onClick={onDismissReload} style={btnGhost}>Позже</button>
        </div>
      )}

      {/* Тумблер */}
      <StatusCard
        icon={state.enabled
          ? <Shield size={22} style={{ color: 'var(--text-body)', flex: 'none' }} />
          : <ShieldOff size={22} style={{ color: 'var(--text-faint)', flex: 'none' }} />}
        title={state.enabled ? 'Блокировка включена' : 'Блокировка выключена'}
        // ⚠️ Счётчик отсюда УБРАН: он теперь герой шапки. Одно и то же число, сказанное дважды
        // на одном экране, — это не «подчеркнули важное», а шум.
        subtitle={state.enabled ? 'Реклама и трекеры режутся на всех сайтах, кроме исключений' : 'Сайты грузятся как есть'}
        actions={<Toggle checked={state.enabled} onChange={onToggle} />}
      />

      {/* Исключения */}
      <div>
        <CapsLabel>Исключения</CapsLabel>
        <p style={{ margin: '0 0 12px', fontSize: 'var(--fs-sm)', color: 'var(--text-faint)' }}>
          На этих сайтах реклама блокироваться не будет.
          Домен покрывает и все поддомены (например, www.example.com).
        </p>

        {/* Список исключений */}
        {state.whitelist.length > 0 && (
          <div style={{ marginBottom: 12 }}>
            <OptionList>
            {state.whitelist.map((domain) => (
              // Заливки у строки нет: группу держит рамка списка (разбор — в kit.tsx).
              <div key={domain} style={{
                display: 'flex', alignItems: 'center', gap: 12, padding: '8px 12px',
              }}>
                <span style={{
                  flex: 1, fontSize: 'var(--fs-sm)', color: 'var(--text-body)', fontFamily: 'var(--font-mono)',
                  minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                }}>
                  {domain}
                </span>
                <IconBtn title="Убрать из исключений" onClick={() => onRemoveDomain(domain)}>
                  <Trash2 size={14} />
                </IconBtn>
              </div>
            ))}
            </OptionList>
          </div>
        )}

        {/* Добавить домен */}
        <InputRow>
          <TextField
            inputRef={inputRef}
            value={domainInput}
            placeholder="example.com"
            onChange={onDomainChange}
            onEnter={onAddDomain}
            error={inputError || undefined}
            style={fieldFlex}
          />
          <button onClick={onAddDomain} style={{ ...btnPrimary, alignSelf: 'flex-start', display: 'flex', gap: 8, alignItems: 'center' }}>
            <Plus size={14} /> Добавить
          </button>
        </InputRow>
      </div>
    </div>
  );
}


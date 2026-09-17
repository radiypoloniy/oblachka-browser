import { Plus, Trash2, RotateCcw } from 'lucide-react';
import { sp } from '../../styles/system';
import type { AdBlockState } from '../../../shared/ipc';
import Toggle from '../Toggle';
import { useLanguage } from '../../i18n';
import {
  btnPrimary, btnGhost, IconBtn, SectionHeader, CapsLabel, LoadingNote, MasterSwitch, FactGrid, Fact,
  TextField, InputRow, fieldFlex, OptionList, settingsBox,
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

/**
 * Склонение существительного при числе.
 *
 * ⚠️ Живёт здесь, а не в shared: это единственное место, где понадобилось, и тащить ради трёх
 * строк модуль под отдельную проверку — накладнее, чем польза. Понадобится второй раз — тогда и
 * переедет, вместе со случаями.
 */
function plural(n: number, one: string, few: string, many: string): string {
  const mod10 = n % 10;
  const mod100 = n % 100;
  if (mod10 === 1 && mod100 !== 11) return one;
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14)) return few;
  return many;
}

export default function AdBlockSection({
  state, domainInput, inputError, pendingReload, inputRef,
  onToggle, onDomainChange, onAddDomain, onRemoveDomain, onReload, onDismissReload,
}: AdBlockSectionProps) {
  const { language, t } = useLanguage();
  if (!state) {
    return <LoadingNote />;
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: sp(6) }}>
      {/* ⚠️ Герой — счётчик за сеанс, а не название раздела: ради этого числа сюда и заходят.
          Раньше оно лежало подписью внутри строки состояния, тем же кеглем, что и всё остальное. */}
      <SectionHeader
        title={t('Блокировка рекламы')}
        hero={state.sessionBlockCount.toLocaleString(language === 'en' ? 'en' : 'ru')}
        heroLabel={state.sessionBlockCount === 1 ? t('запрос заблокирован за сеанс') : t('запросов заблокировано за сеанс')}
      >
        {t('EasyList и EasyPrivacy на уровне сетевых запросов — быстрее расширений браузера.')}
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
              ? t('Обновить открытые вкладки, чтобы применить изменения?')
              : t('Обновить вкладки {n}?', { n: pendingReload })}
          </span>
          <button onClick={onReload} style={btnPrimary}>{t('Обновить')}</button>
          <button onClick={onDismissReload} style={btnGhost}>{t('Позже')}</button>
        </div>
      )}

      {/* ⚠️ Главный переключатель — КАРТОЧКА, а не строка списка: ради него раздел чаще всего и
          открывают, а лежал он наравне с остальным. Счётчик отсюда убран, он герой шапки: одно
          число дважды на экране — шум, а не акцент. */}
      <MasterSwitch
        on={state.enabled}
        title={state.enabled ? t('Блокировка включена') : t('Блокировка выключена')}
        description={state.enabled
          ? t('Реклама и трекеры режутся на всех сайтах, кроме исключений ниже')
          : t('Сайты грузятся как есть — со всей рекламой и счётчиками')}
        control={<Toggle checked={state.enabled} onChange={onToggle} />}
      />

      {/* ⚠️ Четыре факта СЕТКОЙ, а не списком: в списке глаз разбирает каждую строку отдельно,
          в сетке они схватываются разом. Здесь это ровно те вопросы, на которые раздел обязан
          отвечать сразу: что режется, где не режется и откуда правила. */}
      <FactGrid>
        <Fact
          label={t('Трекеры')}
          hint={t('Скрытая слежка за переходами')}
          value={state.enabled ? t('Режем') : t('Пропускаем')}
          active={state.enabled}
        />
        <Fact
          label={t('Баннеры')}
          hint={t('Сетевой блок и косметика')}
          value={state.enabled ? t('Режем') : t('Пропускаем')}
          active={state.enabled}
        />
        <Fact
          label={t('Исключения')}
          hint={t('Сайты, где реклама разрешена')}
          value={state.whitelist.length === 0 ? t('Нет') : `${state.whitelist.length} ${t(plural(state.whitelist.length, 'сайт', 'сайта', 'сайтов'))}`}
        />
        <Fact
          label={t('Списки фильтров')}
          hint={t('EasyList и EasyPrivacy')}
          value={t('2 списка')}
        />
      </FactGrid>

      {/* Исключения */}
      <div>
        <CapsLabel>{t('Исключения')}</CapsLabel>
        <p style={{ margin: '0 0 12px', fontSize: 'var(--fs-sm)', color: 'var(--text-faint)' }}>
          {t('На этих сайтах реклама блокироваться не будет. Домен покрывает и все поддомены (например, www.example.com).')}
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
                <IconBtn title={t('Убрать из исключений')} onClick={() => onRemoveDomain(domain)}>
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
            <Plus size={14} /> {t('Добавить')}
          </button>
        </InputRow>
      </div>
    </div>
  );
}


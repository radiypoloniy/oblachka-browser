import { useEffect, useRef, useState } from 'react';
import { X, Shield, ShieldCheck, Wifi, Cpu, Palette, Lock, SlidersHorizontal, CreditCard, Wand2, type LucideIcon } from 'lucide-react';
import type { AdBlockState } from '../../shared/ipc';
import { islandPlate } from '../styles/island';
import AdBlockSection from './settings/AdBlockSection';
import VpnSection from './settings/VpnSection';
import AiSection from './settings/AiSection';
import PasswordsSection from './settings/PasswordsSection';
import AutofillSection from './settings/AutofillSection';
import GeneralSection from './settings/GeneralSection';
import PermissionsSection from './settings/PermissionsSection';
import AppearanceSection from './settings/AppearanceSection';
import RulesSection from './settings/RulesSection';
import { useRubberBand } from '../rubberBand';

interface SettingsProps {
  onClose: () => void;
  // Открыть диалог импорта данных из другого браузера — модалка живёт в App.tsx (поверх всего
  // chrome), Settings только прокидывает команду в раздел «Браузер» (см. ImportDialog.tsx).
  onOpenImport: () => void;
  // Начальный раздел (напр. кнопка "+" в AI-панели открывает сразу на 'ai') — приходит из
  // TabState.section (shared/ipc.ts), который типизирован просто string (main-процесс не знает
  // SectionId), поэтому валидируем через isSectionId ниже, а не доверяем типу проп напрямую.
  defaultSection?: string;
  // Человек переключил раздел. Нужно App.tsx: вкладка настроек — псевдо-вкладка, и при уходе на
  // другую вкладку этот компонент РАЗМОНТИРУЕТСЯ, унося свой useState. Без этого колбэка человек,
  // заглянувший в соседнюю вкладку, возвращался в настройки на самый верх — и так каждый раз.
  onSectionChange?: (section: string) => void;
}

// Секции левого меню — «Блокировка» и «AI» рабочие, VPN/Интерфейс — placeholder для будущих
// этапов. soon — единственный флаг, гоняющий и активность, и клик, и стиль (см. рендер-цикл
// ниже) — точечно снят только у 'ai', остальные пункты и их поведение не тронуты.
type NavItem = { id: string; label: string; Icon: LucideIcon; soon?: boolean; tint: string };
// Цвет значка — опознавательный знак раздела, как в настройках iOS: глаз находит нужную
// строку по пятну раньше, чем прочитает подпись. Токены --tile-* живут в colors.css.
// ⚠️ ПОРЯДОК ЗДЕСЬ — ЭТО РАНЖИРОВАНИЕ ПО ЧАСТОТЕ ОБРАЩЕНИЯ, а не история появления разделов.
// Сверху то, ради чего настройки открывают регулярно, снизу — то, куда заходят однажды или по
// случаю. Раскладка: база браузера → внешний вид (самое частое «покрутить») → защита →
// AI → свои данные → редкое.
// ⚠️ VPN и «Блокировка» стоят подряд намеренно: в тулбаре они уже объединены в один поповер
// «Защита», и порядок в настройках обязан соглашаться с тем, как человек их видит там.
// ⚠️ Первый пункт этого списка — раздел ПО УМОЛЧАНИЮ (см. FIRST_SECTION ниже). Отдельной
// константы с именем раздела заводить нельзя: она уже расходилась с меню (см. isSectionId).
const NAV_ITEMS: NavItem[] = [
  { id: 'general',    label: 'Браузер',        Icon: SlidersHorizontal, tint: 'var(--tile-grey)' },
  { id: 'appearance', label: 'Интерфейс',      Icon: Palette,           tint: 'var(--tile-pink)' },
  { id: 'vpn',        label: 'VPN',            Icon: Wifi,              tint: 'var(--tile-blue)' },
  { id: 'adblock',    label: 'Блокировка',     Icon: Shield,            tint: 'var(--tile-green)' },
  { id: 'ai',         label: 'AI',             Icon: Cpu,               tint: 'var(--tile-teal)' },
  { id: 'passwords',  label: 'Пароли',         Icon: Lock,              tint: 'var(--tile-grey)' },
  { id: 'autofill',   label: 'Автозаполнение', Icon: CreditCard,        tint: 'var(--tile-orange)' },
  { id: 'permissions', label: 'Разрешения',    Icon: ShieldCheck,       tint: 'var(--tile-slate)' },
  // Правила стоят последними как самое редкое, но по-прежнему отдельным разделом, а не блоком
  // внутри AI: фразу разбирает модель, а исполняются они обычным кодом и живут без модели.
  { id: 'rules',      label: 'Правила',        Icon: Wand2,             tint: 'var(--tile-brown)' },
];
type SectionId = 'general' | 'adblock' | 'vpn' | 'ai' | 'rules' | 'passwords' | 'autofill' | 'permissions' | 'appearance';

// ⚠️ Проверка идёт по САМОМУ меню, а не по своему списку строк. Отдельный список тут уже
// разошёлся с NAV_ITEMS однажды (новый раздел «Правила» существовал в меню, но открыть его
// по имени было нельзя — приходило 'rules', проверка его не знала, и открывалась «Блокировка»).
function isSectionId(v: unknown): v is SectionId {
  return typeof v === 'string' && NAV_ITEMS.some((item) => item.id === v);
}

// Раздел по умолчанию — ПЕРВЫЙ пункт меню, а не имя, вписанное руками. Раньше здесь стояло
// 'adblock', и настройки открывались на «Блокировке» — втором пункте сверху, при том что глаз
// ждёт первый. Ошибка того же рода, что уже была с isSectionId: отдельно записанное имя раздела
// расходится с меню молча, и заметить это можно только глазами.
const FIRST_SECTION = NAV_ITEMS[0].id as SectionId;

export default function Settings({ onClose, defaultSection, onOpenImport, onSectionChange }: SettingsProps) {
  // Пружинистая отдача на краях прокрутки — своя, платформа такого не даёт.
  const scrollRef = useRef<HTMLDivElement | null>(null);
  useRubberBand(scrollRef);
  const [section, setSection] = useState<SectionId>(isSectionId(defaultSection) ? defaultSection : FIRST_SECTION);
  // Смена раздела идёт через одну дверь: и локальный стейт (перерисовка), и наверх в App.tsx
  // (переживает размонтирование при переключении вкладок).
  const goToSection = (next: SectionId) => { setSection(next); onSectionChange?.(next); };
  const [state, setState] = useState<AdBlockState | null>(null);
  const [domainInput, setDomainInput] = useState('');
  const [inputError, setInputError] = useState('');
  // 'all' → перезагрузить все; string → перезагрузить только этот домен; null → нет pending
  const [pendingReload, setPendingReload] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  // Подписываемся на push-обновления из main (счётчик, whitelist, enabled)
  useEffect(() => {
    let mounted = true;
    window.oblako.getAdBlockState().then((s) => { if (mounted) setState(s); });
    const unsub = window.oblako.onAdBlockStateChanged((s) => { if (mounted) setState(s); });
    return () => { mounted = false; unsub(); };
  }, []);

  function handleToggle() {
    if (!state) return;
    void window.oblako.setAdBlockEnabled(!state.enabled);
    setPendingReload('all');
  }

  function handleAddDomain() {
    const raw = domainInput.trim();
    if (!raw) return;
    // Базовая проверка на что-то похожее на домен
    const cleaned = raw.replace(/^https?:\/\//i, '').replace(/^www\./i, '').split('/')[0]!;
    if (!cleaned || !cleaned.includes('.')) {
      setInputError('Введите домен, например: reddit.com');
      return;
    }
    setInputError('');
    void window.oblako.adBlockAddDomain(raw);
    setDomainInput('');
    setPendingReload(cleaned.toLowerCase());
    inputRef.current?.focus();
  }

  function handleRemoveDomain(domain: string) {
    void window.oblako.adBlockRemoveDomain(domain);
    setPendingReload(domain);
  }

  function handleReload() {
    if (pendingReload === null) return;
    void window.oblako.adBlockReloadTabs(pendingReload === 'all' ? undefined : pendingReload);
    setPendingReload(null);
  }

  return (
    <div className="settings-root" style={{
      display: 'flex', flexDirection: 'column', height: '100%',
      overflow: 'hidden',
      // Тот же "остров", что у сайдбара (Sidebar.tsx::asideBase) — см. подробный комментарий
      // в History.tsx (тот же приём). Отступ по периметру не здесь — уже даёт contentRef margin
      // в App.tsx.
      ...islandPlate,
      borderRadius: 'var(--radius-island)',
      boxShadow: 'var(--shadow-island)',
      background: 'var(--surface-solid)',
    }}>
      {/* Шапка */}
      <div style={{
        display: 'flex', alignItems: 'center', gap: 12, padding: '18px 24px',
        borderBottom: '1px solid var(--divider-strong)', flex: 'none',
      }}>
        <span style={{ fontSize: 'var(--fs-lg)', fontWeight: 700, color: 'var(--text-strong)', flex: 1 }}>
          Настройки
        </span>
        <button
          onClick={onClose}
          style={{
            border: 'none', background: 'transparent', cursor: 'default', padding: 6,
            borderRadius: 'var(--radius-sm)', color: 'var(--text-faint)', display: 'inline-flex',
          }}
          onMouseEnter={(e) => (e.currentTarget.style.background = 'var(--surface-hover)')}
          onMouseLeave={(e) => (e.currentTarget.style.background = 'transparent')}
        ><X size={18} /></button>
      </div>

      {/* Тело: левое меню + контент */}
      <div style={{ display: 'flex', flex: 1, minHeight: 0 }}>
        {/* Левая навигация */}
        <nav className="settings-nav" style={{
          width: 200, flex: 'none', borderRight: '1px solid var(--divider-strong)',
          padding: '12px 8px', display: 'flex', flexDirection: 'column', gap: 2,
        }}>
          {NAV_ITEMS.map(({ id, label, Icon, soon, tint }) => {
            const active = section === id && !soon;
            return (
              <button
                key={id}
                className="settings-nav-item"
                disabled={!!soon}
                onClick={() => { if (!soon) goToSection(id as SectionId); }}
                title={label}
                aria-label={label}
                style={{
                  display: 'flex', alignItems: 'center', gap: 10,
                  padding: '9px 12px', borderRadius: 'var(--radius-sm)', border: 'none',
                  background: active ? 'var(--surface)' : 'transparent',
                  boxShadow: active ? 'var(--shadow-card)' : 'none',
                  color: soon ? 'var(--text-faint)' : active ? 'var(--text-strong)' : 'var(--text-body)',
                  cursor: soon ? 'default' : 'default',
                  fontWeight: active ? 600 : 400,
                  fontSize: 'var(--fs-sm)',
                  textAlign: 'left', width: '100%',
                  opacity: soon ? 0.45 : 1,
                }}
                onMouseEnter={(e) => { if (!active && !soon) e.currentTarget.style.background = 'var(--surface-hover)'; }}
                onMouseLeave={(e) => { if (!active && !soon) e.currentTarget.style.background = 'transparent'; }}
              >
                {/* Квадратик со скруглением и белым глифом — та же плитка, что у псевдо-вкладок
                    в сайдбаре (src/styles/tabKindTile.ts), чтобы язык значков был один.
                    ⚠️ Плитка 28, а не 22, и глиф 18, а не 13. Прежние 13 px — это 0.54 сетки
                    lucide (все иконки набора нарисованы на 24), то есть каждая линия рисунка
                    попадала между пикселями, а обводка 2.4 давала на экране 1.3 px и
                    размазывалась на два. Внутренние детали — грани куба, зубцы ключа, лепестки
                    палитры — на таком размере просто не выживали. 18 = ровно три четверти сетки
                    при штатной толщине 2. */}
                <span style={{
                  width: 28, height: 28, flex: 'none', borderRadius: 8,
                  background: tint ?? 'var(--tile-grey)', color: '#fff',
                  display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
                }}>
                  <Icon size={18} strokeWidth={2} />
                </span>
                <span className="settings-nav-label">{label}</span>
                {soon && (
                  <span className="settings-nav-badge" style={{ marginLeft: 'auto', fontSize: 'var(--fs-xs)', color: 'var(--text-faint)', fontWeight: 400 }}>
                    скоро
                  </span>
                )}
              </button>
            );
          })}
        </nav>

        {/* Контент выбранной секции */}
        {/* key по разделу — чтобы React пересоздал узел и CSS-анимация сыграла заново:
            без пересоздания браузер считает элемент тем же и проигрывать отказывается. */}
        {/* ⚠️ key висит на ВНУТРЕННЕЙ обёртке, а не на контейнере прокрутки: контейнер обязан
            пережить смену раздела, иначе слушатель колеса остаётся на выброшенном узле и
            резинка работает ровно один раз. Обёртка же нужна самой отдаче — двигать надо
            содержимое, а не контейнер, иначе уедут его края и полоса прокрутки. */}
        <div ref={scrollRef} style={{ flex: 1, overflow: 'auto', padding: '24px 32px' }}>
          <div key={section} className="oblako-section-in">
          {section === 'general' && <GeneralSection onOpenImport={onOpenImport} />}
          {section === 'adblock' && (
            <AdBlockSection
              state={state}
              domainInput={domainInput}
              inputError={inputError}
              pendingReload={pendingReload}
              inputRef={inputRef}
              onToggle={handleToggle}
              onDomainChange={(v) => { setDomainInput(v); setInputError(''); }}
              onAddDomain={handleAddDomain}
              onRemoveDomain={handleRemoveDomain}
              onReload={handleReload}
              onDismissReload={() => setPendingReload(null)}
            />
          )}
          {section === 'vpn' && <VpnSection />}
          {section === 'ai' && <AiSection />}
          {section === 'rules' && <RulesSection />}
          {section === 'passwords' && <PasswordsSection />}
          {section === 'autofill' && <AutofillSection />}
          {section === 'permissions' && <PermissionsSection />}
          {section === 'appearance' && <AppearanceSection />}
          </div>
        </div>
      </div>
    </div>
  );
}

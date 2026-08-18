import { useEffect, useRef, useState } from 'react';
import { X, Shield, ShieldCheck, Wifi, Cpu, Palette, Lock, SlidersHorizontal, CreditCard, Wand2, Search, Sparkles, type LucideIcon } from 'lucide-react';
import { searchSettings, isEntryAvailable, SETTINGS_INDEX, type SettingsEntry, type SettingsAvailability } from '../../shared/settingsIndex';
import type { AdBlockState } from '../../shared/ipc';
import { islandPlate, untintedPlateVars } from '../styles/island';
import { sp, pad, RADIUS, motion, selected } from '../styles/system';
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
type NavItem = { id: string; label: string; Icon: LucideIcon; soon?: boolean };
// Цвет значка — опознавательный знак раздела, как в настройках iOS: глаз находит нужную
// строку по пятну раньше, чем прочитает подпись. Токены --tile-* живут в colors.css.
// ⚠️ ПОРЯДОК ЗДЕСЬ — ЭТО РАНЖИРОВАНИЕ ПО ЧАСТОТЕ ОБРАЩЕНИЯ, а не история появления разделов.
// Сверху то, ради чего настройки открывают регулярно, снизу — то, куда заходят однажды или по
// случаю. Раскладка: база браузера → внешний вид (самое частое «покрутить») → AI → защита →
// свои данные → редкое.
// ⚠️ AI стоит ВЫШЕ защиты по решению 18.08: это и самый большой раздел, и то, ради чего браузер
// вообще существует, — а защита работает сама и настраивается один раз.
// ⚠️ VPN и «Блокировка» стоят подряд намеренно: в тулбаре они уже объединены в один поповер
// «Защита», и порядок в настройках обязан соглашаться с тем, как человек их видит там.
// ⚠️ Первый пункт этого списка — раздел ПО УМОЛЧАНИЮ (см. FIRST_SECTION ниже). Отдельной
// константы с именем раздела заводить нельзя: она уже расходилась с меню (см. isSectionId).
const NAV_ITEMS: NavItem[] = [
  { id: 'general',    label: 'Браузер',        Icon: SlidersHorizontal },
  { id: 'appearance', label: 'Интерфейс',      Icon: Palette },
  { id: 'ai',         label: 'AI',             Icon: Cpu },
  { id: 'vpn',        label: 'VPN',            Icon: Wifi },
  { id: 'adblock',    label: 'Блокировка',     Icon: Shield },
  { id: 'passwords',  label: 'Пароли',         Icon: Lock },
  { id: 'autofill',   label: 'Автозаполнение', Icon: CreditCard },
  { id: 'permissions', label: 'Разрешения',    Icon: ShieldCheck },
  // Правила стоят последними как самое редкое, но по-прежнему отдельным разделом, а не блоком
  // внутри AI: фразу разбирает модель, а исполняются они обычным кодом и живут без модели.
  { id: 'rules',      label: 'Правила',        Icon: Wand2 },
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
  // ── Поиск по настройкам (AI-IDEAS.md №6) ─────────────────────────────────
  const [query, setQuery] = useState('');
  // Что подсветить после перехода. Блок живёт в ЕЩЁ НЕ отрисованной секции, поэтому имя
  // запоминается, а ищется в DOM уже после смены раздела (см. эффект ниже).
  const [flashBlock, setFlashBlock] = useState<string | null>(null);
  // Второй эшелон: находки от модели, когда ключевые слова не дали ничего.
  const [smartHits, setSmartHits] = useState<SettingsEntry[]>([]);
  const [smartWorking, setSmartWorking] = useState(false);

  // ⚠️ Часть блоков рисуется, только когда им есть что показать, и предлагать их в поиске нельзя:
  // человек кликнет и не найдёт обещанного (живой случай — «Сертификаты Минцифры» у того, кто
  // никому не доверялся). Спрашиваем один раз при открытии настроек: список короткий и локальный.
  const [avail, setAvail] = useState<SettingsAvailability>({ certTrust: false });
  useEffect(() => {
    let mounted = true;
    void window.oblako.listCertTrust()
      .then((list) => { if (mounted) setAvail({ certTrust: list.length > 0 }); })
      .catch(() => { /* не узнали — значит условной настройки в выдаче не будет, это безопасный исход */ });
    return () => { mounted = false; };
  }, []);

  // Основной путь — мгновенный, без модели и без похода в main.
  const keywordHits = searchSettings(query, 5, avail);
  // ⚠️ Находки МОДЕЛИ фильтруем тем же условием: main про нарисованное на экране не знает и
  // предлагает ей весь реестр.
  const hits = keywordHits.length ? keywordHits : smartHits.filter((e) => isEntryAvailable(e, avail));

  // ⚠️ К модели идём ТОЛЬКО на промахе ключевых слов и с задержкой: человек печатает быстрее,
  // чем модель отвечает, а очередь генерации одна на приложение. На холодной модели main
  // ответит пустотой сразу (гейт isModelWarm) — фича при этом остаётся рабочей, просто без
  // второго эшелона.
  useEffect(() => {
    setSmartHits([]);
    const q = query.trim();
    if (keywordHits.length || q.length < 4) { setSmartWorking(false); return; }
    setSmartWorking(true);
    const timer = setTimeout(() => {
      void window.oblako.searchSettingsSmart(q)
        .then((idx) => setSmartHits(idx.map((i) => SETTINGS_INDEX[i]).filter(Boolean) as SettingsEntry[]))
        .catch(() => setSmartHits([]))
        .finally(() => setSmartWorking(false));
    }, 500);
    return () => { clearTimeout(timer); setSmartWorking(false); };
    // keywordHits пересчитывается на каждый рендер, поэтому в зависимостях ДЛИНА, а не он сам.
  }, [query, keywordHits.length]);

  const openHit = (entry: SettingsEntry) => {
    goToSection(entry.section as SectionId);
    setQuery('');
    setSmartHits([]);
    setFlashBlock(entry.block ?? null);
  };

  // Подсветка найденного блока. ⚠️ Через rAF: секция монтируется этим же рендером, и к моменту
  // выполнения эффекта её узлов в DOM ещё нет.
  useEffect(() => {
    if (!flashBlock) return;
    const id = requestAnimationFrame(() => {
      const el = scrollRef.current?.querySelector(`[data-setting-block="${CSS.escape(flashBlock)}"]`);
      setFlashBlock(null);
      if (!(el instanceof HTMLElement)) return;
      el.scrollIntoView({ block: 'center', behavior: 'smooth' });
      el.classList.add('oblako-setting-flash');
      // Класс снимаем, иначе повторный поиск того же блока не проиграет анимацию заново.
      setTimeout(() => el.classList.remove('oblako-setting-flash'), 1700);
    });
    return () => cancelAnimationFrame(id);
  }, [flashBlock, section]);

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
      // ⚠️ Высота 2 из системы «Высота»: тень ПЛЮС внутренний свет по верхней кромке. Свет —
      // то, чего в прежней системе не было совсем: он рисует физический край панели, и остров
      // перестаёт быть просто светлым прямоугольником на светлом (см. altitude в system.ts).
      boxShadow: 'var(--shadow-lvl3), var(--inner-light)',
      ...untintedPlateVars,
      background: 'var(--surface-solid)',
    }}>
      {/* Шапка */}
      <div style={{
        display: 'flex', alignItems: 'center', gap: 12, padding: '18px 24px',
        borderBottom: '1px solid var(--divider-strong)', flex: 'none',
      }}>
        <span style={{ fontSize: 'var(--fs-lg)', fontWeight: 700, color: 'var(--text-strong)', flex: 'none' }}>
          Настройки
        </span>

        {/* Поиск по настройкам. Разделов девять, блоков внутри — десятки, и найти нужный
            перебором меню человек не берётся. Работает БЕЗ модели (см. shared/settingsIndex.ts). */}
        <div style={{ flex: 1, position: 'relative', maxWidth: 320, marginLeft: 8 }}>
          <Search size={15} style={{
            position: 'absolute', left: 10, top: '50%', transform: 'translateY(-50%)',
            color: 'var(--text-faint)', pointerEvents: 'none',
          }} />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => {
              // Enter открывает первую находку — самый частый исход, ради которого сюда и пришли.
              if (e.key === 'Enter' && hits[0]) openHit(hits[0]);
              if (e.key === 'Escape') setQuery('');
            }}
            placeholder="Поиск по настройкам"
            style={{
              width: '100%', boxSizing: 'border-box',
              padding: '7px 10px 7px 30px', borderRadius: 'var(--radius-sm)',
              border: '1px solid var(--divider-strong)', background: 'var(--surface)',
              color: 'var(--text-strong)', fontSize: 'var(--fs-sm)', fontFamily: 'inherit',
              outline: 'none',
            }}
          />
          {query.trim().length >= 2 && (
            <div style={{
              position: 'absolute', top: 'calc(100% + 6px)', left: 0, right: 0, zIndex: 5,
              ...islandPlate, borderRadius: 'var(--radius-card)',
              background: 'var(--surface-solid)', boxShadow: 'var(--shadow-card)',
              padding: 4, display: 'flex', flexDirection: 'column', gap: 1,
            }}>
              {hits.map((entry) => (
                <button
                  key={`${entry.section}/${entry.block ?? ''}/${entry.label}`}
                  onClick={() => openHit(entry)}
                  style={{
                    display: 'flex', alignItems: 'center', gap: 8, width: '100%',
                    padding: '7px 9px', borderRadius: 'var(--radius-sm)', border: 'none',
                    background: 'transparent', cursor: 'default', textAlign: 'left',
                  }}
                  onMouseEnter={(e) => (e.currentTarget.style.background = 'var(--surface-hover)')}
                  onMouseLeave={(e) => (e.currentTarget.style.background = 'transparent')}
                >
                  <span style={{ flex: 1, minWidth: 0, fontSize: 'var(--fs-sm)', color: 'var(--text-strong)' }}>
                    {entry.label}
                  </span>
                  <span style={{ fontSize: 'var(--fs-xs)', color: 'var(--text-faint)', flex: 'none' }}>
                    {entry.sectionLabel}
                  </span>
                </button>
              ))}
              {/* ⚠️ Подпись про модель появляется, только когда находки пришли ОТ НЕЁ: человек
                  должен понимать, почему выдача другая по духу, чем при точном совпадении. */}
              {!keywordHits.length && (smartWorking || smartHits.length > 0) && (
                <div style={{
                  display: 'flex', alignItems: 'center', gap: 6,
                  padding: '6px 9px', fontSize: 'var(--fs-xs)', color: 'var(--text-faint)',
                }}>
                  <Sparkles size={12} />
                  {smartWorking ? 'Ищу по смыслу…' : 'Найдено по смыслу'}
                </div>
              )}
              {!hits.length && !smartWorking && (
                <div style={{ padding: '10px 9px', fontSize: 'var(--fs-sm)', color: 'var(--text-faint)' }}>
                  Ничего не нашлось
                </div>
              )}
            </div>
          )}
        </div>

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
          padding: pad(3, 2), display: 'flex', flexDirection: 'column', gap: sp(1) - 2,
        }}>
          {NAV_ITEMS.map(({ id, label, Icon, soon }) => {
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
                  display: 'flex', alignItems: 'center', gap: sp(3),
                  padding: pad(3), borderRadius: RADIUS.control, border: 'none',
                  background: 'transparent',
                  transition: motion.hover('background', 'color'),
                  // Заливка + полоса у края: одной заливки не хватало, активный пункт терялся.
                  ...selected(active),
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
                {/* ⚠️ Значок МОНОХРОМНЫЙ. Девять цветных плиток подряд были самым «недорогим»
                    элементом экрана: они соревновались и с акцентом, и с цветной землёй окна.
                    Правило системы: цветным бывает то, что принадлежит МИРУ (логотипы валют,
                    крипты, сайтов), а не нам. Цвет остался ровно у активного пункта.
                    Прежняя плитка — та же, что у псевдо-вкладок в сайдбаре (src/styles/tabKindTile.ts).
                    ⚠️ Плитка 28, а не 22, и глиф 18, а не 13. Прежние 13 px — это 0.54 сетки
                    lucide (все иконки набора нарисованы на 24), то есть каждая линия рисунка
                    попадала между пикселями, а обводка 2.4 давала на экране 1.3 px и
                    размазывалась на два. Внутренние детали — грани куба, зубцы ключа, лепестки
                    палитры — на таком размере просто не выживали. 18 = ровно три четверти сетки
                    при штатной толщине 2. */}
                <span style={{
                  width: 28, height: 28, flex: 'none',
                  color: active ? 'var(--accent)' : 'var(--text-muted)',
                  transition: motion.hover('color'),
                  display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
                }}>
                  <Icon size={18} strokeWidth={active ? 2.2 : 1.9} />
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
        <div ref={scrollRef} style={{ flex: 1, overflow: 'auto', padding: pad(6, 8) }}>
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

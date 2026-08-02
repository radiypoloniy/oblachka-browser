import { useEffect, useMemo, useState } from 'react';
import type React from 'react';
import { Shield, Sparkles, Check, Loader2, ArrowRight, ArrowLeft } from 'lucide-react';
import type { ImportSource, ImportDataType, ImportRunResult, ImportTypeResult } from '../../shared/ipc';
import { islandPlate } from '../styles/island';
import { btnPrimary, btnGhost } from './settings/kit';
import BrowserLogo from './BrowserLogo';
import { useScrim } from '../scrimState';

// Экран первого запуска: короткий рассказ о том, чем этот браузер отличается, и перенос данных
// из привычного браузера последним шагом.
//
// Почему рассказ идёт ПЕРЕД переносом: перенос — просьба к человеку, который ещё не понял, зачем
// ему эта программа. Сначала показываем, что он получит, потом просим доступ к его данным.
//
// ⚠️ Экран живёт в чроме (React), а не в своей вью, и это осознанно: на первом запуске активен
// хаб, страницы под ним нет, и нативной вью, которая перекрыла бы разметку, тоже нет. Как только
// человек закроет онбординг, всё вернётся к обычной жизни.

interface Props {
  onFinish: () => void;
}

interface Slide {
  emoji: string;
  title: string;
  text: string;
  art: React.ReactNode;
}

// ── Иллюстрации ───────────────────────────────────────────────────────────────
// Рисуем разметкой, а не картинками: интерфейс здесь и есть предмет разговора, а нарисованный
// теми же токенами он совпадает с тем, что человек увидит через минуту.

function ArtWelcome() {
  return (
    <div style={{ position: 'relative', display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100%' }}>
      {/* Мягкое свечение за облаком — единственный декоративный элемент во всём экране. */}
      <div style={{
        position: 'absolute', width: 230, height: 230, borderRadius: '50%',
        background: 'radial-gradient(circle, color-mix(in srgb, var(--accent) 26%, transparent) 0%, transparent 70%)',
      }} />
      <div style={{ fontSize: 112, lineHeight: 1, position: 'relative' }}>☁️</div>
    </div>
  );
}

function ArtProtection() {
  return (
    <ArtStack>
      <div style={{
        width: 116, height: 116, borderRadius: 'var(--radius-pill)',
        background: 'color-mix(in srgb, var(--dot-vpn) 16%, transparent)',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
      }}>
        <Shield size={56} style={{ color: 'var(--dot-vpn)' }} fill="var(--dot-vpn)" />
      </div>
      <div style={{ display: 'flex', gap: 8 }}>
        <Pill text="VPN включён" dot="var(--dot-vpn)" delay={120} />
        <Pill text="реклама скрыта" dot="var(--accent)" delay={220} />
      </div>
    </ArtStack>
  );
}

function ArtAi() {
  return (
    <ArtStack>
      <div style={{
        ...islandPlate, borderRadius: 'var(--radius-card)', padding: 16, width: 420,
        display: 'flex', flexDirection: 'column', gap: 10,
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <Sparkles size={16} style={{ color: 'var(--accent)' }} />
          <span style={{ fontSize: 'var(--fs-sm)', fontWeight: 600, color: 'var(--text-strong)' }}>Выделенный текст</span>
        </div>
        {/* Три действия — одной строкой: перенос «Объяснить» на вторую строку читался как
            обрезанная вёрстка, а не как список. */}
        <div style={{ display: 'flex', gap: 7, justifyContent: 'center' }}>
          {['Перевести', 'Пересказать', 'Объяснить'].map((t, i) => (
            <Pill key={t} text={t} delay={120 + i * 90} />
          ))}
        </div>
      </div>
      <Pill text="работает на вашем компьютере" dot="var(--dot-local)" delay={420} />
    </ArtStack>
  );
}

function ArtTabs() {
  // Схема окна: слева полоса вкладок, справа две половины разделённого экрана.
  return (
    <ArtStack>
      <div style={{
        ...islandPlate, borderRadius: 'var(--radius-card)', padding: 12, width: 360, height: 176,
        display: 'flex', gap: 10,
      }}>
        <div style={{ width: 88, display: 'flex', flexDirection: 'column', gap: 7 }}>
          {[0, 1, 2, 3].map((i) => (
            <div key={i} style={{
              height: 19, borderRadius: 'var(--radius-sm)',
              background: i === 1 ? 'var(--accent)' : 'var(--surface-sunken)',
              opacity: i === 1 ? 1 : 0.75,
              animation: `oblako-onb-rise var(--dur-slow) var(--ease-out) ${80 + i * 70}ms backwards`,
            }} />
          ))}
        </div>
        <div style={{ flex: 1, display: 'flex', gap: 8 }}>
          {[0, 1].map((i) => (
            <div key={i} style={{
              flex: 1, borderRadius: 'var(--radius-sm)', background: 'var(--surface-sunken)',
              animation: `oblako-onb-rise var(--dur-slow) var(--ease-out) ${260 + i * 110}ms backwards`,
            }} />
          ))}
        </div>
      </div>
      <Pill text="группы, закрепление, разделение экрана" delay={430} />
    </ArtStack>
  );
}

function ArtStack({ children }: { children: React.ReactNode }) {
  return (
    <div style={{
      height: '100%', display: 'flex', flexDirection: 'column',
      alignItems: 'center', justifyContent: 'center', gap: 14,
    }}>{children}</div>
  );
}

function Pill({ text, dot, delay = 0 }: { text: string; dot?: string; delay?: number }) {
  return (
    <span style={{
      display: 'inline-flex', alignItems: 'center', gap: 6,
      padding: '5px 11px', borderRadius: 'var(--radius-pill)',
      background: 'var(--surface-sunken)', color: 'var(--text-body)',
      fontSize: 'var(--fs-xs)', whiteSpace: 'nowrap',
      animation: `oblako-onb-rise var(--dur-slow) var(--ease-out) ${delay}ms backwards`,
    }}>
      {dot && <span style={{ width: 7, height: 7, borderRadius: '50%', background: dot, flex: 'none' }} />}
      {text}
    </span>
  );
}

const SLIDES: Slide[] = [
  {
    emoji: '👋',
    title: 'Привет! Это Oblako',
    text: 'Браузер, в котором защита и ИИ уже внутри — ставить и настраивать ничего не нужно.',
    art: <ArtWelcome />,
  },
  {
    emoji: '🛡️',
    title: 'Реклама и слежка — мимо',
    text: 'Блокировщик работает с первой секунды, а VPN включается одной кнопкой «Защита» в верхней панели.',
    art: <ArtProtection />,
  },
  {
    emoji: '✨',
    title: 'ИИ под рукой, а не в облаке',
    text: 'Выделите текст — переведём, пересчитаем в пересказ или объясним. Модель работает прямо на вашем компьютере.',
    art: <ArtAi />,
  },
  {
    emoji: '🗂️',
    title: 'Вкладки сбоку, порядок в голове',
    text: 'Список вкладок слева и целиком виден. Складывайте их в группы, закрепляйте нужные, делите экран пополам.',
    art: <ArtTabs />,
  },
];

const TYPE_LABELS: Record<ImportDataType, string> = {
  bookmarks: 'Закладки',
  history: 'История',
  passwords: 'Пароли',
};

function resultLine(type: ImportDataType, res: ImportTypeResult | null): string {
  const label = TYPE_LABELS[type];
  if (res === null) return `${label}: не удалось прочитать`;
  const parts = [`перенесено ${res.inserted}`];
  if (res.skipped > 0) parts.push(`уже были ${res.skipped}`);
  if (res.unsupported && res.unsupported > 0) parts.push(`не поддержано ${res.unsupported}`);
  return `${label}: ${parts.join(', ')}`;
}

export default function Onboarding({ onFinish }: Props) {
  useScrim(); // затемняем и нативную зону системных кнопок, см. src/scrimState.ts
  // step: 0..SLIDES.length-1 — рассказ, SLIDES.length — перенос данных.
  const [step, setStep] = useState(0);
  const [sources, setSources] = useState<ImportSource[] | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [checked, setChecked] = useState<Set<ImportDataType>>(new Set());
  const [running, setRunning] = useState(false);
  const [report, setReport] = useState<ImportRunResult | null>(null);

  const importStep = step === SLIDES.length;

  // Источники ищем заранее, ещё на слайдах: разбор профилей на диске занимает время, и к
  // последнему шагу список должен быть уже готов, а не появляться с задержкой.
  useEffect(() => {
    let alive = true;
    void window.oblako.listImportSources().then((list) => {
      if (!alive) return;
      setSources(list);
      if (list.length > 0) selectSource(list[0]);
    });
    return () => { alive = false; };
  }, []);

  const selected = useMemo(() => sources?.find((s) => s.id === selectedId) ?? null, [sources, selectedId]);

  // Стрелки — привычный способ листать презентацию. ⚠️ Назад с последнего шага разрешаем только
  // до отчёта: после переноса «вернуться» значило бы предложить сделать его ещё раз.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'ArrowRight' && step < SLIDES.length) setStep((s) => s + 1);
      if (e.key === 'ArrowLeft' && step > 0 && !report && !running) setStep((s) => s - 1);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [step, report, running]);

  function selectSource(source: ImportSource) {
    setSelectedId(source.id);
    setChecked(new Set(source.dataTypes));
    setReport(null);
  }

  function toggleType(type: ImportDataType) {
    setChecked((prev) => {
      const next = new Set(prev);
      if (next.has(type)) next.delete(type); else next.add(type);
      return next;
    });
  }

  async function handleRun() {
    if (!selected || checked.size === 0 || running) return;
    setRunning(true);
    setReport(null);
    try {
      const types = selected.dataTypes.filter((t) => checked.has(t));
      setReport(await window.oblako.runImport(selected.id, types));
    } finally {
      setRunning(false);
    }
  }

  const slide = SLIDES[step];

  return (
    <div style={{
      position: 'fixed', inset: 0, zIndex: 600,
      background: 'var(--scrim, rgba(0,0,0,0.4))',
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      // Экран нельзя закрыть кликом мимо: это не диалог, а первый разговор — выход из него
      // есть, но осознанный («Пропустить»/«Начать»).
    }}>
      <div style={{
        position: 'relative',
        width: 680, maxWidth: 'calc(100vw - 48px)', maxHeight: 'calc(100vh - 80px)',
        display: 'flex', flexDirection: 'column', overflow: 'hidden',
        ...islandPlate,
        borderRadius: 'var(--radius-island)',
        boxShadow: 'var(--shadow-island)',
        background: 'var(--surface-solid)',
      }}>
        {/* «Пропустить» — в углу, а не в ряду кнопок: это выход из разговора, а не шаг в нём.
            Внизу тогда остаются только «Назад» и «Дальше», и ряд читается как одно движение. */}
        <button
          onClick={onFinish}
          style={{
            position: 'absolute', top: 14, right: 18, zIndex: 1,
            border: 'none', background: 'transparent', cursor: 'default',
            color: 'var(--text-faint)', fontSize: 'var(--fs-sm)', padding: '6px 10px',
            borderRadius: 'var(--radius-sm)',
          }}
          onMouseEnter={(e) => { e.currentTarget.style.color = 'var(--text-body)'; }}
          onMouseLeave={(e) => { e.currentTarget.style.color = 'var(--text-faint)'; }}
        >
          Пропустить
        </button>

        {/* Сцена и текст — одним блоком с общим ключом по шагу: смена слайда проигрывает
            появление целиком, иначе картинка «переезжала» бы отдельно от подписи. */}
        <div key={step} style={{
          flex: 'none', animation: 'oblako-onb-rise var(--dur-slow) var(--ease-out)',
        }}>
          <div style={{ height: 260, padding: '28px 32px 0' }}>
            {importStep ? <ArtImport /> : slide.art}
          </div>

          <div style={{ padding: '26px 56px 0', textAlign: 'center' }}>
            {/* Крупно: это первый экран, который человек видит, и читать его он будет с
                расстояния вытянутой руки, а не вчитываясь. */}
            <div style={{
              fontSize: 'calc(var(--fs-xl) * 1.2)', fontWeight: 700,
              color: 'var(--text-strong)', lineHeight: 1.25,
            }}>
              {importStep ? '📦 Перенесём ваши данные?' : `${slide.emoji} ${slide.title}`}
            </div>
            <div style={{ marginTop: 12, fontSize: 'var(--fs-md)', color: 'var(--text-muted)', lineHeight: 1.55 }}>
              {importStep
                ? 'Закладки, история и пароли переедут из привычного браузера. В нём ничего не изменится — данные только копируются.'
                : slide.text}
            </div>
          </div>
        </div>

        {/* Тело шага переноса. На слайдах пусто — рассказ не должен прокручиваться. */}
        {importStep && (
          <div style={{ padding: '18px 28px 0', overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 14 }}>
            {sources === null ? (
              <Muted>Ищем браузеры на компьютере…</Muted>
            ) : sources.length === 0 ? (
              <Muted>Других браузеров с данными не нашлось — переносить нечего.</Muted>
            ) : (
              <>
                {/* Карточки тянутся по ширине ряда, а не стоят фиксированными марками по центру:
                    при двух найденных браузерах узкая пара в широком окне оставляла по бокам
                    пустоту и весь шаг выглядел незаполненным. */}
                <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', justifyContent: 'center' }}>
                  {sources.map((source) => {
                    const active = source.id === selectedId;
                    return (
                      <button
                        key={source.id}
                        onClick={() => selectSource(source)}
                        style={{
                          flex: '1 1 150px', maxWidth: 260, minWidth: 140,
                          padding: '16px 12px', borderRadius: 'var(--radius-card)',
                          border: 'none', cursor: 'default',
                          background: active ? 'var(--surface)' : 'transparent',
                          boxShadow: active ? '0 0 0 2px var(--accent) inset' : '0 0 0 1px var(--divider) inset',
                          display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 8,
                          transition: 'box-shadow var(--dur-fast) var(--ease-standard)',
                        }}
                      >
                        <BrowserLogo vendorId={source.id.split('::')[0]} label={source.label} />
                        <span style={{
                          fontSize: 'var(--fs-xs)', color: 'var(--text-body)',
                          maxWidth: '100%', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                        }}>{source.label}</span>
                      </button>
                    );
                  })}
                </div>

                {selected && !report && (
                  <div style={{ display: 'flex', gap: 8, justifyContent: 'center', flexWrap: 'wrap' }}>
                    {selected.dataTypes.map((type) => {
                      const on = checked.has(type);
                      return (
                        <button
                          key={type}
                          onClick={() => toggleType(type)}
                          style={{
                            display: 'inline-flex', alignItems: 'center', gap: 7,
                            padding: '7px 13px', borderRadius: 'var(--radius-pill)', border: 'none',
                            cursor: 'default', fontSize: 'var(--fs-sm)',
                            background: on ? 'var(--accent-soft)' : 'var(--surface-sunken)',
                            color: on ? 'var(--text-strong)' : 'var(--text-muted)',
                          }}
                        >
                          <span style={{
                            width: 16, height: 16, borderRadius: 5, flex: 'none',
                            background: on ? 'var(--accent)' : 'transparent',
                            border: on ? 'none' : '1.5px solid var(--divider-strong)',
                            display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
                          }}>{on && <Check size={12} style={{ color: 'var(--on-accent)' }} />}</span>
                          {TYPE_LABELS[type]}
                        </button>
                      );
                    })}
                  </div>
                )}

                {report && (
                  <div style={{
                    ...islandPlate, borderRadius: 'var(--radius-sm)', padding: '12px 14px',
                    display: 'flex', flexDirection: 'column', gap: 4,
                  }}>
                    {(Object.keys(report) as ImportDataType[]).map((type) => (
                      <div key={type} style={{ fontSize: 'var(--fs-sm)', color: 'var(--text-body)' }}>
                        ✅ {resultLine(type, report[type] ?? null)}
                      </div>
                    ))}
                  </div>
                )}
              </>
            )}
          </div>
        )}

        {/* Подвал. ⚠️ Всё по ЦЕНТРУ, в колонку: точки слева и кнопка справа тянули взгляд к
            краям, хотя весь экран выстроен по центральной оси, — от этого он и читался
            перекошенным. Здесь одна ось, и она совпадает с осью текста. */}
        <div style={{
          marginTop: 'auto', padding: '26px 32px 30px', flex: 'none',
          display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 18,
        }}>
          <div style={{ display: 'flex', gap: 7 }}>
            {[...SLIDES, null].map((_, i) => (
              <span key={i} style={{
                width: i === step ? 20 : 7, height: 7, borderRadius: 'var(--radius-pill)',
                background: i === step ? 'var(--accent)' : 'var(--divider-strong)',
                transition: 'width var(--dur-base) var(--ease-out), background var(--dur-base) var(--ease-standard)',
              }} />
            ))}
          </div>

          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            {/* Назад. ⚠️ Прячем только там, где возвращаться некуда (первый шаг) или уже
                бессмысленно (перенос сделан): предлагать «назад» после отчёта значило бы
                звать повторить импорт. */}
            {step > 0 && !report && !running && (
              <button
                style={{ ...bigGhost, display: 'inline-flex', alignItems: 'center', gap: 7 }}
                onClick={() => setStep((s) => s - 1)}
              >
                <ArrowLeft size={16} /> Назад
              </button>
            )}
            {importStep && !report && sources && sources.length > 0 && (
              <button style={bigGhost} onClick={onFinish}>Не сейчас</button>
            )}

            {importStep ? (
              report || !sources || sources.length === 0 ? (
                <button style={bigPrimary} onClick={onFinish}>Начать пользоваться</button>
              ) : (
                <button
                  style={{ ...bigPrimary, opacity: (checked.size === 0 || running) ? 0.5 : 1, display: 'inline-flex', alignItems: 'center', gap: 8 }}
                  onClick={() => void handleRun()}
                >
                  {running && <Loader2 size={15} style={{ animation: 'oblako-spin 1s linear infinite' }} />}
                  {running ? 'Переносим…' : 'Перенести'}
                </button>
              )
            ) : (
              <button
                style={{ ...bigPrimary, display: 'inline-flex', alignItems: 'center', gap: 8 }}
                onClick={() => setStep((s) => s + 1)}
              >
                Дальше <ArrowRight size={16} />
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

// Главная кнопка экрана крупнее обычной из kit.tsx: здесь она единственное действие на весь
// экран, и мелкая пилюля рядом с 26-пиксельным заголовком выглядела бы приставленной.
const bigPrimary: React.CSSProperties = {
  ...btnPrimary,
  padding: '11px 22px',
  fontSize: 'var(--fs-md)',
};

// Пара к ней: тихие кнопки того же роста, иначе ряд «Назад | Дальше» выглядит ступенькой.
const bigGhost: React.CSSProperties = {
  ...btnGhost,
  padding: '11px 18px',
  fontSize: 'var(--fs-md)',
};

function Muted({ children }: { children: React.ReactNode }) {
  return <div style={{ fontSize: 'var(--fs-sm)', color: 'var(--text-faint)', textAlign: 'center' }}>{children}</div>;
}

// Иллюстрация шага переноса: данные перетекают из чужого браузера в наш.
function ArtImport() {
  return (
    <ArtStack>
      <div style={{ display: 'flex', alignItems: 'center', gap: 18 }}>
        <div style={{
          width: 88, height: 88, borderRadius: 'var(--radius-card)', background: 'var(--surface-sunken)',
          display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 36,
        }}>🌐</div>
        <ArrowRight size={30} style={{
          color: 'var(--accent)',
          animation: 'oblako-onb-nudge 1.6s var(--ease-standard) infinite',
        }} />
        <div style={{
          width: 88, height: 88, borderRadius: 'var(--radius-card)',
          background: 'color-mix(in srgb, var(--accent) 14%, transparent)',
          display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 36,
        }}>☁️</div>
      </div>
      <div style={{ display: 'flex', gap: 8 }}>
        <Pill text="закладки" delay={120} />
        <Pill text="история" delay={200} />
        <Pill text="пароли" delay={280} />
      </div>
    </ArtStack>
  );
}

import { useEffect, useMemo, useRef, useState } from 'react';
import { Tile, TileCaption, TileValue, type WidgetProps } from './widgets';
import { DISPLAY, pad, RADIUS, sp } from '../../styles/system';
import {
  GEN_TOKEN_VARS, wrapGenSrcdoc, clampGenStorage, pickGenMode,
  parseGenDurationMs, genClockLeftMs, formatGenClock, extractGenLexicon, type GenFactId,
} from '../../../shared/genWidget';
import {
  loadGenRecord, loadGenState, loadGenClock, saveGenState, storeGenPhoto, subscribeGenStore,
  loadGenRuntime, saveGenRuntime,
} from '../../newtab/genStore';
import { startGenClock, pauseGenClock, resetGenClock } from '../../newtab/genClocks';
import { genFontCss } from '../../newtab/genFonts';
import { GEN_KIND_RENDERERS, GenTimerTile } from './genKinds';
import type { GenSpec } from '../../../shared/genSpec';

// Свой виджет. ДВА пути, и это не переходное состояние, а осознанная развилка:
//
// 1. СПЕКА (основной, с 22.08.2026) — модель отдала тип из каталога и данные, плитку рисует
//    genKinds.tsx обычным React'ом. Пустой такая плитка выйти не может.
// 2. РАЗМЕТКА (легаси) — записи, собранные старым способом, когда модель писала HTML сама.
//    Они уже лежат у людей на диске, и ломать их нельзя. Новых таких не появляется.
//
// ⚠️ Почему путь 1 заменил путь 2 — в шапке shared/genSpec.ts. Коротко: 4B не пишет рабочий
// интерфейс, а пустую плитку от рабочей человеку не отличить.

export function GenWidget(props: WidgetProps) {
  const { genId } = props;
  const [rev, setRev] = useState(0);
  useEffect(() => subscribeGenStore(() => setRev((n) => n + 1)), []);
  const rec = useMemo(() => (genId ? loadGenRecord(genId) : null), [genId, rev]);
  if (rec?.spec && genId) {
    return <GenSpecTile {...props} genId={genId} spec={rec.spec} rev={rev} />;
  }
  return <GenLegacyTile {...props} />;
}

/**
 * Плитка из спеки. Всё, что она делает, — выбирает рисовальщика по типу и хранит накликанное.
 *
 * ⚠️ Состояние (счётчик, галочки) лежит ОТДЕЛЬНО от спеки: пересборка виджета не имеет права
 * обнулить посчитанное человеком.
 */
function GenSpecTile({ spec, genId, box, fill, overImage, hero, rev, onOpen }: WidgetProps & {
  genId: string; spec: GenSpec; rev: number;
}) {
  const runtime = useMemo(() => loadGenRuntime(genId), [genId, rev]);
  const clock = useMemo(() => loadGenClock(genId), [genId, rev]);
  const durationMs = (spec.seconds ?? 1500) * 1000;
  const common = {
    spec, box, hero,
    runtime,
    onRuntime: (next: typeof runtime) => saveGenRuntime(genId, next),
    // Лента из браузера — единственная плитка со ссылками наружу: строка открывает сайт.
    onOpen,
  };
  return (
    <Tile surface toned fill={fill} overImage={overImage} hero={hero} padding={0}>
      {spec.kind === 'timer' ? (
        <GenTimerTile
          {...common}
          clock={clock}
          onStart={() => startGenClock(genId, durationMs, clock)}
          onPause={() => { if (clock) pauseGenClock(genId, clock); }}
          onReset={() => resetGenClock(genId, durationMs)}
        />
      ) : (() => {
        const Render = GEN_KIND_RENDERERS[spec.kind as keyof typeof GEN_KIND_RENDERERS];
        return Render ? <Render {...common} /> : null;
      })()}
    </Tile>
  );
}

function GenLegacyTile({
  fill, overImage, hero, genId, box,
}: WidgetProps) {
  const frameRef = useRef<HTMLIFrameElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const [rev, setRev] = useState(0);
  const [fonts, setFonts] = useState('');
  useEffect(() => subscribeGenStore(() => setRev((n) => n + 1)), []);
  useEffect(() => { void genFontCss().then(setFonts); }, []);
  const rec = useMemo(() => (genId ? loadGenRecord(genId) : null), [genId, rev]);
  const clock = useMemo(() => (genId ? loadGenClock(genId) : null), [genId, rev]);
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!clock || clock.endAt <= 0) return;
    const t = window.setInterval(() => setNow(Date.now()), 250);
    return () => window.clearInterval(t);
  }, [clock]);
  const [lexIdx, setLexIdx] = useState(0);
  const [facts, setFacts] = useState<Record<string, number | string>>({});
  // Доклад песочницы: отрисовалось ли хоть что-нибудь. null — ещё не докладывала.
  const [paint, setPaint] = useState<{ chars: number; painted: number } | null>(null);

  useEffect(() => {
    let alive = true;
    void collectFacts(rec?.facts ?? []).then((f) => { if (alive) setFacts(f); });
    return () => { alive = false; };
  }, [rec]);

  // ⚠️ Режим берём из ЗАПИСИ, а не переугадываем по HTML на каждом рендере: хост-рендерер
  // выбрасывает разметку модели целиком, и «угадал не то» здесь означает молча подменённый
  // виджет. У старых записей поля нет — считаем теми же правилами, что и при сборке.
  const mode = rec ? rec.mode ?? pickGenMode(rec.phrase ?? '', rec.html, rec.photo === true) : 'html';
  const photo = mode === 'photo';
  const timer = mode === 'timer';
  // ⚠️ Пусто = песочница доложила и не нарисовала НИЧЕГО: ни текста, ни заливки, ни рамки.
  // Это не придирка к вёрстке, а единственный способ отличить «модель написала рабочий код»
  // от «модель написала код с ошибкой»: во втором случае плитка молча оставалась пустой.
  const blank = !!rec && paint !== null && paint.chars === 0 && paint.painted === 0;
  // Спасение ровно того случая, ради которого словарь и заводился: код модели упал, но пары
  // слов в нём есть — рисуем их сами. ⚠️ Это ФОЛБЭК, а не перехват: рабочий виджет с массивом
  // пар внутри мы больше не трогаем (см. pickGenMode).
  const lexicon = rec && (mode === 'lexicon' || blank) ? extractGenLexicon(rec.html) : [];
  useEffect(() => { setPaint(null); }, [genId, rec?.html]);
  useEffect(() => {
    if (lexicon.length >= 4) setLexIdx(Math.floor(Math.random() * lexicon.length));
  }, [genId, rec?.html, lexicon.length]);
  const durationMs = rec ? parseGenDurationMs(rec.phrase ?? '') : 25 * 60_000;
  const photoData = rec?.photoData;
  const tokens = useMemo(() => {
    const t = readTokens();
    const num = Math.round(Math.min((box.width - 32) * 0.22, box.height * 0.34, 56));
    t['--gen-num'] = `${Math.max(28, num)}px`;
    return t;
  }, [rev, fill, hero, overImage, box.width, box.height]);

  const srcDoc = useMemo(() => {
    if (!rec || !genId || photo || timer || lexicon.length >= 4) return '';
    return wrapGenSrcdoc(rec.html, tokens, genId, fonts);
  }, [rec, tokens, genId, fonts, photo, timer, lexicon.length]);

  const assets = useMemo(
    () => (photoData ? { photo: photoData } : {}),
    [photoData],
  );

  useEffect(() => {
    const frame = frameRef.current;
    if (!frame || !genId) return;
    const sendFacts = () => {
      const curClock = loadGenClock(genId);
      frame.contentWindow?.postMessage({
        type: 'oblako-gen-facts',
        facts: {
          ...facts,
          ...(curClock ? {
            remainingMs: genClockLeftMs(curClock),
            endAt: curClock.endAt,
            running: curClock.endAt > 0 ? 1 : 0,
          } : {}),
        },
        assets,
      }, '*');
    };
    const onMsg = (e: MessageEvent) => {
      if (e.source !== frame.contentWindow) return;
      const data = e.data as {
        type?: string; widgetId?: string; req?: string; value?: unknown; seconds?: unknown;
        chars?: unknown; painted?: unknown; message?: unknown;
      };
      if (!data || data.widgetId !== genId) return;
      if (data.type === 'oblako-gen-ready') {
        sendFacts();
        return;
      }
      if (data.type === 'oblako-gen-painted') {
        setPaint({ chars: Number(data.chars) || 0, painted: Number(data.painted) || 0 });
        return;
      }
      if (data.type === 'oblako-gen-script-error') {
        console.warn('[gen-widget] код виджета упал:', data.message);
        return;
      }
      if (data.type === 'oblako-gen-timer-start') {
        const sec = typeof data.seconds === 'number' ? data.seconds : durationMs / 1000;
        startGenClock(genId, Math.max(1000, sec * 1000), loadGenClock(genId));
        return;
      }
      if (data.type === 'oblako-gen-timer-stop') {
        const cur = loadGenClock(genId);
        if (cur) pauseGenClock(genId, cur);
        return;
      }
      if (data.type === 'oblako-gen-pick-photo') {
        fileRef.current?.click();
        return;
      }
      if (data.type === 'oblako-gen-storage-get' && data.req) {
        frame.contentWindow?.postMessage({
          type: 'oblako-gen-storage', req: data.req, value: loadGenState(genId),
        }, '*');
        return;
      }
      if (data.type === 'oblako-gen-storage-set') {
        saveGenState(genId, clampGenStorage(data.value));
      }
    };
    window.addEventListener('message', onMsg);
    sendFacts();
    return () => window.removeEventListener('message', onMsg);
  }, [genId, facts, assets, durationMs, rev]);

  async function onPick(file: File | undefined) {
    if (!file || !genId) return;
    const raw = await readFileDataUrl(file);
    const ok = await storeGenPhoto(genId, raw);
    if (!ok) console.warn('[gen-widget] фото не влезло в хранилище');
  }

  const pick = (): void => { fileRef.current?.click(); };

  const leftMs = clock ? genClockLeftMs(clock, now) : durationMs;
  const timeStr = formatGenClock(leftMs);
  const fs = Math.round(Math.min(
    box.height * 0.42,
    (box.width - 32) / (timeStr.length * 0.78),
    92,
  ));
  const pair = lexicon[Math.min(lexIdx, Math.max(0, lexicon.length - 1))];
  const heroText = pair?.[0] ?? '';
  const subText = pair?.[1] ?? '';
  const long = heroText.length > 22;
  const wordFs = Math.round(Math.min(
    long ? box.height * 0.16 : box.height * 0.32,
    long
      ? (box.width - 32) / (Math.min(heroText.length, 18) * 0.42)
      : (box.width - 32) / (Math.max(heroText.length, 1) * 0.62),
    long ? 28 : 56,
  ));

  return (
    <Tile surface toned fill={fill} overImage={overImage} hero={hero} padding={0}>
      {timer && rec && genId && (
        <div style={{
          display: 'flex', flexDirection: 'column', height: '100%', padding: pad(4), gap: sp(2),
        }}>
          <TileCaption>{rec.title || 'Таймер'}</TileCaption>
          <div style={{ flex: 1, display: 'flex', flexDirection: 'column', justifyContent: 'center' }}>
            <TileValue size={fs} hero={hero}>{timeStr}</TileValue>
            <div style={{ fontSize: 'var(--fs-sm)', color: 'var(--text-faint)', marginTop: sp(2) }}>
              {clock?.beeped ? 'Готово' : clock && clock.endAt > 0 ? 'Идёт' : 'Пауза'}
            </div>
          </div>
          <div style={{ display: 'flex', gap: sp(2) }}>
            <button
              type="button"
              onClick={() => {
                if (clock && clock.endAt > 0) pauseGenClock(genId, clock);
                else startGenClock(genId, durationMs, clock);
              }}
              style={{
                flex: 1, border: 'none', cursor: 'default', padding: pad(2, 3),
                borderRadius: RADIUS.control, background: 'var(--accent)', color: 'var(--on-accent)',
                font: 'inherit',
              }}
            >
              {clock && clock.endAt > 0 ? 'Пауза' : clock?.beeped ? 'Ещё раз' : 'Старт'}
            </button>
            <button
              type="button"
              onClick={() => resetGenClock(genId, durationMs)}
              style={{
                flex: 1, border: 'none', cursor: 'default', padding: pad(2, 3),
                borderRadius: RADIUS.control, background: 'var(--card-chip)', color: 'inherit',
                font: 'inherit',
              }}
            >
              Сброс
            </button>
          </div>
        </div>
      )}
      {lexicon.length >= 4 && rec && !timer && !photo && (
        <button
          type="button"
          onClick={() => {
            if (lexicon.length < 2) return;
            let n = Math.floor(Math.random() * lexicon.length);
            if (n === lexIdx) n = (n + 1) % lexicon.length;
            setLexIdx(n);
          }}
          style={{
            display: 'flex', flexDirection: 'column', height: '100%', width: '100%',
            padding: pad(4), gap: sp(2), border: 'none', background: 'transparent',
            color: 'inherit', textAlign: 'left', cursor: 'default', font: 'inherit',
          }}
        >
          <TileCaption>{rec.title || 'Слово'}</TileCaption>
          <div style={{ flex: 1, display: 'flex', flexDirection: 'column', justifyContent: 'center', minHeight: 0 }}>
            <TileValue size={wordFs} hero={hero} style={{
              whiteSpace: long ? 'normal' : 'nowrap',
              lineHeight: long ? 1.15 : 1,
              overflowWrap: 'break-word',
            }}>
              {heroText}
            </TileValue>
            {!!subText && (
              <div style={{ fontSize: 'var(--fs-sm)', color: 'var(--text-faint)', marginTop: sp(2) }}>
                {subText}
              </div>
            )}
          </div>
        </button>
      )}
      {photo && photoData && (
        <img
          src={photoData}
          alt=""
          onClick={pick}
          style={{
            position: 'absolute', inset: 0, width: '100%', height: '100%',
            objectFit: 'cover', display: 'block',
          }}
        />
      )}
      {photo && !photoData && (
        <button type="button" onClick={pick} style={{
          position: 'absolute', inset: 0, border: 'none', cursor: 'default',
          background: 'transparent', color: 'inherit',
          display: 'flex', flexDirection: 'column', padding: 16, gap: 8, textAlign: 'left',
        }}>
          <TileCaption>Фото</TileCaption>
          <div style={{
            ...DISPLAY, fontSize: Math.round(Math.min(box.width * 0.14, 28)),
            fontWeight: 600, color: 'var(--text-strong)',
          }}>
            Выберите фото
          </div>
        </button>
      )}
      {!photo && !timer && lexicon.length < 4 && srcDoc && (
        <iframe
          ref={frameRef}
          title="Свой виджет"
          sandbox="allow-scripts"
          srcDoc={srcDoc}
          style={{ width: '100%', height: '100%', border: 'none', display: 'block', background: 'transparent' }}
        />
      )}
      {!photo && !timer && lexicon.length < 4 && !srcDoc && (
        <div style={{ padding: pad(4), fontSize: 'var(--fs-sm)', color: 'var(--text-faint)' }}>
          Виджет ещё не собран
        </div>
      )}
      {/* ⚠️ Пустая плитка обязана объяснить себя. Молчаливый пустой квадрат человек читает как
          поломку всей функции — и правильно делает: отличить его от «ещё грузится» нельзя. */}
      {blank && lexicon.length < 4 && !photo && !timer && (
        <div style={{
          position: 'absolute', inset: 0, display: 'flex', flexDirection: 'column',
          justifyContent: 'center', gap: sp(1), padding: pad(4),
          background: 'var(--card)', borderRadius: 'inherit',
        }}>
          <TileCaption>{rec?.title || 'Свой виджет'}</TileCaption>
          <div style={{ fontSize: 'var(--fs-sm)', color: 'var(--text-strong)' }}>Не отрисовался</div>
          <div style={{ fontSize: 'var(--fs-xs)', color: 'var(--text-faint)' }}>
            Модель написала код с ошибкой. Пересоберите виджет.
          </div>
        </div>
      )}
      <input
        ref={fileRef}
        type="file"
        accept="image/*"
        hidden
        onChange={(e) => { void onPick(e.target.files?.[0]); e.target.value = ''; }}
      />
    </Tile>
  );
}

function readTokens(): Record<string, string> {
  const cs = getComputedStyle(document.documentElement);
  const out: Record<string, string> = {};
  for (const k of GEN_TOKEN_VARS) {
    if (k === '--gen-num') continue;
    const v = cs.getPropertyValue(k).trim();
    if (v) out[k] = v;
  }
  return out;
}

function readFileDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result || ''));
    r.onerror = () => reject(new Error('read'));
    r.readAsDataURL(file);
  });
}

async function collectFacts(wanted: GenFactId[]): Promise<Record<string, number | string>> {
  const need = new Set(wanted);
  const out: Record<string, number | string> = {};
  try {
    if (need.has('openTabs')) {
      const tabs = await window.oblako.getAllTabs();
      out.openTabs = tabs.filter((t) => t.kind === 'page').length;
    }
  } catch { /* плитка показывает пустое */ }
  try {
    if (need.has('sessionBlocks')) {
      const s = await window.oblako.getAdBlockState();
      out.sessionBlocks = s.sessionBlockCount;
    }
  } catch { /* */ }
  if (need.has('taskCount')) {
    try {
      const raw = localStorage.getItem('oblako-desktop-tasks');
      const parsed: unknown = raw ? JSON.parse(raw) : [];
      out.taskCount = Array.isArray(parsed)
        ? parsed.filter((t) => t && typeof t === 'object' && (t as { done?: boolean }).done !== true).length
        : 0;
    } catch { out.taskCount = 0; }
  }
  return out;
}

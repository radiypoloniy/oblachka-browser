// Карточка снимка вкладки — всплывает в правом нижнем углу контента сразу после Ctrl+Shift+S
// (см. electron/ScreenshotManager.ts). Живёт в своей WebContentsView поверх страницы.
//
// ⚠️ ОФОРМЛЕНИЕ КАДРА рисуется здесь, на canvas, и здесь же остаётся до сохранения. Тот вид, за
// который любят снимки macOS, — это скруглённые углы и мягкая тень на ПРОЗРАЧНОМ фоне; nativeImage
// в main так не умеет, а canvas умеет и делает это детерминированно: что человек видит в карточке,
// то и ляжет в файл, без второго рендера по дороге.
//
// ⚠️ Поля и радиус считаются от размера самого кадра, а не в фиксированных пикселях: снимок с
// монитора 150% приходит в полтора раза крупнее, и постоянные 40 px тени выглядели бы на нём
// вдвое жиже, чем на обычном.
import React, { useCallback, useEffect, useRef, useState } from 'react';
import ReactDOM from 'react-dom/client';
import { Copy, FolderOpen, X } from 'lucide-react';
import { islandPlate } from './styles/island';
import './styles/global.css';
import { installOverlayReveal } from './overlayReveal';

declare global {
  interface Window {
    screenshotOverlay: {
      onShot: (cb: (dataUrl: string) => void) => () => void;
      onSaveRequest: (cb: () => void) => () => void;
      save: (dataUrl: string) => Promise<string | null>;
      copy: (dataUrl: string) => void;
      reveal: (file: string) => void;
      close: () => void;
      reportHeight: (px: number) => void;
    };
  }
}

// Держать в синхроне с CARD_WIDTH/SHADOW_MARGIN в electron/ScreenshotManager.ts.
const CARD_WIDTH = 320;
const SHADOW_MARGIN = 24;
const PREVIEW_MAX_H = 190;
// Сколько карточка висит, если её не трогать. Как на macOS — несколько секунд: это подсказка
// «снимок сделан», а не окно, которое надо закрывать. Не сохранённый снимок при этом пропадает —
// потому что мы, в отличие от macOS, не пишем файл сам собой (иначе папка загрузок обрастала бы
// кадрами, которые никто не просил).
const AUTO_HIDE_MS = 10_000;
const AFTER_SAVE_MS = 2600;

function clamp(v: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, v));
}

/** Кадр → кадр со скруглёнными углами и мягкой тенью на прозрачном фоне (вид снимков macOS). */
function decorate(raw: string): Promise<string> {
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => {
      const w = img.naturalWidth;
      const h = img.naturalHeight;
      const ctx = document.createElement('canvas').getContext('2d');
      if (!ctx || !w || !h) { resolve(raw); return; }
      const min = Math.min(w, h);
      const pad = clamp(Math.round(min * 0.055), 28, 110);   // поле под тень
      const radius = clamp(Math.round(min * 0.018), 10, 28); // скругление кадра
      ctx.canvas.width = w + pad * 2;
      ctx.canvas.height = h + pad * 2;

      // Тень отбрасывает залитый прямоугольник, а не сама картинка: у canvas тень строится по
      // альфе того, что рисуют, и у непрозрачного снимка получилась бы та же тень, только медленнее.
      ctx.save();
      ctx.shadowColor = 'rgba(0, 0, 0, 0.38)';
      ctx.shadowBlur = pad * 1.1;
      ctx.shadowOffsetY = Math.round(pad * 0.35);
      ctx.beginPath();
      ctx.roundRect(pad, pad, w, h, radius);
      ctx.fillStyle = '#000';
      ctx.fill();
      ctx.restore();

      ctx.save();
      ctx.beginPath();
      ctx.roundRect(pad, pad, w, h, radius);
      ctx.clip();
      ctx.drawImage(img, pad, pad, w, h);
      ctx.restore();

      resolve(ctx.canvas.toDataURL('image/png'));
    };
    // Оформить не вышло — показываем и сохраняем как есть: снимок важнее вида.
    img.onerror = () => resolve(raw);
    img.src = raw;
  });
}

function ScreenshotCard() {
  const [shot, setShot] = useState<string | null>(null);
  const [saved, setSaved] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);
  const [copied, setCopied] = useState(false);

  // Всё, что нужно обработчикам из main (Ctrl+S) и таймеру автоскрытия, держим в ref: подписка
  // навешивается один раз на всю жизнь вью, а показов у неё сотни.
  const shotRef = useRef<string | null>(null);
  const savedRef = useRef<string | null>(null);
  const busyRef = useRef(false);
  const hoverRef = useRef(false);
  const hideTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const cardRef = useRef<HTMLDivElement>(null);

  const scheduleHide = useCallback(function schedule(ms: number): void {
    if (hideTimer.current) clearTimeout(hideTimer.current);
    hideTimer.current = setTimeout(() => {
      // Курсор на карточке — человек ещё решает, что с ней делать. Не отнимаем.
      if (hoverRef.current) { schedule(1500); return; }
      window.screenshotOverlay.close();
    }, ms);
  }, []);

  const doSave = useCallback(async () => {
    const cur = shotRef.current;
    if (!cur || savedRef.current || busyRef.current) return;
    busyRef.current = true;
    const file = await window.screenshotOverlay.save(cur);
    busyRef.current = false;
    if (file) {
      savedRef.current = file;
      setSaved(file);
      scheduleHide(AFTER_SAVE_MS);
    } else {
      setFailed(true);
      scheduleHide(AUTO_HIDE_MS);
    }
  }, [scheduleHide]);

  useEffect(() => {
    const unsubShot = window.screenshotOverlay.onShot((raw) => {
      savedRef.current = null;
      busyRef.current = false;
      setSaved(null);
      setFailed(false);
      setCopied(false);
      void decorate(raw).then((url) => {
        shotRef.current = url;
        setShot(url);
        scheduleHide(AUTO_HIDE_MS);
      });
    });
    // Ctrl+S ловит не эта вью, а страница (см. ScreenshotManager: фокус мы у неё не отнимаем).
    const unsubSave = window.screenshotOverlay.onSaveRequest(() => { void doSave(); });
    return () => { unsubShot(); unsubSave(); };
  }, [doSave, scheduleHide]);

  // Высота карточки зависит от пропорций снимка — main двигает вью по ней (правый нижний угол).
  useEffect(() => {
    const el = cardRef.current;
    if (!el) return;
    const report = () => window.screenshotOverlay.reportHeight(el.offsetHeight);
    report();
    const ro = new ResizeObserver(report);
    ro.observe(el);
    return () => ro.disconnect();
  }, [shot]);

  if (!shot) return null;

  const onCopy = () => {
    window.screenshotOverlay.copy(shot);
    setCopied(true);
    scheduleHide(AFTER_SAVE_MS);
  };

  // ⚠️ В спокойном состоянии подписи НЕТ вовсе. «Снимок вкладки» не сообщал ничего (снимок и так
  // виден в карточке), зато отнимал у подвала место — и обрезался многоточием сам, рядом с
  // кнопкой, ради которой карточка и всплыла. Строка появляется, только когда есть что сказать.
  const status = failed ? 'Не удалось сохранить'
    : saved ? 'Сохранено в «Загрузки»'
    : copied ? 'Скопировано'
    : '';

  return (
    <div
      style={{ padding: SHADOW_MARGIN, boxSizing: 'border-box' }}
      onMouseEnter={() => { hoverRef.current = true; }}
      onMouseLeave={() => { hoverRef.current = false; }}
    >
      <div ref={cardRef} style={{
        width: CARD_WIDTH, ...islandPlate,
        borderRadius: 'var(--radius-card)', overflow: 'hidden',
        display: 'flex', flexDirection: 'column',
      }}>
        <div style={{ padding: 10, paddingBottom: 0 }}>
          <img src={shot} alt="" style={{
            display: 'block', width: '100%', maxHeight: PREVIEW_MAX_H,
            objectFit: 'contain', objectPosition: 'center',
          }} />
        </div>

        <div style={{
          display: 'flex', alignItems: 'center', gap: 8, padding: '10px 12px',
        }}>
          <span style={{
            flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
            fontSize: 'var(--fs-xs)', color: failed ? 'var(--text)' : 'var(--text-muted)',
          }}>{status}</span>

          {saved ? (
            <button onClick={() => window.screenshotOverlay.reveal(saved)} title="Показать в папке" style={iconBtn}>
              <FolderOpen size={15} />
            </button>
          ) : (
            <>
              <button onClick={onCopy} title="Копировать" style={iconBtn}>
                <Copy size={15} />
              </button>
              <button onClick={() => { void doSave(); }} style={saveBtn}>
                Сохранить
                {/* Подпись хоткея прямо на кнопке: жест новый, и без неё про Ctrl+S никто не узнает. */}
                <span style={{ opacity: 0.75, fontSize: 'var(--fs-xs)' }}>Ctrl+S</span>
              </button>
            </>
          )}
          <button onClick={() => window.screenshotOverlay.close()} title="Закрыть (Esc)" style={iconBtn}>
            <X size={15} />
          </button>
        </div>
      </div>
    </div>
  );
}

const iconBtn: React.CSSProperties = {
  border: 'none', background: 'transparent', color: 'var(--text-muted)',
  padding: 6, borderRadius: 'var(--radius-sm)', cursor: 'default',
  display: 'inline-flex', alignItems: 'center', flex: 'none',
};

const saveBtn: React.CSSProperties = {
  border: 'none', background: 'var(--accent)', color: 'var(--on-accent)',
  padding: '6px 10px', borderRadius: 'var(--radius-sm)', cursor: 'default',
  display: 'inline-flex', alignItems: 'center', gap: 6, flex: 'none',
  fontSize: 'var(--fs-sm)', fontWeight: 500, fontFamily: 'inherit',
};

installOverlayReveal();
ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <ScreenshotCard />
  </React.StrictMode>,
);

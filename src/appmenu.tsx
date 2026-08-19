import { useEffect, useRef, useState } from 'react';
import ReactDOM from 'react-dom/client';
import { ChevronRight, Check } from 'lucide-react';
import type { AppMenuItem } from '../shared/ipc';
import { RADIUS, TEXT, sp, motion } from './styles/system';
import { glassPlate } from './styles/island';
import { OVERLAY_SHADOW_MARGIN as SHADOW_MARGIN } from '../shared/overlayMetrics';
import './styles/global.css';
import { installOverlayReveal } from './overlayReveal';

declare global {
  interface Window {
    appMenu: {
      onShow: (cb: (items: AppMenuItem[]) => void) => () => void;
      pick: (id: string) => void;
      close: () => void;
      reportSize: (size: { width: number; height: number }) => void;
    };
  }
}

// Меню приложения — то, что раньше рисовала Windows. ⚠️ Собрано из тех же кирпичей, что остальные
// карточки (материал, строка, роли текста): в этом и был смысл замены нативного меню — оно
// единственное оставалось чужим предметом в окне.

function MenuList({ items, onPick }: { items: AppMenuItem[]; onPick: (id: string) => void }) {
  // Открытое подменю: только одно за раз, как в системных меню.
  const [openId, setOpenId] = useState<string | null>(null);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
      {items.map((item, i) => {
        if (item.type === 'separator') {
          return (
            <div key={`sep${i}`} style={{
              height: 1, background: 'var(--divider)', margin: `${sp(1)}px ${sp(1)}px`,
            }} />
          );
        }
        const disabled = item.enabled === false;
        const hasSub = !!item.submenu?.length;
        return (
          <div key={item.id ?? i} style={{ position: 'relative' }}>
            <button
              className="popover-row"
              disabled={disabled}
              onMouseEnter={() => setOpenId(hasSub ? item.id ?? null : null)}
              onClick={() => { if (!hasSub && item.id) onPick(item.id); }}
              style={{
                display: 'flex', alignItems: 'center', gap: sp(2), width: '100%',
                padding: `6px ${sp(2)}px`, borderRadius: RADIUS.control, border: 'none',
                background: 'transparent', color: 'var(--text-body)', textAlign: 'left',
                fontSize: 'var(--fs-sm)', cursor: 'default',
                opacity: disabled ? 0.45 : 1, transition: motion.hover('background'),
              }}
            >
              {/* Место под отметку держим всегда: иначе строки с галочкой и без неё не встают в
                  одну вертикаль, и меню «рассыпается» глазом. */}
              <span style={{ width: 14, flex: 'none', display: 'grid', placeItems: 'center' }}>
                {item.checked && <Check size={13} style={{ color: 'var(--accent)' }} />}
              </span>
              <span style={{ flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {item.label}
              </span>
              {hasSub && <ChevronRight size={14} style={{ flex: 'none', color: 'var(--text-faint)' }} />}
            </button>

            {hasSub && openId === item.id && (
              <div style={{
                position: 'absolute', left: '100%', top: 0, marginLeft: 2, zIndex: 2,
                ...glassPlate(), borderRadius: RADIUS.box, padding: sp(1), minWidth: 200,
              }}>
                <MenuList items={item.submenu ?? []} onPick={onPick} />
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

function AppMenu() {
  const [items, setItems] = useState<AppMenuItem[] | null>(null);
  const cardRef = useRef<HTMLDivElement>(null);

  useEffect(() => window.appMenu.onShow(setItems), []);

  // Размер сообщаем в main: он не знает, сколько места займут подписи, и вью нужно подогнать.
  useEffect(() => {
    const el = cardRef.current;
    if (!el) return;
    const report = () => window.appMenu.reportSize({ width: el.offsetWidth, height: el.offsetHeight });
    report();
    const ro = new ResizeObserver(report);
    ro.observe(el);
    return () => ro.disconnect();
  }, [items]);

  // ⚠️ Здесь только Esc. Клик МИМО меню ловит main по потере фокуса окном: клик по странице или
  // по другому приложению до этого рендерера не доходит вовсе — на этом и сломалась первая версия
  // меню, жившая внутри вью.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') window.appMenu.close(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  if (!items?.length) return null;
  return (
    <div style={{ padding: SHADOW_MARGIN, boxSizing: 'border-box', width: 'fit-content' }}>
      <div ref={cardRef} style={{
        ...glassPlate(), borderRadius: RADIUS.box, padding: sp(1), minWidth: 200, width: 'fit-content',
        ...TEXT.body,
      }}>
        <MenuList items={items} onPick={(id) => window.appMenu.pick(id)} />
      </div>
    </div>
  );
}

installOverlayReveal();
ReactDOM.createRoot(document.getElementById('root')!).render(<AppMenu />);

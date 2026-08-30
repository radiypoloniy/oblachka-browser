import type React from 'react';
import type { DesktopItem } from '../../newtab/desktop';
import type { NewTabSettings } from '../../newtab/settings';
import type { TileSite } from '../../../shared/frecency';
import { WIDGET_RENDERERS } from './widgets';
import { GEN_GHOST_ID, GenDraftTile, type GenGhost } from './GenStudio';
import { GenWidget } from './GenWidget';
import { AppIconBadge } from '../aiApps';
import SiteIcon from './SiteIcon';
import type { useDesktopGrid } from './useDesktopGrid';

// Что делает клик по плитке. Пусто — виджет не открывается никуда (у большинства открывать и
// нечего: часы, луна, погода сами по себе полный ответ).
const WIDGET_ACTIVATE: Record<string, (() => void) | undefined> = {
  tracking: () => { void window.oblako.createSpecialTab('history', 'tracking'); },
};

/**
 * Содержимое плитки: виджет, болванка сборки, приложение или сайт.
 *
 * ⚠️ Отделено от самой плитки (рамка, жесты, кнопки правки) намеренно: у них разные причины
 * меняться. Плитка меняется вместе с механикой стола, содержимое — вместе с набором виджетов.
 */
export function TileContent({
  g, item, settings, tiles, editing, ghost, box, onSubmit, onOpenApp,
}: {
  g: ReturnType<typeof useDesktopGrid>;
  item: DesktopItem;
  settings: NewTabSettings;
  tiles: TileSite[];
  editing: boolean;
  ghost: GenGhost | null;
  box: { width: number; height: number };
  onSubmit: (text: string) => void;
  onOpenApp?: (appId: string) => void;
}): React.ReactNode {
  return item.id === GEN_GHOST_ID && ghost ? (
        <GenDraftTile
          ghost={ghost}
          box={box}
          overImage={settings.background.kind === 'photo' || settings.background.kind === 'custom' || settings.background.kind === 'mesh'}
        />
      ) : item.kind === 'widget' ? (() => {
        const Render = item.widget === 'gen' ? GenWidget : WIDGET_RENDERERS[item.widget ?? ''];
        return Render ? (
          // ⚠️ Погода заливку НЕ получает намеренно: там цвет означает время суток и
          // саму погоду (ночью тёмная, в грозу свинцовая), и подмена его на выбранный
          // стёрла бы единственный виджет, где цвет — сообщение, а не оформление.
          <Render size={item.size} box={box} cell={g.grid.cell} tiles={tiles} onOpen={onSubmit}
            city={settings.weather.city}
            // ⚠️ В режиме правки обработчик НЕ передаём вовсе: там плитку таскают, и клик
            // по ней означает «взял», а не «открой».
            onActivate={editing ? undefined : WIDGET_ACTIVATE[item.widget ?? '']}
            fill={item.widget === 'weather' ? undefined : item.fill}
            // Над фотографией плитки идут стеклом, над ровным фоном — сплошной картой.
            overImage={settings.background.kind === 'photo' || settings.background.kind === 'custom' || settings.background.kind === 'mesh'}
            hero={item.hero === true}
            genId={item.genId} />
        ) : null;
      })() : item.kind === 'app' ? (() => {
        const app = g.appById.get(item.appId ?? '');
        if (!app) return null;
        const iconSize = Math.round(g.grid.cell * 0.72);
        return (
          <button
            onClick={() => { if (!editing) onOpenApp?.(app.id); }}
            title={app.label}
            style={{
              display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 6,
              width: '100%', height: '100%', padding: 0, border: 'none',
              background: 'transparent', cursor: 'default',
            }}
          >
            <AppIconBadge app={app} size={iconSize} iconSize={Math.round(iconSize * 0.56)} shadow />
            <span style={{
              maxWidth: '100%', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
              fontSize: 'var(--fs-xs)', fontWeight: 500,
              color: 'var(--nt-text)', textShadow: 'var(--nt-shadow)',
            }}>{app.label}</span>
          </button>
        );
      })() : (
        <SiteIcon
          url={item.url ?? ''}
          title={item.title ?? ''}
          size={Math.round(g.grid.cell * 0.72)}
          onOpen={(url) => { if (!editing) onSubmit(url); }}
          labelColor="var(--nt-text)"
          labelShadow="var(--nt-shadow)"
        />
  );
}

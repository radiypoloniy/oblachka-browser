import { Cloud, VenetianMask } from 'lucide-react';
import type { ReactNode } from 'react';
import type { TabState } from '../../../shared/ipc';
import { TAB_KIND_TILE } from '../../styles/tabKindTile';
import { FaviconImg } from '../SiteFavicon';

/**
 * Плитка с первой буквой домена — то, что рисуется вместо значка.
 *
 * ⚠️ Вынесено из ветки «значка нет», потому что теперь этим же пользуется ОТКАТ по ошибке
 * загрузки: раньше протухшая ссылка приводила к значку «сломанное изображение», а не к букве.
 */
function LetterTile({ url, size }: { url: string; size: number }) {
  let letter = '?';
  try { letter = new URL(url).hostname.replace('www.', '')[0]?.toUpperCase() ?? '?'; }
  catch { /* about:blank и подобное — буквы нет */ }
  return (
    <span style={{
      width: size, height: size, borderRadius: 'var(--radius-sm)',
      background: 'var(--neutral-300)', color: 'var(--text-body)', flex: 'none',
      display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
      fontSize: 'var(--fs-xs)', fontWeight: 600,
    }}>{letter}</span>
  );
}

export function FaviconTile({ tab, size = 16 }: { tab: TabState; size?: number }) {
  if (tab.isHub) {
    return (
      <span style={{
        width: size + 6, height: size + 6, borderRadius: 'var(--radius-sm)',
        background: 'var(--accent)', display: 'inline-flex', flex: 'none',
        alignItems: 'center', justifyContent: 'center',
      }}>
        <Cloud size={size} color="#fff" />
      </span>
    );
  }

  // Псевдо-вкладки (История/Закладки/Настройки) — раньше проваливались в ветку «нет favicon →
  // буква домена» ниже и падали в new URL('') на пустом url (см. TabState.kind в shared/ipc.ts),
  // отсюда «?». Единый маппинг kind → {Icon, color} — src/styles/tabKindTile.ts, не хардкод тут.
  const kindTile = TAB_KIND_TILE[tab.kind];
  if (kindTile) {
    const tileSize = size + 6;
    const { Icon, color } = kindTile;
    return (
      <span style={{
        width: tileSize, height: tileSize, borderRadius: 'var(--radius-sm)',
        background: color, display: 'inline-flex', flex: 'none',
        alignItems: 'center', justifyContent: 'center',
      }}>
        <Icon size={Math.round(tileSize * 0.65)} color="#fff" />
      </span>
    );
  }

  const tileSize = size + 6;
  // Инкогнито-вкладка — плитка-маска вместо favicon: мгновенно читается как приватная.
  if (tab.incognito) {
    return (
      <span style={{
        width: tileSize, height: tileSize, borderRadius: 'var(--radius-sm)', flex: 'none',
        background: 'var(--neutral-700, #3a3a42)', color: '#fff',
        display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
      }} title="Приватная вкладка">
        <VenetianMask size={Math.round(tileSize * 0.6)} />
      </span>
    );
  }
  let inner: ReactNode;
  if (tab.faviconUrl) {
    // ⚠️ Под значком ПОДЛОЖКА, и в тёмной теме она несущая. Логотипы сплошь и рядом рисуют тёмными
    // штрихами на прозрачном фоне (GitHub, Arc, десятки других), и на тёмном сайдбаре такой значок
    // пропадает целиком. Для закреплённых это фатально: там кроме значка ничего нет, и вкладка
    // становится пустым местом.
    // ⚠️ Подложка ОДНА НА ВСЕ значки, а не «только под тёмными»: определять светлоту favicon
    // пришлось бы разбором пикселей на каждый значок и каждую загрузку. У непрозрачных логотипов
    // она всё равно не видна — картинка её закрывает, — поэтому цена ошибки нулевая. Так же
    // поступают Chrome и Arc.
    inner = (
      <span style={{
        width: tileSize, height: tileSize, borderRadius: 'var(--radius-sm)', flex: 'none',
        background: 'var(--favicon-plate)', display: 'inline-flex',
      }}>
        {/* ⚠️ С ОТКАТОМ: протухшая ссылка рисовала значок «сломанное изображение» — см. SiteFavicon. */}
        <FaviconImg
          src={tab.faviconUrl}
          size={tileSize}
          radius="var(--radius-sm)"
          fallback={<LetterTile url={tab.url} size={tileSize} />}
        />
      </span>
    );
  } else {
    inner = <LetterTile url={tab.url} size={tileSize} />;
  }

  return <>{inner}</>;
}

import type React from 'react';
import { BackGlyph, ForwardGlyph, RefreshGlyph } from '../glyphs';
import { chromeCluster, clusterBtn } from '../../styles/island';

/**
 * Назад · Вперёд · Обновить — парящая плашка-остров слева в тулбаре.
 *
 * ⚠️ Кнопки ГАСНУТ, а не прячутся: набор в плашке постоянный, иначе она меняла бы ширину, а
 * вместе с ней ездил бы омнибокс — прямо под курсором. Та же причина, по которой постоянен и
 * правый кластер.
 *
 * ⚠️ «Обновить» неактивна на хабе: перезагружать там нечего, а молча ничего не делающая кнопка
 * читается как поломка.
 */
export function NavCluster({ canGoBack, canGoForward, isHub, onBack, onForward, onReload }: {
  canGoBack: boolean;
  canGoForward: boolean;
  isHub: boolean;
  onBack: () => void;
  onForward: () => void;
  onReload: () => void;
}): React.ReactElement {
  return (
    <div className="no-drag" style={chromeCluster()}>
      <button className="chrome-btn" title="Назад" disabled={!canGoBack} onClick={onBack}
        style={clusterBtn({ disabled: !canGoBack })}><BackGlyph size={18} /></button>
      <button className="chrome-btn" title="Вперёд" disabled={!canGoForward} onClick={onForward}
        style={clusterBtn({ disabled: !canGoForward })}><ForwardGlyph size={18} /></button>
      {/* ⚠️ 18, а не 17: соседние стрелки восемнадцатые, и на глаз «Обновить» выглядела мельче
          остальных. Высоту группы это не двигает — та задана явно (ISLAND_HEIGHT). */}
      <button className="chrome-btn" title="Обновить" disabled={isHub} onClick={onReload}
        style={clusterBtn({ disabled: isHub })}><RefreshGlyph size={18} /></button>
    </div>
  );
}

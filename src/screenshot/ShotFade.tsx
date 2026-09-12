// Смена кадра. Новый слой проявляется поверх, старый снимаем, когда новый уже на экране.
//
// ⚠️ Потолок — контейнер сцены (100cqw/100cqh), не пиксельный замер при монтировании:
// вью ещё карточка/нулевой высоты давала maxH=1, и полный кадр становился точкой.
// Апскейла нет: max сдерживает крупное, мелкий вырез остаётся в натуральную величину.

import { useEffect, useRef, useState, type ReactNode, type Ref, type SyntheticEvent } from 'react';
import { RADIUS, motion } from '../styles/system';

type Layer = { key: number; src: string };

const fit = {
  display: 'block' as const,
  objectFit: 'contain' as const,
  borderRadius: RADIUS.box,
  boxShadow: 'var(--shadow-lvl2)',
  pointerEvents: 'none' as const,
  maxWidth: '100cqw',
  maxHeight: '100cqh',
};

export function ShotFade(props: {
  src: string;
  capturing: boolean;
  imgRef: Ref<HTMLImageElement>;
  overlay?: ReactNode;
  onLoad: (e: SyntheticEvent<HTMLImageElement>) => void;
}): ReactNode {
  const seq = useRef(0);
  const [layers, setLayers] = useState<Layer[]>(() => [{ key: 0, src: props.src }]);
  const [opaque, setOpaque] = useState(0);

  useEffect(() => {
    setLayers((ls) => {
      const last = ls[ls.length - 1];
      if (last?.src === props.src) return ls;
      seq.current += 1;
      return [...ls.slice(-1), { key: seq.current, src: props.src }];
    });
  }, [props.src]);

  const settle = (key: number) => {
    setLayers((ls) => {
      const last = ls[ls.length - 1];
      return last?.key === key ? [last] : ls;
    });
  };

  return (
    <div style={{
      position: 'relative', width: '100%', height: '100%',
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      containerType: 'size',
    }}>
      <div style={{ position: 'relative', display: 'inline-block' }}>
        <div style={{ display: 'grid', justifyItems: 'center', alignItems: 'center' }}>
          {layers.map((layer, i) => {
            const top = i === layers.length - 1;
            const only = layers.length === 1;
            const shown = only || layer.key === opaque;
            return (
              <img
                key={layer.key}
                ref={top ? props.imgRef : undefined}
                src={layer.src}
                alt=""
                draggable={false}
                onLoad={(e) => {
                  if (!top) return;
                  props.onLoad(e);
                  if (only) return;
                  const key = layer.key;
                  requestAnimationFrame(() => requestAnimationFrame(() => setOpaque(key)));
                  window.setTimeout(() => settle(key), 400);
                }}
                onError={() => {
                  if (!top || only) return;
                  setLayers((ls) => ls.filter((l) => l.key !== layer.key));
                }}
                onTransitionEnd={(e) => {
                  if (!top || e.propertyName !== 'opacity' || layer.key !== opaque) return;
                  settle(layer.key);
                }}
                style={{
                  ...fit,
                  gridArea: '1 / 1',
                  opacity: shown ? (props.capturing && only ? 0.72 : 1) : 0,
                  transition: only ? undefined : motion.enter('opacity'),
                }}
              />
            );
          })}
        </div>
        {props.overlay && (
          <div style={{ position: 'absolute', inset: 0, pointerEvents: 'none', containerType: 'size' }}>
            {props.overlay}
          </div>
        )}
      </div>
    </div>
  );
}

import type { CSSProperties } from 'react';
import type { Profile } from '../../shared/profiles';
import { DISPLAY, RADIUS, TEXT, motion } from '../styles/system';

// Лицо профиля: буква имени, эмодзи или своё фото.
//
// ⚠️ ОДНО место отрисовки на всё приложение. Профиль показывается минимум в четырёх местах
// (экран выбора при старте, список в настройках, строка «запускаться с этим профилем», выбор
// в блоке облика), и первая версия рисовала кружок в каждом из них своим куском разметки. Пока
// это была буква на цвете, разъезд был незаметен; с тремя видами аватарки он стал бы гарантией
// того, что где-то фото так и осталось буквой.
//
// ⚠️ Эмодзи и фото сидят на НЕЙТРАЛЬНОЙ плашке с цветным кольцом, а не на цветной заливке.
// Правило проекта («цвет на группе, значки на нейтральной плашке») здесь особенно заметно:
// эмодзи сами по себе цветные, и на насыщенном кружке они превращаются в кашу, а фото на нём
// теряет края. Цвет профиля при этом никуда не девается — он остаётся кольцом, то есть человек
// по-прежнему узнаёт профиль по цвету, даже не разглядывая картинку.

/**
 * Набор эмодзи для выбора.
 *
 * ⚠️ Это НЕ случайный зоопарк и не «популярное»: набор собран по РОЛЯМ, для которых люди заводят
 * профили, — работа, учёба, дом, покупки, игры, поездки. Человек должен узнать свой профиль
 * с первого взгляда на список, а не разглядывать значок.
 */
export const AVATAR_EMOJI = [
  '💼', '🏢', '🎓', '📚', '🏠', '🛒', '💳', '🎮',
  '🎧', '🎬', '📷', '✈️', '🌿', '☕', '🐈', '🐶',
  '⚡', '🌙', '🚀', '🧩', '🔒', '❤️', '⭐', '🎯',
];

// С какого размера кружок перестаёт быть значком строки и становится «лицом» продукта.
// Дисплейная гарнитура заходит только сюда — в интерфейсе мелким кеглем она нечитаема.
const DISPLAY_MIN = 28;

export default function ProfileAvatar({ profile, size = 18, style }: {
  profile: Profile;
  size?: number;
  style?: CSSProperties;
}) {
  const base: CSSProperties = {
    width: size, height: size, flex: 'none', borderRadius: RADIUS.pill,
    display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
    overflow: 'hidden', lineHeight: 1,
    // Смена облика — это состояние, а не наведение: цвет и кольцо переезжают одним движением.
    transition: motion.state('background', 'box-shadow', 'color'),
  };
  const av = profile.avatar;

  if (av.kind === 'photo') {
    return (
      <span style={{
        ...base,
        background: 'var(--surface-sunken)',
        // ⚠️ Кольцо ВНУТРЕННЕЙ тенью, а не border: border съел бы пиксели у самой картинки и
        // на 18px это заметно — фото превращается в точку в рамке.
        boxShadow: `inset 0 0 0 1.5px var(--tile-${profile.color})`,
        ...style,
      }}>
        <img
          src={av.dataUrl}
          alt=""
          draggable={false}
          style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }}
        />
      </span>
    );
  }

  if (av.kind === 'emoji') {
    return (
      <span style={{
        ...base,
        background: 'var(--surface-sunken)',
        boxShadow: `inset 0 0 0 1.5px var(--tile-${profile.color})`,
        // Кегль считается от кружка, а не берётся из шкалы текста: это глиф, а не подпись,
        // и в шкале интерфейса ему места нет.
        fontSize: Math.round(size * 0.54),
        ...style,
      }}>{av.emoji}</span>
    );
  }

  return (
    <span style={{
      ...base,
      // ⚠️ Спред роли идёт ПЕРВЫМ: он несёт свой цвет и затёр бы белый, стой он после.
      ...(size >= DISPLAY_MIN ? { ...DISPLAY, fontSize: Math.round(size * 0.45) } : TEXT.caption),
      fontWeight: 700,
      // ⚠️ Токен, а не литерал: белый на цветной метке — тот же случай, что текст на акценте.
      background: `var(--tile-${profile.color})`, color: 'var(--white)',
      ...style,
    }}>{(profile.name.trim()[0] ?? '?').toUpperCase()}</span>
  );
}

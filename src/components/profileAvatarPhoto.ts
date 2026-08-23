import { PROFILE_PHOTO_MAX } from '../../shared/profiles';

// Своё фото на аватарку профиля: прочитать файл, обрезать в квадрат, ужать до потолка.
//
// ⚠️ Почему НЕ переиспользован shrinkWidgetPhoto из newtab/genStore. Тот готовит фото ДЛЯ
// ВИДЖЕТА: длинная сторона 720+, пропорции сохраняются, результат кладётся в localStorage.
// Аватарке нужно ровно обратное — квадрат (кружок 18–48px обрежет всё лишнее сам, но криво:
// object-fit покажет центр, а вес файла останется от полной картинки) и вес в единицы килобайт,
// потому что аватарка едет в profiles.json и грузится при КАЖДОМ старте вместе со списком
// профилей. Общего кода тут — три строки createImageBitmap, а расхождение целей полное.
//
// ⚠️ Потолок проверяется ЗДЕСЬ, хотя его же проверяет разбор в shared/profiles.ts. Не
// дублирование: там последняя линия обороны, которая роняет аватарку в букву МОЛЧА, — и
// человек, выбравший фото, увидел бы вместо него букву без единого объяснения. Здесь же
// известно, что делать: ужать сильнее и сказать, если не влезло.

// Сторона квадрата. 192 — это 4× от самого крупного места показа (48px на экране выбора),
// то есть запас на экраны с высокой плотностью и на будущее увеличение кружка.
const SIDE = 192;
const QUALITY = [0.85, 0.7, 0.55];

/** Файл из <input type="file"> в data-URL. */
export function readFileDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const fr = new FileReader();
    fr.onload = () => resolve(String(fr.result ?? ''));
    fr.onerror = () => reject(new Error('файл не прочитан'));
    fr.readAsDataURL(file);
  });
}

/**
 * Квадратная аватарка из любой картинки. null — не вышло (не картинка или не влезла).
 *
 * ⚠️ Обрезка ЦЕНТРАЛЬНАЯ, а не «вписать целиком». Вписанная в квадрат фотография человека даёт
 * поля по бокам, и в кружке от неё остаётся полоска — узнать на ней нельзя ничего.
 */
export async function shrinkAvatarPhoto(dataUrl: string): Promise<string | null> {
  if (!dataUrl.startsWith('data:image/')) return null;
  let bmp: ImageBitmap;
  try {
    bmp = await createImageBitmap(await (await fetch(dataUrl)).blob());
  } catch {
    return null;
  }
  try {
    const side = Math.min(bmp.width, bmp.height);
    const sx = Math.round((bmp.width - side) / 2);
    const sy = Math.round((bmp.height - side) / 2);
    const canvas = document.createElement('canvas');
    canvas.width = SIDE;
    canvas.height = SIDE;
    const ctx = canvas.getContext('2d');
    if (!ctx) return null;
    ctx.drawImage(bmp, sx, sy, side, side, 0, 0, SIDE, SIDE);
    // ⚠️ webp, а не png: png от фотографии — сотни килобайт, то есть гарантированный отказ на
    // потолке. Разбор в shared/profiles.ts webp принимает (см. cleanAvatar).
    for (const q of QUALITY) {
      const out = canvas.toDataURL('image/webp', q);
      if (out.startsWith('data:image/webp') && out.length <= PROFILE_PHOTO_MAX) return out;
    }
    // Кодировщика webp не нашлось — пробуем jpeg тем же кругом качества.
    for (const q of QUALITY) {
      const out = canvas.toDataURL('image/jpeg', q);
      if (out.length <= PROFILE_PHOTO_MAX) return out;
    }
    return null;
  } finally {
    bmp.close();
  }
}

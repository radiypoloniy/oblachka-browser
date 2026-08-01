// ── Видео следует за вами: кадр уезжает в окошко поверх окон ──────────────────
//
// Замерено на живом YouTube в нашей сборке: Electron 40 поддерживает штатный
// Picture-in-Picture целиком — `document.pictureInPictureEnabled` истинно, запрос проходит,
// и главное — окошко ПЕРЕЖИВАЕТ переключение вкладки: видео продолжает играть (currentTime
// растёт), хотя сама страница уже в фоне и `document.hidden` истинно. Своё плавающее окно
// городить не понадобилось.
//
// ⚠️ Запрос требует жеста пользователя. Переключение вкладки жестом и является, но браузер
// об этом не знает — поэтому скрипт исполняется через `executeJavaScript(code, true)`, где
// второй аргумент и означает «считать это действием человека». Без него запрос отклоняется.

// Уводим в окошко ТОЛЬКО то, что человек реально смотрит: играющее, не закончившееся, с
// картинкой заметного размера. Иначе окно выскакивало бы от любого фонового ролика-заглушки
// или превью в ленте.
//
// `disablePictureInPicture` уважаем: сайт вправе запретить, и переламывать его не будем.
export const PIP_ENTER_SCRIPT = `(async () => {
  if (document.pictureInPictureElement) return 'уже';
  var best = null;
  var vids = document.querySelectorAll('video');
  for (var i = 0; i < vids.length; i++) {
    var v = vids[i];
    if (v.paused || v.ended || v.disablePictureInPicture) continue;
    if (v.readyState < 2 || v.videoWidth < 200) continue;
    if (!best || v.videoWidth * v.videoHeight > best.videoWidth * best.videoHeight) best = v;
  }
  if (!best) return 'нечего';
  try { await best.requestPictureInPicture(); return 'ок'; } catch (e) { return 'отказ'; }
})()`;

// Вернулись на вкладку — кадр возвращается в страницу. Иначе человек видел бы ролик дважды:
// и в окошке, и на самой странице.
export const PIP_EXIT_SCRIPT = `(async () => {
  if (!document.pictureInPictureElement) return 'нет';
  try { await document.exitPictureInPicture(); return 'ок'; } catch (e) { return 'отказ'; }
})()`;

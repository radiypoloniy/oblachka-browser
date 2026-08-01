// ── Расшифровка видео: слой ПЕРЕД обычным извлечением ────────────────────────
//
// Зачем. На странице ролика Readability берёт описание, комментарии и обвязку плеера —
// то есть всё, кроме содержания. Само содержание лежит в субтитрах.
//
// ⚠️ Скачать дорожку субтитров НЕЛЬЗЯ, и это проверено: у ссылки на timedtext, которую
// отдаёт плеер, стоит параметр `exp=xpe`, и эндпоинт возвращает ПУСТОЕ тело с кодом 200
// даже на запрос с куками залогиненного браузера (PoToken — часть антибота YouTube с
// 2025 года). Поэтому «взять baseUrl и скачать» здесь не работает в принципе.
//
// Что работает: страница уже сходила за субтитрами САМА, со своим токеном, и отрисовала
// их в собственной панели «Показать расшифровку». Мы читаем то, что она нарисовала, —
// тот же приём, что вытащил нас на маркетплейсах (см. NotebookExtract.extractUrlText).
//
// Панель приходится открыть кликом. Это не автоматизация чужого аккаунта: кнопка лишь
// разворачивает блок на странице, которую человек и так смотрит, никуда ничего не
// отправляя — в отличие от кнопки «отправить» в чужом чате, которую мы не жмём никогда.
//
// ⚠️ Селекторы YouTube гниют. Поэтому кнопку ищем по подписи (несколько языков), а
// сегменты — по имени элемента с запасным путём через контейнер целиком.

export interface TranscriptLine { t: string; text: string }
export interface VideoTranscript {
  title: string;
  channel: string;
  lines: TranscriptLine[];
}

// Страница ролика YouTube. Shorts тоже watch-страница, но субтитры там бывают редко —
// проверку не сужаем, просто не найдём панель и уйдём в обычное извлечение.
export function isVideoPage(url: string): boolean {
  try {
    const u = new URL(url);
    const host = u.hostname.replace(/^www\.|^m\./, '');
    if (host === 'youtu.be') return true;
    if (host !== 'youtube.com') return false;
    return u.pathname === '/watch' || u.pathname.startsWith('/shorts/');
  } catch {
    return false;
  }
}

// Скрипт исполняется В КОНТЕКСТЕ СТРАНИЦЫ. Никакого доступа к Node — это чужая страница.
//
// ⚠️ На живом YouTube замерено: имя элемента строки расшифровки ПЛАВАЕТ (рядом сосуществуют
// `ytd-transcript-segment-renderer` и панель нового образца `PAmodern_transcript_view`), и
// опираться на него нельзя. Устойчивее оказалась связка «панель по target-id + текст со
// штампами времени»: `target-id` — это идентификатор уровня их же API, а формат «1:23 текст»
// не меняется вовсе. Имя элемента оставлено запасным путём, а не основным.
export const TRANSCRIPT_SCRIPT = `(async () => {
  var sleep = function (ms) { return new Promise(function (r) { setTimeout(r, ms); }); };

  // Панель расшифровки: ищем по target-id, а не по имени элемента строки — оно у YouTube
  // меняется, а идентификатор панели держится.
  function panel() {
    var all = document.querySelectorAll('ytd-engagement-panel-section-list-renderer[target-id]');
    for (var i = 0; i < all.length; i++) {
      var id = all[i].getAttribute('target-id') || '';
      var vis = all[i].getAttribute('visibility') || '';
      if (/transcript/i.test(id) && /EXPANDED/i.test(vis)) return all[i];
    }
    return null;
  }

  // Строки вида «1:23 текст». Формат штампа не менялся никогда — на нём и стоим.
  function readLines(root) {
    var raw = (root.innerText || '').split(String.fromCharCode(10));
    var out = [];
    for (var i = 0; i < raw.length; i++) {
      var line = raw[i].trim();
      if (!line) continue;
      var m = line.match(/^(\d{1,2}:\d{2}(?::\d{2})?)\s+(.+)$/);
      if (m) { out.push({ t: m[1], text: m[2].trim() }); continue; }
      // Штамп и текст могут лежать РАЗНЫМИ строками — тогда склеиваем со следующей.
      if (/^\d{1,2}:\d{2}(?::\d{2})?$/.test(line) && raw[i + 1] && raw[i + 1].trim()) {
        out.push({ t: line, text: raw[i + 1].trim() });
        i++;
      }
    }
    return out;
  }

  // ⚠️ Замерено на живом ролике: пока страница НЕ ВИДНА (document.hidden), YouTube панель
  // разворачивает, но строки в неё не отрисовывает — содержимое у неё ленивое. Поэтому из
  // фоновой вкладки и из скрытой вью расшифровку взять нельзя в принципе, и ждать там нечего.
  // Выходим сразу: иначе каждая ютуб-страница на фоновой индексации истории вставала бы на
  // десятки секунд ради заведомо пустого результата.
  if (document.hidden) {
    return { ok: false, reason: 'Расшифровка доступна только для открытой на экране вкладки' };
  }

  // Открываем панель. Кнопку ищем по подписи и ОТСЕИВАЕМ «закрыть расшифровку» — иначе
  // первой в DOM попадается именно она и панель тут же схлопывается.
  var wantOpen = /(расшифров|стенограмм|розшифров|transcript)/i;
  var wantClose = /(закр|скрыт|close|hide)/i;
  if (!panel()) {
    var expand = document.querySelector('#description-inline-expander #expand, tp-yt-paper-button#expand');
    if (expand) { expand.click(); await sleep(600); }

    var nodes = document.querySelectorAll('button, tp-yt-paper-button, yt-button-shape, a');
    for (var k = 0; k < nodes.length; k++) {
      var sig = (nodes[k].getAttribute('aria-label') || '') + ' ' + (nodes[k].textContent || '');
      if (wantOpen.test(sig) && !wantClose.test(sig)) { nodes[k].click(); break; }
    }
    // Ждём именно СТРОКИ, а не саму панель: она разворачивается мгновенно, а содержимое
    // подтягивается отдельно. Потолок ожидания держим коротким — извлечение зовут в том
    // числе из фоновой индексации, и застревать там надолго нельзя.
    for (var w = 0; w < 20; w++) {
      var pnl0 = panel();
      if (pnl0 && readLines(pnl0).length) break;
      await sleep(400);
    }
  }

  var pnl = panel();
  var lines = pnl ? readLines(pnl) : [];

  // Запасной путь: панель не опозналась, но строки старого образца на месте.
  if (!lines.length) {
    var segs = document.querySelectorAll('ytd-transcript-segment-renderer');
    for (var j = 0; j < segs.length; j++) {
      var st = segs[j].querySelector('.segment-timestamp');
      var bd = segs[j].querySelector('.segment-text');
      var t = st ? (st.textContent || '').trim() : '';
      var tx = bd ? (bd.textContent || '').trim() : '';
      if (tx) lines.push({ t: t, text: tx });
    }
  }

  if (!lines.length) {
    return { ok: false, reason: pnl
      ? 'Панель расшифровки открылась, но строк в ней нет'
      : 'Расшифровка недоступна — похоже, у ролика нет субтитров' };
  }

  var chan = document.querySelector('ytd-channel-name #text a, ytd-channel-name a');
  var head = document.querySelector('h1.ytd-watch-metadata, h1 yt-formatted-string');
  return {
    ok: true,
    title: ((head && head.textContent) || document.title || '').trim(),
    channel: ((chan && chan.textContent) || '').trim(),
    lines: lines,
  };
})()`;

// Метка времени в секундах — чтобы прореживать их по времени, а не по числу строк
// (у автосубтитров строки короткие и частые, у ручных — длинные и редкие).
function seconds(stamp: string): number {
  const parts = stamp.split(':').map((p) => Number(p));
  if (parts.some((n) => !Number.isFinite(n))) return -1;
  if (parts.length === 3) return parts[0]! * 3600 + parts[1]! * 60 + parts[2]!;
  if (parts.length === 2) return parts[0]! * 60 + parts[1]!;
  return -1;
}

// Собираем расшифровку в текст. Метку ставим примерно раз в 45 секунд: она даёт модели
// (и человеку) опору «о чём и когда», но метка на каждой строке раздула бы текст вдвое
// и съела бюджет символов, который и так режет хвост длинного ролика.
const STAMP_EVERY_SEC = 45;

export function composeTranscript(t: VideoTranscript): string {
  const head: string[] = [];
  if (t.title) head.push(`Видео: ${t.title}`);
  if (t.channel) head.push(`Канал: ${t.channel}`);

  const chunks: string[] = [];
  let buffer: string[] = [];
  let lastStamp = -STAMP_EVERY_SEC;
  let openedAt = '';

  const flush = () => {
    if (!buffer.length) return;
    chunks.push(openedAt ? `[${openedAt}] ${buffer.join(' ')}` : buffer.join(' '));
    buffer = [];
  };

  for (const line of t.lines) {
    const sec = seconds(line.t);
    if (sec >= 0 && sec - lastStamp >= STAMP_EVERY_SEC) {
      flush();
      lastStamp = sec;
      openedAt = line.t;
    }
    buffer.push(line.text);
  }
  flush();

  return [...head, '', 'Расшифровка:', ...chunks].join('\n');
}

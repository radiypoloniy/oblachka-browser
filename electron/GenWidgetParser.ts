import { runTabOrganizePrompt } from './TranslationService';
import {
  GEN_FACTS, extractGenHtml, parseGenMeta, wantsGenPhoto, wantsGenTimer,
  phraseClearlyAsksBuiltin, pickGenMode, buildGenLexiconHtml, parseGenListLines,
  genAnswerIsUseless, type GenFactId, type GenMode,
} from '../shared/genWidget';

// Фраза → черновик своего виджета. Модель пишет одностраничник; хост потом суёт его в песочницу.
// Промпт под 4B: метки, английская инструкция, HTML отдельным прогоном.

export type GenParseOutcome =
  | { ok: true; kind: 'builtin'; widget: string; size: { w: number; h: number } }
  | {
    ok: true; kind: 'gen'; html: string; facts: GenFactId[];
    size: { w: number; h: number }; assetPhoto: boolean; title: string; mode: GenMode;
  }
  | { ok: false; reason: 'unclear' | 'model-error' | 'too-hard'; error?: string };

const HTML_MAX_TOKENS = 2400;

function buildMetaPrompt(phrase: string): string {
  const facts = GEN_FACTS.map((f) => `- ${f.id}: ${f.label}`).join('\n');
  return (
    `A browser user described a NEW home-screen widget. Their request, in Russian: "${phrase}"\n\n` +
    `Default is WIDGET: gen. Invent what they asked — not a copy of weather or clock.\n` +
    `Use a built-in id ONLY if the whole request is exactly that built-in (weather, clock, rates, crypto, tasks, shield, moon, downloads, holiday, tracking, digest, topsites, music).\n` +
    `WIDGET: none if it needs the live public internet (stock tickers, random web images),\n` +
    `or if it is a real-time action game (snake, tetris, arkanoid, platformer): a 2B-8B local model\n` +
    `cannot write a working game loop, and a broken one is worse than an honest refusal.\n` +
    `Dice, mood, streak, quote, habit, scoreboard, photo frame, random word, quiz — all WIDGET: gen.\n\n` +
    `Optional host facts (usually FACTS: -):\n${facts}\n\n` +
    `Answer with exactly these lines:\n` +
    `WIDGET: gen\n` +
    `FACTS: -\n` +
    `SIZE: small\n` +
    `ASSET: photo   (only if they asked for a photo/picture/frame)\n` +
    `or ASSET: none\n` +
    `KIND: list     (the tile shows ONE item picked from a list: a word, a quote, a fact, an advice, a dice face)\n` +
    `or KIND: custom  (anything else: counters, trackers, timers, games with state)\n` +
    `TITLE: <2-5 words in Russian>`
  );
}

/**
 * Список для плитки «один элемент из списка». HTML тут НЕ спрашивается вовсе.
 * ⚠️ Формат задаём мы и разбираем сами (parseGenListLines) — см. buildGenLexiconHtml о том,
 * почему код для таких виджетов модели не доверяем.
 */
function buildListPrompt(phrase: string, title: string): string {
  return (
    `A browser home-screen tile shows ONE random item from a list, and re-picks on click.\n` +
    `The user asked, in Russian: "${phrase}" (title: ${title}).\n\n` +
    `Write 14 items, one per line, in this exact format:\n` +
    `<big> — <small>\n` +
    `<big> is what the tile shows large: the English word, the quote, the fact.\n` +
    `<small> is the quiet line under it: the Russian translation, the author, a short note.\n` +
    `If there is nothing for <small>, still keep the dash and write one short word.\n\n` +
    `For a QUOTE widget <big> is the WHOLE quote and <small> is the author.\n` +
    `For a WORD widget <big> is the English word and <small> is the Russian translation.\n` +
    `Match the user's request — do not turn a quote request into single words.\n\n` +
    `Examples:\n` +
    `Sun — Солнце\n` +
    `Делай, что должно, и будь, что будет — Марк Аврелий\n\n` +
    `No numbering, no markdown, no HTML, no commentary. Just 14 lines.`
  );
}

function buildHtmlPrompt(phrase: string, facts: GenFactId[], title: string, assetPhoto: boolean): string {
  const factLines = facts.length
    ? `You MAY read ${facts.map((id) => `api.facts.${id}`).join(', ')} on event oblako-facts.`
    : 'Do not wait for oblako-facts.';
  const photo = assetPhoto
    ? 'The HOST draws the photo full-bleed. Do not put an <img> or a nested frame. You may call api.pickPhoto() from a button. No loading spinner.'
    : 'No images, no network.';
  const timer = wantsGenTimer(phrase)
    ? 'This is a timer: call api.timer.start(seconds). Remaining is facts.remainingMs. Do not decrement in setInterval.\n'
    : 'Do not add a pomodoro or timer unless they asked for one.\n';
  return (
    `Invent a small one-pager widget for: "${phrase}" (title: ${title}).\n` +
    `You invent the interaction. Do not imitate a clock unless they asked for a clock.\n\n` +
    `Constraints (look, not a template):\n` +
    `- No inner cards, grey boxes, or html/body background. No hex colors — use CSS variables like var(--accent).\n` +
    `- If the hero is a large word or number, wrap it in <div data-display>. Optional tiny label: <div data-caption>.\n` +
    `- Buttons only if needed, as accent pills.\n\n` +
    `RAW HTML only. No markdown, no \`\`\` fences, no commentary after tags.\n` +
    // ⚠️ 4B нужен ГОТОВЫЙ СКЕЛЕТ, а не описание задачи. Словесное «положи пары в массив и покажи
    // одну» давало код, который падал, и плитка выходила пустой — живой случай 22.08 («слово
    // с переводом» — ровно ноль информации на плитке).
    'For a "random item" widget (word, quote, fact, dice face) copy this skeleton and swap only the data:\n' +
    '<div data-caption>Word</div><div data-display></div><div data-meaning></div>\n' +
    '<script>var W=[["Sun","Солнце"],["Moon","Луна"]];' +
    'function pick(){var p=W[Math.floor(Math.random()*W.length)];' +
    'document.querySelector("[data-display]").textContent=p[0];' +
    'document.querySelector("[data-meaning]").textContent=p[1];}' +
    'pick();document.body.onclick=pick;</script>\n' +
    'Use 12-20 items. Never print the whole list as text.\n\n' +
    `${factLines}\n` +
    timer +
    `${photo}\n` +
    `Output HTML after the line HTML:\n`
  );
}

/**
 * Ход сборки для того, кто на неё смотрит. `chars` — сколько символов модель уже написала
 * на этой стадии; для полосы прогресса этого мало (сколько будет всего — неизвестно), а для
 * ЖИВОСТИ достаточно: анимация должна идти в ритме модели, а не в своём собственном.
 */
export interface GenProgress {
  stage: 'meta' | 'html' | 'done';
  chars: number;
}

export async function parsePhraseToGenWidget(
  phrase: string,
  onProgress?: (p: GenProgress) => void,
): Promise<GenParseOutcome> {
  const p = phrase.trim();
  if (p.length < 3) return { ok: false, reason: 'unclear' };

  let metaChars = 0;
  const metaRes = await runTabOrganizePrompt(buildMetaPrompt(p), {
    onChunk: (t) => { metaChars += t.length; onProgress?.({ stage: 'meta', chars: metaChars }); },
  });
  if (!metaRes.ok) {
    return { ok: false, reason: 'model-error', error: metaRes.error };
  }
  const meta = parseGenMeta(metaRes.out);
  if (wantsGenPhoto(p, '', meta.assetPhoto)) meta.assetPhoto = true;
  if (meta.widget !== 'gen' && meta.widget !== 'none' && !phraseClearlyAsksBuiltin(p, meta.widget)) {
    meta.widget = 'gen';
  }
  if (meta.widget === 'none' && !/http|тикер|курс бит|онлайн|интернет/i.test(p)) {
    meta.widget = 'gen';
  }
  if (meta.widget === 'none') return { ok: false, reason: 'unclear' };
  if (meta.widget !== 'gen') {
    return { ok: true, kind: 'builtin', widget: meta.widget, size: meta.size };
  }

  // ⚠️ Виджет-список собираем САМИ из данных модели. Второго прогона за HTML здесь нет —
  // именно он и приносил пустые плитки: 4B пишет разметку, ссылается на неё из скрипта и
  // ошибается, а увидеть ошибку человеку нечем.
  if (meta.kind === 'list' && !meta.assetPhoto && !wantsGenTimer(p)) {
    let listChars = 0;
    onProgress?.({ stage: 'html', chars: 0 });
    const listRes = await runTabOrganizePrompt(buildListPrompt(p, meta.title), {
      maxTokens: 700,
      onChunk: (t) => { listChars += t.length; onProgress?.({ stage: 'html', chars: listChars }); },
    });
    if (listRes.ok) {
      const pairs = parseGenListLines(listRes.out);
      if (pairs.length >= 4) {
        onProgress?.({ stage: 'done', chars: listChars });
        return {
          ok: true, kind: 'gen', html: buildGenLexiconHtml(pairs), facts: [],
          size: meta.size, assetPhoto: false, title: meta.title, mode: 'lexicon',
        };
      }
    }
    // Список не набрался — не бросаем человека, идём обычным путём за разметкой.
  }

  let htmlChars = 0;
  onProgress?.({ stage: 'html', chars: 0 });
  const htmlRes = await runTabOrganizePrompt(buildHtmlPrompt(p, meta.facts, meta.title, meta.assetPhoto), {
    maxTokens: HTML_MAX_TOKENS,
    onChunk: (t) => { htmlChars += t.length; onProgress?.({ stage: 'html', chars: htmlChars }); },
  });
  onProgress?.({ stage: 'done', chars: htmlChars });
  if (!htmlRes.ok) return { ok: false, reason: 'model-error', error: htmlRes.error };
  const html = extractGenHtml(htmlRes.out);
  if (!html) return { ok: false, reason: 'unclear' };
  // ⚠️ Разметка есть, а виджета нет: пустые коробки без кода и без стилей. Ставить такое на
  // стол нельзя — человек получит молчаливый пустой квадрат (живой случай со «змейкой»).
  if (genAnswerIsUseless(html)) return { ok: false, reason: 'too-hard' };
  const assetPhoto = meta.assetPhoto || wantsGenPhoto(p, html, false);
  return {
    ok: true, kind: 'gen', html, facts: meta.facts, size: meta.size,
    assetPhoto, title: meta.title, mode: pickGenMode(p, html, assetPhoto),
  };
}

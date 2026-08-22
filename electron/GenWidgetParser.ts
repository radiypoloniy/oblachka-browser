import { runTabOrganizePrompt } from './TranslationService';
import {
  GEN_FACTS, extractGenHtml, parseGenMeta, wantsGenPhoto, wantsGenTimer,
  phraseClearlyAsksBuiltin, pickGenMode, type GenFactId, type GenMode,
} from '../shared/genWidget';

// Фраза → черновик своего виджета. Модель пишет одностраничник; хост потом суёт его в песочницу.
// Промпт под 4B: метки, английская инструкция, HTML отдельным прогоном.

export type GenParseOutcome =
  | { ok: true; kind: 'builtin'; widget: string; size: { w: number; h: number } }
  | {
    ok: true; kind: 'gen'; html: string; facts: GenFactId[];
    size: { w: number; h: number }; assetPhoto: boolean; title: string; mode: GenMode;
  }
  | { ok: false; reason: 'unclear' | 'model-error'; error?: string };

const HTML_MAX_TOKENS = 2400;

function buildMetaPrompt(phrase: string): string {
  const facts = GEN_FACTS.map((f) => `- ${f.id}: ${f.label}`).join('\n');
  return (
    `A browser user described a NEW home-screen widget. Their request, in Russian: "${phrase}"\n\n` +
    `Default is WIDGET: gen. Invent what they asked — not a copy of weather or clock.\n` +
    `Use a built-in id ONLY if the whole request is exactly that built-in (weather, clock, rates, crypto, tasks, shield, moon, downloads, holiday, tracking, digest, topsites, music).\n` +
    `WIDGET: none only if it needs the live public internet (stock tickers, random web images).\n` +
    `Dice, mood, streak, quote, habit, scoreboard, photo frame, random word, quiz — all WIDGET: gen.\n\n` +
    `Optional host facts (usually FACTS: -):\n${facts}\n\n` +
    `Answer with exactly these lines:\n` +
    `WIDGET: gen\n` +
    `FACTS: -\n` +
    `SIZE: small\n` +
    `ASSET: photo   (only if they asked for a photo/picture/frame)\n` +
    `or ASSET: none\n` +
    `TITLE: <2-5 words in Russian>`
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
    `If you need English/Russian words, put 12–20 pairs in a JS array inside <script>, pick one on load and on click. Never print the whole list.\n\n` +
    `${factLines}\n` +
    timer +
    `${photo}\n` +
    `Output HTML after the line HTML:\n`
  );
}

export async function parsePhraseToGenWidget(phrase: string): Promise<GenParseOutcome> {
  const p = phrase.trim();
  if (p.length < 3) return { ok: false, reason: 'unclear' };

  const metaRes = await runTabOrganizePrompt(buildMetaPrompt(p));
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

  const htmlRes = await runTabOrganizePrompt(buildHtmlPrompt(p, meta.facts, meta.title, meta.assetPhoto), {
    maxTokens: HTML_MAX_TOKENS,
  });
  if (!htmlRes.ok) return { ok: false, reason: 'model-error', error: htmlRes.error };
  const html = extractGenHtml(htmlRes.out);
  if (!html) return { ok: false, reason: 'unclear' };
  const assetPhoto = meta.assetPhoto || wantsGenPhoto(p, html, false);
  return {
    ok: true, kind: 'gen', html, facts: meta.facts, size: meta.size,
    assetPhoto, title: meta.title, mode: pickGenMode(p, html, assetPhoto),
  };
}

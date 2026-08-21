import { runTabOrganizePrompt } from './TranslationService';
import {
  GEN_FACTS, extractGenHtml, parseGenMeta, wantsGenPhoto, phraseClearlyAsksBuiltin, type GenFactId,
} from '../shared/genWidget';

// Фраза → черновик своего виджета. Модель пишет одностраничник; хост потом суёт его в песочницу.
// Промпт под 4B: метки, английская инструкция, HTML отдельным прогоном.

export type GenParseOutcome =
  | { ok: true; kind: 'builtin'; widget: string; size: { w: number; h: number } }
  | {
    ok: true; kind: 'gen'; html: string; facts: GenFactId[];
    size: { w: number; h: number }; assetPhoto: boolean; title: string;
  }
  | { ok: false; reason: 'unclear' | 'model-error'; error?: string };

const HTML_MAX_TOKENS = 1600;

function buildMetaPrompt(phrase: string): string {
  const facts = GEN_FACTS.map((f) => `- ${f.id}: ${f.label}`).join('\n');
  return (
    `A browser user described a NEW home-screen widget. Their request, in Russian: "${phrase}"\n\n` +
    `Default is a custom widget (WIDGET: gen). Invent the idea they asked for — not a copy of weather/clock.\n` +
    `Use a built-in id ONLY if the whole request is exactly that built-in (weather, clock, rates, crypto, tasks, shield, moon, downloads, holiday, tracking, digest, topsites, music).\n` +
    `WIDGET: none only if it needs the live public internet (stock tickers, random web images).\n` +
    `A timer, dice, mood, streak, breathing circle, quote, habit, scoreboard, photo frame — all WIDGET: gen.\n\n` +
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
    : 'No images.';
  return (
    `Invent a glanceable desktop widget for: "${phrase}" (title: ${title}).\n` +
    `This is NOT limited to timer/photo/counter. Build what they asked, even if odd.\n\n` +
    `Oblako look (same as the Clock widget):\n` +
    `- Markup MUST use <div data-caption>LABEL</div> and <div data-display>MAIN</div>. Caption is tiny mono caps; display is the huge number/word.\n` +
    `- Do not draw inner cards, grey boxes, progress bars, or a second background. The tile is already the card.\n` +
    `- Do not set html/body background. No hex colors.\n` +
    `- Buttons at the bottom, accent pills. Status as a short line, not a form.\n\n` +
    `${factLines}\n` +
    `Timers: show 25:00 (or asked duration), not dashes. setInterval or oblako-tick. Persist with api.storage.\n` +
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
  return {
    ok: true, kind: 'gen', html, facts: meta.facts, size: meta.size,
    assetPhoto: meta.assetPhoto || wantsGenPhoto(p, html, false), title: meta.title,
  };
}

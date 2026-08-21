import { runTabOrganizePrompt } from './TranslationService';
import {
  GEN_FACTS, GEN_BUILTIN_WIDGETS, extractGenHtml, parseGenMeta, type GenFactId,
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

const HTML_MAX_TOKENS = 1024;

function buildMetaPrompt(phrase: string): string {
  const builtins = GEN_BUILTIN_WIDGETS.join(', ');
  const facts = GEN_FACTS.map((f) => `- ${f.id}: ${f.label}`).join('\n');
  return (
    `A browser user wants a home-screen widget. Their request, in Russian: "${phrase}"\n\n` +
    `Built-in widgets (use these if the request is clearly one of them): ${builtins}\n` +
    `If it is a new custom widget (timer, photo frame, counter of facts, etc.), use gen.\n` +
    `If it needs the public internet (stocks, random images from the web, weather APIs beyond the built-in weather widget), answer WIDGET: none.\n\n` +
    `Facts the host can inject into a custom widget:\n${facts}\n\n` +
    `Answer with exactly these lines and nothing else:\n` +
    `WIDGET: <built-in id, or gen, or none>\n` +
    `FACTS: <comma-separated fact ids, or ->\n` +
    `SIZE: small\n` +
    `or SIZE: medium\n` +
    `or SIZE: large\n` +
    `ASSET: photo\n` +
    `or ASSET: none\n` +
    `TITLE: <2-5 words in Russian>`
  );
}

function buildHtmlPrompt(phrase: string, facts: GenFactId[], title: string, assetPhoto: boolean): string {
  const factLines = (facts.length ? facts : GEN_FACTS.map((f) => f.id))
    .map((id) => `api.facts.${id}`)
    .join(', ');
  const photo = assetPhoto
    ? 'You may show the user photo with <img id="photo"> and in script: document.getElementById("photo").src = api.assets.photo || "";'
    : 'Do not load images from the internet.';
  return (
    `Build a tiny single-file widget for a ${title || 'desktop'} tile. ` +
    `The user's request, in Russian: "${phrase}"\n\n` +
    `Rules:\n` +
    `- Output HTML after the line HTML:\n` +
    `- Use only CSS variables: var(--accent), var(--surface), var(--text-body), var(--text-strong), var(--font-sans), var(--font-display), var(--radius-box).\n` +
    `- No http URLs, no iframes, no external scripts.\n` +
    `- Read numbers from ${factLines}. They arrive on window event "oblako-facts". Until then show a dash.\n` +
    `- Persist timer/counter state with api.storage.get() / api.storage.set(string).\n` +
    `- ${photo}\n` +
    `- Keep it under 80 lines. Buttons may use background: var(--accent); color: var(--on-accent).\n\n` +
    `HTML:\n`
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
    assetPhoto: meta.assetPhoto, title: meta.title,
  };
}

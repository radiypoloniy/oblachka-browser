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
  const factLines = facts.length
    ? facts.map((id) => `api.facts.${id}`).join(', ')
    : '(none — do not wait for facts)';
  const photo = assetPhoto
    ? 'The host shows a photo picker. When a photo is chosen it arrives as api.assets.photo (data URL). Show the image with <img> and set src on oblako-facts. If photo is empty, show a short Russian caption «Выберите фото», not a loading spinner.'
    : 'Do not use images.';
  return (
    `Build a tiny single-file widget for a desktop tile titled "${title || 'widget'}". ` +
    `The user's request, in Russian: "${phrase}"\n\n` +
    `Visual rules (Oblako):\n` +
    `- Do NOT set background on html/body. The tile already has a surface.\n` +
    `- Only CSS variables: var(--accent), var(--on-accent), var(--text-body), var(--text-strong), var(--text-faint), var(--font-sans), var(--font-display), var(--radius-pill).\n` +
    `- No hex colors, no purple, no orange literals, no white/black cards.\n` +
    `- Big numbers use font-family: var(--font-display); color: var(--text-strong).\n` +
    `- Caption uses font-size: var(--fs-xs); color: var(--text-faint).\n\n` +
    `Behavior:\n` +
    `- Output HTML after the line HTML:\n` +
    `- No http URLs, no iframes, no external scripts.\n` +
    `- Timer/pomodoro: start at 25:00 (or the requested duration), NOT dashes. Use setInterval or the oblako-tick event. api.now is Date.now(). Persist endAt with api.storage.get()/set(string).\n` +
    `- Do not wait for oblako-facts unless you display these host numbers: ${factLines}.\n` +
    `- ${photo}\n` +
    `- Keep under 80 lines.\n\n` +
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

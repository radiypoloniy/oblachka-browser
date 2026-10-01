import type { WebContents } from 'electron';

// Формы и редактируемые поля не входят ни в отпечаток страницы, ни в запрос модели.
const SAMPLE = `(() => {
  if (!document.body) return '';
  const article = document.querySelector('article');
  const root = article || document.querySelector('main') || document.body;
  if (!article && root.querySelector('textarea,[contenteditable="true"],[role="log"],[role="feed"]')) return '';
  const copy = root.cloneNode(true);
  copy.querySelectorAll('nav,header,footer,aside,form,input,textarea,select,script,style,[contenteditable]').forEach(n => n.remove());
  const blocks = [...copy.querySelectorAll('p,li,h1,h2,h3,h4,blockquote,pre,td')];
  const text = blocks.length ? blocks.map(n => n.textContent || '').join('\\n') : copy.textContent || '';
  return text;
})()`;
export async function insightPageText(wc: WebContents): Promise<string> {
  const text: unknown = await wc.executeJavaScript(SAMPLE);
  return typeof text === 'string' ? text.trim() : '';
}
export function eligibleInsightPage(url: string): boolean {
  try {
    const u = new URL(url);
    return ['http:', 'https:'].includes(u.protocol) &&
      !/(?:^|\/)(?:search|chat|login|signin|checkout|compose)(?:\/|$)/i.test(u.pathname) &&
      !u.searchParams.has('q');
  } catch { return false; }
}
export async function revealInsight(wc: WebContents, quote: string): Promise<void> {
  // Цитата проверена по исходным фрагментам; DOM ищется заново после каждого обновления.
  await wc.executeJavaScript(`(() => {
    const quote = ${JSON.stringify(quote)};
    const nodes = [...document.querySelectorAll('p,li,blockquote,pre,td,main,article')];
    const node = nodes.filter(n => !n.closest('form,[contenteditable]') &&
      (n.textContent || '').replace(/\\s+/g,' ').includes(quote))
      .sort((a,b) => (a.textContent || '').length - (b.textContent || '').length)[0];
    if (!node) return;
    node.scrollIntoView({behavior:'smooth',block:'center'});
    const range = document.createRange(); range.selectNodeContents(node);
    const selection = window.getSelection(); selection.removeAllRanges(); selection.addRange(range);
  })()`);
}

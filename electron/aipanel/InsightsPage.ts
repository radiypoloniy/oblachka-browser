import type { WebContents } from 'electron';

// Изолированный мир хранит только один снимок. Неизменный DOM не клонируется и не пересылается.
// Наблюдатель сам отключается через 15 секунд без проверок; подготовка активной вкладки его продлевает.
export const INSIGHT_SAMPLE = String.raw`(() => {
  if (!document.body) return '';
  const excluded = 'nav,header,footer,aside,form,input,textarea,select,script,style,[contenteditable],[role="log"],[role="feed"],[role="status"],[role="timer"],.comments,#comments';
  let state = globalThis.__oblakoInsights;
  const initial = !state;
  if (!state) {
    state = globalThis.__oblakoInsights = {dirty:true, text:'', expires:0, observer:null, root:null, body:document.body};
    state.observer = new MutationObserver(records => {
      if (records.some(r => {
        const el = r.target.nodeType === 1 ? r.target : r.target.parentElement;
        if (el?.closest(excluded)) return false;
        if (state.root?.isConnected && !state.root.contains(r.target)) return false;
        if (r.type !== 'childList') return true;
        return [...r.addedNodes, ...r.removedNodes].some(n => n.nodeType !== 1 || !n.matches(excluded));
      })) state.dirty = true;
    });
    state.observer.observe(document.body,{subtree:true,childList:true,characterData:true});
  }
  clearTimeout(state.expires);
  state.expires = setTimeout(() => {state.observer.disconnect(); delete globalThis.__oblakoInsights;},15000);
  if (!state.root?.isConnected || state.body !== document.body) {
    state.dirty = true; state.body = document.body;
    state.observer.disconnect();
    state.observer.observe(document.body,{subtree:true,childList:true,characterData:true});
  }
  if (!state.dirty) return null;
  state.dirty = false;
  const articles = [...document.querySelectorAll('article')].filter(n => !n.closest(excluded));
  const article = articles.sort((a,b) => (b.textContent || '').length - (a.textContent || '').length)[0];
  const root = article && (article.textContent || '').length >= 600 ? article : document.querySelector('main') || document.body;
  state.root = root;
  const blocks = 'p,li,h1,h2,h3,h4,blockquote,pre,td';
  const walk = document.createTreeWalker(root, NodeFilter.SHOW_ELEMENT | NodeFilter.SHOW_TEXT, {
    acceptNode(n) {
      if (n.nodeType === 1) return n.matches(excluded) ? NodeFilter.FILTER_REJECT : NodeFilter.FILTER_SKIP;
      return NodeFilter.FILTER_ACCEPT;
    }
  });
  const parts = []; let previous = null, size = 0, n;
  while ((n = walk.nextNode()) && size < 120000) {
    const block = n.parentElement.closest(blocks) || root;
    if (block !== previous && parts.length) parts.push('\n');
    const value = (n.textContent || '').slice(0,120000-size);
    parts.push(value); size += value.length; previous = block;
  }
  const text = parts.join('').split('\n').map(s => s.replace(/\s+/g,' ').trim()).filter(Boolean).join('\n');
  if (!initial && text === state.text) return null;
  state.text = text; return text;
})()`;
const snapshots = new WeakMap<WebContents, string>();
export function releaseInsightPage(wc: WebContents): void {
  snapshots.delete(wc);
  if (!wc.isDestroyed()) void wc.executeJavaScriptInIsolatedWorld(1004, [{ code: `(() => {
    const state = globalThis.__oblakoInsights;
    if (state) { clearTimeout(state.expires); state.observer.disconnect(); delete globalThis.__oblakoInsights; }
  })()` }]).catch(() => {});
}
export async function insightPageText(wc: WebContents): Promise<string> {
  const text: unknown = await wc.executeJavaScriptInIsolatedWorld(1004, [{ code: INSIGHT_SAMPLE }]);
  if (typeof text === 'string') snapshots.set(wc, text.trim());
  return snapshots.get(wc) ?? '';
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

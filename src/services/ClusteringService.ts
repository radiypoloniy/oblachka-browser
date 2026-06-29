import { embeddingService } from './EmbeddingService'
import type { SidebarNode, TabState } from '../../shared/ipc'

// Порог агломеративной кластеризации (average-linkage, косинусное сходство).
// Выше = строже (меньше групп, крупнее), ниже = мягче (больше групп, точнее).
// Рекомендуемый диапазон подбора: 0.30–0.60.
export const DEFAULT_SIMILARITY_THRESHOLD = 0.60

interface Candidate {
  nodeId: string               // tabId для single; leftTabId для split-pair
  nodeType: 'single' | 'split-pair'
  signal: string               // title + hostname — вход в модель
  title: string                // оригинальный заголовок — для именования
}

export interface ClusterProposal {
  nodeIds: string[]
  nodeTypes: ('single' | 'split-pair')[]
  titles: string[]
  suggestedName: string
}

function extractHostname(url: string): string {
  try { return new URL(url).hostname.replace(/^www\./, '') } catch { return '' }
}

// Вектора нормализованы MiniLM (normalize: true) → косинусное сходство = скалярное произведение.
function cosineSim(a: Float32Array, b: Float32Array): number {
  let dot = 0
  for (let i = 0; i < a.length; i++) dot += a[i]! * b[i]!
  return dot
}

// Average-linkage агломеративная кластеризация.
// O(n²k) на итерацию, всего O(n³) — приемлемо для n ≤ ~100 вкладок.
function agglomerate(vecs: Float32Array[], threshold: number): number[][] {
  let clusters: number[][] = vecs.map((_, i) => [i])

  for (;;) {
    if (clusters.length < 2) break

    let bestSim = -Infinity
    let bestI = 0, bestJ = 1

    for (let i = 0; i < clusters.length; i++) {
      for (let j = i + 1; j < clusters.length; j++) {
        const ci = clusters[i]!, cj = clusters[j]!
        let sum = 0
        for (const ai of ci) for (const bi of cj) sum += cosineSim(vecs[ai]!, vecs[bi]!)
        const avg = sum / (ci.length * cj.length)
        if (avg > bestSim) { bestSim = avg; bestI = i; bestJ = j }
      }
    }

    if (bestSim < threshold) break

    // bestI < bestJ гарантировано циклом (j > i), поэтому splice(bestJ) не сдвигает bestI.
    clusters[bestI] = [...clusters[bestI]!, ...clusters[bestJ]!]
    clusters.splice(bestJ, 1)
  }

  return clusters
}

// Общеупотребимые стоп-слова EN + RU, нерелевантные для именования группы.
const EN_STOP = new Set([
  'the','a','an','and','or','to','of','in','on','at','for','with','by',
  'is','it','its','this','that','was','are','be','as','from','but','not',
  'have','had','has','were','he','she','they','we','you','my','your','our',
  'their','about','page','home','how','what','why','when','where','new',
])
const RU_STOP = new Set([
  'и','в','на','с','по','к','из','за','у','о','об','от','до',
  'не','же','ли','а','но','то','что','так','как','или','бы',
  'если','чтобы','для','при','это','этот','эта','эти','все','всё',
])

// Вырезает суффиксы «— Site» / «| Brand» / «- Name» из конца заголовков.
function stripDomainSuffix(title: string): string {
  return title
    .replace(/\s[–—|]\s[^–—|]{1,40}$/, '')
    .replace(/\s-\s[^-]{1,40}$/, '')
    .trim()
}

// Именует группу из набора заголовков: top-2 слова по частоте после фильтрации стоп-слов.
function extractGroupName(titles: string[]): string {
  if (titles.length === 0) return 'Группа'

  if (titles.length === 1) {
    const cleaned = stripDomainSuffix(titles[0]!)
    return (cleaned.slice(0, 25) || titles[0]!.slice(0, 25) || 'Группа')
  }

  const freq = new Map<string, number>()
  for (const title of titles) {
    const words = stripDomainSuffix(title)
      .toLowerCase()
      .split(/[\s\-_/|·•,.:;!?()[\]{}'"«»—–]+/)
      .filter(Boolean)
    for (const word of words) {
      if (word.length < 3) continue
      if (EN_STOP.has(word) || RU_STOP.has(word)) continue
      freq.set(word, (freq.get(word) ?? 0) + 1)
    }
  }

  const top = [...freq.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 2)
    .map(([w]) => w)

  if (top.length === 0) {
    const fallback = stripDomainSuffix(titles[0]!)
    return fallback.slice(0, 25) || 'Группа'
  }

  const name = top.join(' ')
  return name.charAt(0).toUpperCase() + name.slice(1)
}

// Собирает кандидатов с ВЕРХНЕГО уровня nodes (GroupNode пропускаются — не трогаем).
// Спящие вкладки включаются: tab.title / tab.url уже заполнены из sleeping-метаданных.
function buildCandidates(nodes: SidebarNode[], tabMap: Map<string, TabState>): Candidate[] {
  const result: Candidate[] = []
  for (const node of nodes) {
    if (node.type === 'single') {
      const tab = tabMap.get(node.tabId)
      if (!tab || tab.isHub || tab.isPinned) continue
      const signal = `${tab.title} ${extractHostname(tab.url)}`.trim()
      result.push({ nodeId: node.tabId, nodeType: 'single', signal, title: tab.title })
    } else if (node.type === 'split-pair') {
      // Пара — единица кластеризации; сигнал по левой вкладке.
      const left = tabMap.get(node.leftTabId)
      if (!left) continue
      const signal = `${left.title} ${extractHostname(left.url)}`.trim()
      result.push({ nodeId: node.leftTabId, nodeType: 'split-pair', signal, title: left.title })
    }
    // GroupNode: существующие группы не трогаем.
  }
  return result
}

// Кластеризует незакреплённые, негруппированные вкладки (верхний уровень nodes).
// Инференс уходит в embedding worker — не морозит UI.
// Синглтоны (кластер из 1 вкладки) в предложение не попадают.
export async function clusterTabs(
  nodes: SidebarNode[],
  tabMap: Map<string, TabState>,
  threshold = DEFAULT_SIMILARITY_THRESHOLD,
): Promise<ClusterProposal[]> {
  const candidates = buildCandidates(nodes, tabMap)
  if (candidates.length < 2) return []

  const vecs = await embeddingService.embed(candidates.map((c) => c.signal))

  const groups = agglomerate(vecs, threshold)

  const proposals: ClusterProposal[] = []
  for (const group of groups) {
    if (group.length < 2) continue
    const members = group.map((i) => candidates[i]!)
    proposals.push({
      nodeIds:       members.map((m) => m.nodeId),
      nodeTypes:     members.map((m) => m.nodeType),
      titles:        members.map((m) => m.title),
      suggestedName: extractGroupName(members.map((m) => m.title)),
    })
  }

  return proposals
}

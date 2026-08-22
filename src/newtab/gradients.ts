// Каталог сеток: готовые из ядра + те, что человек собрал в настройках.
//
// ⚠️ Один список на два раздела («Фон интерфейса» и «Фон») и на обои AI-панели. Если хранить
// копии — конструктор придётся делать трижды, и они разъедутся (см. roadmap-2026-08-20).
// Готовые сетки живут в коде (shared/chromeGround.ts), свои — отдельным ключом localStorage,
// не внутри oblako-newtab-settings: JSON настроек не должен раздуваться картинкой-описанием,
// а выбор «какой id сейчас стоит» остаётся в settings (как preset).

import {
  BUILTIN_MESHES, validateMesh, compileMeshBackground, adaptMeshToTheme, type MeshGradient,
} from '../../shared/chromeGround';

const KEY = 'oblako-user-gradients';
const EVENT = 'oblako-gradients-changed';
export const USER_MESH_MAX = 24;

export function loadUserMeshes(): MeshGradient[] {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    const out: MeshGradient[] = [];
    for (const item of parsed) {
      const mesh = validateMesh(item);
      if (mesh && !mesh.id.startsWith('mesh-')) out.push(mesh);
      if (out.length >= USER_MESH_MAX) break;
    }
    return out;
  } catch {
    return [];
  }
}

function persist(list: MeshGradient[]): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(list));
    window.dispatchEvent(new CustomEvent(EVENT));
  } catch { /* квота / приватный режим — сетка останется в памяти на эту сессию */ }
}

export function allMeshes(): MeshGradient[] {
  return [...loadUserMeshes(), ...BUILTIN_MESHES];
}

export function findMesh(id: string): MeshGradient | null {
  if (!id) return null;
  return loadUserMeshes().find((m) => m.id === id) ?? BUILTIN_MESHES.find((m) => m.id === id) ?? null;
}

export function saveUserMesh(mesh: MeshGradient): MeshGradient | null {
  const checked = validateMesh({
    ...mesh,
    id: mesh.id && !mesh.id.startsWith('mesh-') ? mesh.id : `u${Date.now().toString(36)}`,
  });
  if (!checked) return null;
  const list = loadUserMeshes().filter((m) => m.id !== checked.id);
  persist([checked, ...list].slice(0, USER_MESH_MAX));
  return checked;
}

export function deleteUserMesh(id: string): void {
  if (!id || id.startsWith('mesh-')) return;
  persist(loadUserMeshes().filter((m) => m.id !== id));
}

export function isUserMesh(id: string): boolean {
  return !!id && !id.startsWith('mesh-') && loadUserMeshes().some((m) => m.id === id);
}

export function subscribeMeshes(cb: () => void): () => void {
  const handler = () => cb();
  window.addEventListener(EVENT, handler);
  window.addEventListener('storage', handler);
  return () => {
    window.removeEventListener(EVENT, handler);
    window.removeEventListener('storage', handler);
  };
}

export function documentIsDark(): boolean {
  return document.documentElement.getAttribute('data-theme') === 'dark';
}

export function meshCss(mesh: MeshGradient, dark = documentIsDark()): string {
  return compileMeshBackground(adaptMeshToTheme(mesh, dark));
}

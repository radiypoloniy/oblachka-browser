import { app, nativeImage } from 'electron';
import type { NativeImage } from 'electron';
import { existsSync } from 'node:fs';
import path from 'node:path';

const cache = new Map<string, NativeImage | undefined>();

/** Нейтральные Lucide-иконки для нативных меню; их PNG копирует Vite из src/public в dist. */
export function menuIcon(name: string): NativeImage | undefined {
  if (cache.has(name)) return cache.get(name);
  const root = app.getAppPath();
  const built = path.join(root, 'dist', 'menu-icons', `${name}.png`);
  const source = path.join(root, 'src', 'public', 'menu-icons', `${name}.png`);
  const file = existsSync(built) ? built : source;
  const image = nativeImage.createFromPath(file);
  const icon = image.isEmpty() ? undefined : image.resize({ width: 16, height: 16 });
  cache.set(name, icon);
  return icon;
}

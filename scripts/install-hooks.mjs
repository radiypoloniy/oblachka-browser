// Включение git-хуков проекта: git config core.hooksPath .githooks
//
// Зачем отдельный шаг. Каталог .git/hooks не версионируется — хук, положенный туда руками, живёт
// на одной машине и на новом клоне отсутствует молча. `core.hooksPath` переводит git на папку
// ВНУТРИ репозитория, и тогда хук едет вместе с кодом.
//
// ⚠️ Husky и подобные обвязки не ставим: одна строка конфига делает ровно то же, а зависимость,
// которая правит .git, — это лишний повод разбираться, почему коммит не проходит.
//
// Вызывается из postinstall. Молчит и выходит с нулём в любой нештатной ситуации: сломать
// `npm install` тем, что в песочнице сборки нет git, — цена несоразмерная пользе хука.
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const HOOKS = '.githooks';

try {
  if (!fs.existsSync(path.join(ROOT, '.git'))) process.exit(0);   // не клон, а распакованный архив
  if (!fs.existsSync(path.join(ROOT, HOOKS))) process.exit(0);

  const current = (() => {
    try {
      return execFileSync('git', ['config', '--get', 'core.hooksPath'], { cwd: ROOT, encoding: 'utf8' }).trim();
    } catch {
      return '';   // ключа просто нет — git возвращает код 1
    }
  })();

  if (current === HOOKS) process.exit(0);

  // ⚠️ Чужую настройку не перетираем: если человек увёл хуки в своё место осознанно, тихая подмена
  // из postinstall — последнее, что он ожидает.
  if (current && current !== HOOKS) {
    console.log(`  git-хуки: core.hooksPath уже указывает на «${current}» — не трогаю.`);
    process.exit(0);
  }

  execFileSync('git', ['config', 'core.hooksPath', HOOKS], { cwd: ROOT });
  console.log('  git-хуки проекта включены (.githooks). Пропустить разово: git commit --no-verify');
} catch {
  // Нет git, нет прав, репозиторий в необычном состоянии — не повод валить установку.
}

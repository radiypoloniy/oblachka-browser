// Инвентарь потенциально непереведённых строк интерфейса. Это подсказка для ручного
// прохода, а не автоматический перевод: часть строк — данные сайтов или промпты модели.
import { readdirSync, readFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import ts from 'typescript';

const ROOT = new URL('..', import.meta.url).pathname.replace(/^\/(?=[A-Za-z]:)/, '');
const CYRILLIC = /[А-Яа-яЁё]/;
const rows = [];

function visitFile(path) {
  const name = relative(ROOT, path).replaceAll('\\', '/');
  if (name === 'src/i18n.tsx') return;
  const source = ts.createSourceFile(path, readFileSync(path, 'utf8'), ts.ScriptTarget.Latest, true,
    path.endsWith('.tsx') ? ts.ScriptKind.TSX : ts.ScriptKind.TS);
  const examples = [];
  function walk(node) {
    const literal = ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)
      || ts.isTemplateHead(node) || ts.isTemplateMiddle(node) || ts.isTemplateTail(node)
      || ts.isJsxText(node);
    if (literal && CYRILLIC.test(node.text)) {
      const parent = node.parent;
      const translated = ts.isCallExpression(parent)
        && parent.arguments.includes(node)
        && ts.isIdentifier(parent.expression)
        && parent.expression.text === 't';
      if (!translated) {
        const line = source.getLineAndCharacterOfPosition(node.getStart(source)).line + 1;
        examples.push(`${line}: ${node.text.replace(/\s+/g, ' ').trim().slice(0, 95)}`);
      }
    }
    ts.forEachChild(node, walk);
  }
  walk(source);
  if (examples.length) rows.push({ name, examples });
}

function walkDir(path) {
  for (const entry of readdirSync(path, { withFileTypes: true })) {
    const full = join(path, entry.name);
    if (entry.isDirectory()) walkDir(full);
    else if (/\.(tsx|ts)$/.test(entry.name)) visitFile(full);
  }
}

for (const dir of ['src', 'electron', 'shared']) walkDir(join(ROOT, dir));
rows.sort((a, b) => b.examples.length - a.examples.length || a.name.localeCompare(b.name));
const count = rows.reduce((sum, row) => sum + row.examples.length, 0);
console.log(`${count} потенциально непереведённых фрагментов в ${rows.length} файлах`);
const visible = process.argv.includes('--all') ? rows : rows.slice(0, 35);
for (const row of visible) {
  console.log(`\n${row.name} (${row.examples.length})`);
  for (const example of row.examples.slice(0, 3)) console.log(`  ${example}`);
}
if (visible.length < rows.length) console.log(`\nЕщё ${rows.length - visible.length} файлов: npm run i18n:audit -- --all`);

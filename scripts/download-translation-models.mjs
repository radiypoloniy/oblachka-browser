#!/usr/bin/env node
/**
 * Скачивает модели перевода Bergamot (Marian NMT, intgemm) для пар en<->X — X это каждый язык
 * из LANG_NAME (electron/TranslationService.ts), кроме самого en (см. TARGET_LANGS ниже — список
 * держим отдельно: TranslationService.ts не safe-to-import из голого CLI-скрипта, он грузит
 * node-llama-cpp на верхнем уровне).
 *
 * Источник — реестр Mozilla Remote Settings, тот же прод-CDN Firefox Translations, что описан в
 * README (раздел Bergamot). Кладёт файлы в resources/models/translation/{from}-{to}/ — тот же
 * бандл, что и ручной dev-набор en-ru/ru-en. Копировать в userData вручную БОЛЬШЕ НЕ НУЖНО:
 * BergamotWorkerEntry.ts сам подхватывает бандл как фолбэк, если в userData ничего нет (см. живой
 * баг, из-за которого этот скрипт появился, — модели лежали в resources/, а воркер смотрел только
 * в userData и молча откатывался на Qwen).
 *
 * Версия моделей: в реестре у разных языков разный набор версий (ru — только старая alpha 1.0a1,
 * у большинства остальных есть свежие 1.x/2.x). Единого фиксированного номера на все пары нет —
 * берём САМУЮ СВЕЖУЮ версию, для которой есть полный комплект (model+lex+vocab), а не жёстко
 * прибитую строку. Проверено вживую смоук-тестом (bergamot-smoke.mjs) на 18 языках плюс сравнение
 * 1.0a1 vs 2.1 для ru — новее не ломает формат, только улучшает перевод.
 *
 * Не у всех языков из LANG_NAME есть модель под КАЖДУЮ пару: zh — нет вообще ни в одну сторону,
 * be/cs/el — только X->en (в en->X пары нет). Это ограничение реестра Mozilla, не баг скрипта —
 * скрипт логирует такие пары и не падает.
 *
 * Запуск: npm run download-translation-models
 */
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const OUT_ROOT = path.join(__dirname, '..', 'resources', 'models', 'translation')

const REGISTRY_URL = 'https://firefox.settings.services.mozilla.com/v1/buckets/main/collections/translations-models/records?_limit=20000'
const ATTACHMENT_BASE = 'https://firefox-settings-attachments.cdn.mozilla.net/'

// Та же граница языков, что LANG_NAME в electron/TranslationService.ts (без en — сам пивот, ru уже
// был скачан вручную при разработке, но переоформлен на общую логику ниже — если файлов ещё нет,
// докачает и его тоже). Список сверять с TranslationService.ts при добавлении нового языка перевода.
const TARGET_LANGS = ['ru', 'fr', 'de', 'es', 'it', 'pt', 'nl', 'pl', 'uk', 'cs', 'sv', 'el', 'ro', 'hu', 'bg', 'hr', 'be', 'zh', 'ja', 'ko', 'tr', 'ar']
const PIVOT = 'en'

function isVocabFileType(fileType) {
  return fileType === 'vocab' || fileType === 'srcvocab' || fileType === 'trgvocab'
}

// Из всех версий пары в реестре возвращает файлы САМОЙ СВЕЖЕЙ (по last_modified), у которой есть
// полный комплект model+lex+vocab(s) — см. комментарий выше про разброс версий по языкам.
function pickBestVersion(records, from, to) {
  const recs = records.filter((r) => r.fromLang === from && r.toLang === to)
  if (recs.length === 0) return null

  const byVersion = new Map()
  for (const r of recs) {
    if (!byVersion.has(r.version)) byVersion.set(r.version, [])
    byVersion.get(r.version).push(r)
  }
  const versions = [...byVersion.keys()].sort((a, b) => {
    const newest = (v) => Math.max(...byVersion.get(v).map((x) => x.last_modified))
    return newest(b) - newest(a)
  })

  for (const version of versions) {
    const files = byVersion.get(version)
    const hasModel = files.some((f) => f.fileType === 'model')
    const hasLex = files.some((f) => f.fileType === 'lex')
    const hasVocab = files.some((f) => isVocabFileType(f.fileType))
    if (hasModel && hasLex && hasVocab) {
      return { version, files: files.filter((f) => f.fileType === 'model' || f.fileType === 'lex' || isVocabFileType(f.fileType)) }
    }
  }
  return null
}

async function downloadAttachment(attachment, destDir) {
  const dest = path.join(destDir, attachment.filename)
  if (fs.existsSync(dest)) {
    console.log(`    пропуск (уже есть): ${attachment.filename}`)
    return
  }
  const resp = await fetch(ATTACHMENT_BASE + attachment.location)
  if (!resp.ok) throw new Error(`HTTP ${resp.status} для ${attachment.location}`)
  const buf = Buffer.from(await resp.arrayBuffer())
  fs.mkdirSync(destDir, { recursive: true })
  fs.writeFileSync(dest, buf)
  console.log(`    ✓ ${attachment.filename} (${(buf.byteLength / 1024 / 1024).toFixed(1)} MB)`)
}

async function downloadPair(records, from, to) {
  const best = pickBestVersion(records, from, to)
  if (!best) {
    console.log(`  ${from}->${to}: нет модели в реестре — пропускаю`)
    return false
  }
  console.log(`  ${from}->${to} (версия ${best.version}):`)
  const destDir = path.join(OUT_ROOT, `${from}-${to}`)
  for (const rec of best.files) {
    await downloadAttachment(rec.attachment, destDir)
  }
  return true
}

console.log('Скачиваю реестр моделей Mozilla Remote Settings…')
const registryResp = await fetch(REGISTRY_URL)
if (!registryResp.ok) throw new Error(`HTTP ${registryResp.status} при получении реестра`)
const { data: records } = await registryResp.json()
console.log(`Реестр: ${records.length} запис(ей)\n`)

const incomplete = []
for (const lang of TARGET_LANGS) {
  console.log(`═══ ${lang} ═══`)
  const gotToEn = await downloadPair(records, lang, PIVOT)
  const gotFromEn = await downloadPair(records, PIVOT, lang)
  if (!gotToEn || !gotFromEn) incomplete.push(lang)
}

console.log('\nГотово.')
if (incomplete.length > 0) {
  console.log(`\nНеполные пары (доступна только ОДНА сторона из en<->X, см. вывод выше): ${incomplete.join(', ')}`)
  console.log('Это ограничение реестра Mozilla на сегодня, не ошибка скрипта — перезапуск не поможет.')
}
console.log(`\nФайлы лежат в ${OUT_ROOT}`)
console.log('Приложение подхватит их автоматически при следующем запуске (фолбэк на бандл, если')
console.log('userData ещё пуст, см. electron/BergamotWorkerEntry.ts) — копировать вручную не нужно.')

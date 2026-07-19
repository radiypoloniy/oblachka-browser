import fs from 'node:fs'

// mkdirSync с recursive:true уже идемпотентен сам по себе (не бросает, если каталог существует,
// создаёт всю цепочку недостающих родителей) — обёртка только даёт общее место вызова для
// потребителей (загрузчик моделей и т.п.), не меняет и не расширяет поведение mkdirSync.
export function ensureDir(dir: string): void {
  fs.mkdirSync(dir, { recursive: true })
}

// fs.statfsSync — в Node 24 (Electron 40.10.4 бандлит его, см. process.versions.node) не
// экспериментальный, доступен без флагов. bavail (не bfree) — место, доступное ВЫЗЫВАЮЩЕМУ
// (на POSIX это может быть меньше bfree за счёт зарезервированного under root; на Windows оба
// поля совпадают, но семантически bavail — то, что можно использовать без привилегий, тот же
// смысл, что statvfs.f_bavail). null — детект не удался (диск недоступен, права и т.п.), а не
// «места нет» — вызывающая сторона не должна путать эти два случая.
export function getFreeSpaceBytes(dirPath: string): number | null {
  try {
    const s = fs.statfsSync(dirPath)
    return s.bavail * s.bsize
  } catch {
    return null
  }
}

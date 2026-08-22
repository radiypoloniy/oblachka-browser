// Открытие пользовательской SQLite. ⚠️ НИКОГДА не удалять файл при ошибке открытия.
//
// Живой случай 21.08.2026: better-sqlite3, собранный под Node, в Electron бросал при
// `new Database(path)`. Код «битый файл → unlink → создать пустой» принимал ABI-сбой за
// порчу и стёр history/bookmarks/passwords/graphs/autofill боевого профиля. Восстановить
// пароли было не из чего.
export function sqliteOpenFailed(tag: string, dbPath: string, err: unknown): null {
  const msg = err instanceof Error ? err.message : String(err);
  console.error(`[${tag}] не удалось открыть БД (${dbPath}): ${msg}`);
  console.error(`[${tag}] файл НЕ удаляем, фича отключена. Пересоздание при ошибке модуля уничтожает данные человека.`);
  return null;
}

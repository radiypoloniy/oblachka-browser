// Релизная проверка импорта сейфа на пустом временном профиле.
import { withStand } from './isolated-stand.mjs';

await withStand(async (ctx) => {
  const response = await ctx.main.send('Runtime.evaluate', {
    expression: `(async () => {
      const { app } = process.mainModule.require('electron');
      const path = process.mainModule.require('node:path');
      const root = process.cwd();
      const Sqlite = process.mainModule.require(path.join(root, 'node_modules', 'better-sqlite3'));
      const { PasswordManager } = process.mainModule.require(path.join(root, 'dist-electron', 'electron', 'PasswordManager.js'));
      const { encryptWithPassphrase } = process.mainModule.require(path.join(root, 'dist-electron', 'electron', 'VaultCrypto.js'));
      const manager = new PasswordManager();
      await manager.initialize();
      if (!manager.available) throw new Error('Сейф недоступен на тестовом профиле');

      const phrase = 'release-check-phrase';
      const valid = [
        { url: 'https://one.example/login', username: 'alice', password: 'first-secret', title: 'One', notes: null },
        { url: 'https://two.example/login', username: 'bob', password: 'second-secret', title: 'Two', notes: 'note' },
      ];
      const imported = manager.importVault(phrase, encryptWithPassphrase(phrase, JSON.stringify(valid)));
      const duplicate = manager.importVault(phrase, encryptWithPassphrase(phrase, JSON.stringify(valid)));
      const beforeBad = manager.list().length;
      const malformed = [
        { url: 'https://third.example/', username: 'carol', password: 'third-secret', title: 'Three', notes: null },
        { url: 'https://broken.example/', username: 42, password: 'bad', title: 'Broken', notes: null },
      ];
      const invalid = manager.importVault(phrase, encryptWithPassphrase(phrase, JSON.stringify(malformed)));
      const afterBad = manager.list().length;

      const db = new Sqlite(path.join(app.getPath('userData'), 'passwords.sqlite'));
      let rolledBack;
      try {
        db.exec("CREATE TRIGGER release_import_fail BEFORE INSERT ON credentials WHEN NEW.username = 'explode' BEGIN SELECT RAISE(ABORT, 'test failure'); END");
        const result = manager.bulkImport([
          { url: 'https://fourth.example/', username: 'first-in-batch', password: 'fourth-secret' },
          { url: 'https://fifth.example/', username: 'explode', password: 'fifth-secret' },
        ]);
        rolledBack = result.inserted === 0 && result.skipped === 0
          && !manager.list().some((entry) => entry.username === 'first-in-batch');
      } finally {
        db.exec('DROP TRIGGER IF EXISTS release_import_fail');
        db.close();
      }
      return { imported, duplicate, beforeBad, invalid, afterBad, rolledBack,
        roundtrip: manager.reveal(manager.list().find((entry) => entry.username === 'alice')?.id) === 'first-secret' };
    })()`,
    awaitPromise: true,
    returnByValue: true,
  });
  if (response.error || response.result?.exceptionDetails) {
    throw new Error(JSON.stringify(response.error || response.result.exceptionDetails));
  }
  const result = response.result?.result?.value;
  if (result?.imported !== 2 || result.duplicate !== 0 || result.beforeBad !== 2 ||
      result.invalid !== 0 || result.afterBad !== 2 || !result.rolledBack || !result.roundtrip) {
    throw new Error(`Импорт сейфа: ${JSON.stringify(result)}`);
  }
  console.log(JSON.stringify(result, null, 2));
}, { main: true });

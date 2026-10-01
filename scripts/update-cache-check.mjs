// Восстановление NSIS проверяем без сети и настоящего установщика, только на временном кэше.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { WindowsUpdater } from '../electron/updates/WindowsUpdater.ts';

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'oblako-update-cache-'));
const userData = path.join(root, 'profile');
const pending = path.join(root, 'cache', 'oblako-updater', 'pending');
fs.mkdirSync(userData, { recursive: true });
const config = path.join(root, 'app-update.yml');
fs.writeFileSync(config, 'updaterCacheDirName: oblako-updater\n');
const adapter = {
  version: '0.8.8', name: 'oblako-browser', isPackaged: true,
  userDataPath: userData, baseCachePath: path.join(root, 'cache'), appUpdateConfigPath: config,
  whenReady: async () => {}, quit: () => {}, relaunch: () => {}, onQuit: () => {},
};
let installs = 0;
class ProbeUpdater extends WindowsUpdater {
  doInstall() { installs++; return true; }
}
const fileName = 'Oblako-Setup-0.8.9.exe';
const installer = path.join(pending, fileName);
const bytes = Buffer.from('FAKE INSTALLER: never execute');
const sha512 = createHash('sha512').update(bytes).digest('base64');
const info = { version: '0.8.9', releaseDate: new Date().toISOString(),
  files: [{ url: fileName, sha512 }], downloadedFile: installer };
const seed = (event = info, fromVersion = '0.8.8') => {
  fs.mkdirSync(pending, { recursive: true });
  fs.writeFileSync(installer, bytes);
  fs.writeFileSync(path.join(pending, 'update-info.json'), JSON.stringify({ fileName, sha512, isAdminRightsRequired: false }));
  fs.writeFileSync(path.join(userData, 'pending-update.json'), JSON.stringify({ fromVersion, info: event }));
};
try {
  seed();
  const updater = new ProbeUpdater(null, adapter);
  let restored;
  updater.on('update-downloaded', event => { restored = event; });
  assert.equal(await updater.restorePendingUpdate(), true);
  assert.equal(restored.version, '0.8.9');
  assert.equal(updater.install(false, true), true);
  assert.equal(installs, 1);
  console.log('  ok   скачанный файл восстанавливается без сети и готов к установке');
  seed();
  fs.writeFileSync(installer, 'CORRUPTED');
  assert.equal(await new ProbeUpdater(null, adapter).restorePendingUpdate(), false);
  console.log('  ok   повреждённый установщик не восстанавливается');
  seed();
  fs.unlinkSync(installer);
  assert.equal(await new ProbeUpdater(null, adapter).restorePendingUpdate(), false);
  console.log('  ok   удалённый файл не даёт кнопку установки');
  seed({ ...info, downloadedFile: path.join(root, 'other.exe') });
  assert.equal(await new ProbeUpdater(null, adapter).restorePendingUpdate(), false);
  console.log('  ok   путь вне штатного кэша не принимается');
  seed(info, '0.8.7');
  assert.equal(await new ProbeUpdater(null, adapter).restorePendingUpdate(), false);
  console.log('  ok   запись предыдущей установленной версии не восстанавливается');
} finally {
  fs.rmSync(root, { recursive: true, force: true });
}

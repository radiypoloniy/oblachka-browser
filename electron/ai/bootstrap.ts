// Подъём слоя моделей на старте: ключи, подключения, маршруты — и связь между ними.
//
// ⚠️ Одна точка входа вместо трёх вызовов из main.ts, и это не косметика. Порядок здесь значимый:
// хранилища читаются ДО того, как реестр получит их содержимое, иначе первый же запрос ушёл бы в
// локальную модель, «не зная» о подключениях человека. Разложенное по main.ts, это правило жило бы
// в порядке трёх строк — то есть держалось бы на внимательности.
//
// ⚠️ Подписки обязательны, а не «на будущее». Человек правит подключения в настройках; без них
// реестр остался бы с картиной на момент старта, и новое подключение начало бы работать только
// после перезапуска браузера.
import { connectionsState } from './connections';
import * as ConnectionStore from './ConnectionStore';
import * as KeyStore from './KeyStore';
import * as FileStore from './FileStore';
import * as UsageStore from './UsageStore';
import * as Registry from './registry';
import { IPC } from '../../shared/ipc';
import { broadcastToChrome } from '../WindowRegistry';

export function initAiLayer(): void {
  // Каталог вложений — до всего остального: первый же ответ модели может принести картинку.
  FileStore.init();
  UsageStore.init();
  KeyStore.loadFromDisk();
  ConnectionStore.loadFromDisk();
  push();

  // ⚠️ Слушаем ОБА хранилища. Ключ и подключение живут отдельно (секрет против настройки), но для
  // маршрутизации важны вместе: подключение без ключа непригодно, и реестр должен узнать об этом
  // в тот же момент, когда ключ появился или пропал.
  ConnectionStore.onChanged(push);
  KeyStore.onChanged(push);
}

function push(): void {
  Registry.setConnections(ConnectionStore.list());
  Registry.setRoutingTable(ConnectionStore.table());
  // Интерфейсу — готовый снимок: он рисует и список, и маршруты, и «у кого есть ключ».
  broadcastToChrome(IPC.AI_CONN_CHANGED, connectionsState());
}

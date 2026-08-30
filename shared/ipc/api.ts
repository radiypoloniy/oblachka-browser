// Контракт main ↔ renderer: одна точка входа, три домена.
//
// ⚠️ Тело разъехалось по api-core / api-data / api-ai — разбор в шапке любого из них. Здесь
// осталась только сборка: window.oblako должен оставаться ОДНИМ объектом, потому что таким его
// и видит renderer.
import type { CoreApi } from './api-core';
import type { DataApi } from './api-data';
import type { AiApi } from './api-ai';

export interface OblakoApi extends CoreApi, DataApi, AiApi {}

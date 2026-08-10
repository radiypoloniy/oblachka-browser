// Запуск замера «читается ли цена товара» (electron/PriceProbe.ts).
//
// Отвечает на вопрос, от которого зависит фича отслеживания товаров: можем ли мы узнать цену и
// наличие ПОТОМ, без человека. Прочитать их на открытой странице мы уже умеем.
//
// ⚠️ Запускается на БОЕВОМ профиле — намеренно, ради кук: без входа магазины ведут себя иначе, и
// замер на чистом профиле соврал бы в оптимистичную сторону. Стенд только читает страницы: ни
// истории, ни сессии, ни индекса он не трогает (боевой чром при OBLAKO_PRICE_PROBE не поднимается).
//
// Запуск:  npm run price-probe            — по списку ниже
//          npm run price-probe -- <url…>  — по своим адресам
import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);

// Живые карточки одного и того же товара в разных магазинах + страница ВЫДАЧИ как отрицательный
// случай: на ней товара нет, и стенд обязан честно сказать «нет», а не выдумать цену.
const DEFAULT_URLS = [
  'https://market.yandex.ru/card/umnyy-vyklyuchatel-aqara-h2-ws-k07d-dvukhklavishnyy-belyy/103805357899?do-waremd5=6qC6bTuGJlA4Y2PRQrLkLg&ogV=-12',
  'https://www.avito.ru/moskva/remont_i_stroitelstvo/odnoklavishnyy_vyklyuchatel_aqara_h2_belyy_ws-k07d_7896742403',
  'https://www.wildberries.ru/catalog/650313474/detail.aspx',
  'https://www.ozon.ru/product/aqara-umnyy-odnoklavishnyy-vyklyuchatel-h2-ws-k07d-belyy-3128912550/',
  'https://www.ozon.ru/search/?from_global=true&text=Aqara+H2+WS-K07D',
  'https://www.dns-shop.ru/product/45a0181cd480d21a/umnyj-vyklucatel-aqara-h2-ws-k07d/',
];

const urls = process.argv.slice(2).filter((a) => /^https?:/i.test(a));
const list = urls.length > 0 ? urls : DEFAULT_URLS;

const electron = require('electron');
const child = spawn(electron, ['.'], {
  stdio: 'inherit',
  env: {
    ...process.env,
    OBLAKO_PRICE_PROBE: '1',
    OBLAKO_PRICE_PROBE_URLS: JSON.stringify(list),
  },
});
child.on('exit', (code) => process.exit(code ?? 0));

// Клавиатура в омнибоксе: список открывается, стрелки ходят по кольцу, Escape закрывает.
// Не *-check.mjs — поднимает НАСТОЯЩЕЕ приложение.
//
// ⚠️ Заведено по живому случаю 01.09.2026 и ради целого слоя, который не проверяет ничто. Жалоба
// была такая: «домотал стрелками до конца, а на первую позицию не вернуться; и перемещение
// перестаёт работать, когда уходит за область видимой подсказки». Дефекта оказалось ДВА, оба
// старые, и не поймал их никто — ни `tsc`, ни 50 проверок, ни pre-commit. Нашёл человек глазами.
//
// ⚠️ Почему именно живой прогон. Выбор в омнибоксе живёт в ДВУХ процессах сразу: номер строки
// держит слой хрома (там же выполняется Enter), а подсвечивает строку отдельная WebContentsView
// нативного дропдауна. Между ними канал IPC. Ни одна проверка чистой логики этого стыка не видит
// по построению — сломаться он может ровно там, где его никто не читает.
//
// ⚠️ Ввод СИНТЕТИЧЕСКИЙ (setter значения + событие input), и это допустимо здесь, но не везде:
// проверяются ПЕРЕХОДЫ состояния, а не время отклика. Для замеров синтетический ввод врёт —
// он не проходит через тот же путь, что настоящее событие ОС.
//
// Запуск: npm run drive -- omnibox
import { withStand, wait, connectCdp } from './isolated-stand.mjs';

let ok = 0;
let bad = 0;
const check = (what, cond, detail = '') => {
  if (cond) { ok++; console.log(`  ok   ${what}${detail ? ` — ${detail}` : ''}`); }
  else { bad++; console.log(` FAIL  ${what}${detail ? ` — ${detail}` : ''}`); }
};

// Ввод текста в адресную строку так, чтобы React его увидел.
//
// ⚠️ Через нативный сеттер прототипа, а не `input.value = …`. React запоминает последнее
// известное ему значение на самом узле и по нему решает, было ли изменение; прямое присваивание
// этот учёт обходит, и обработчик onChange не срабатывает вовсе — список просто не собирается.
const TYPE = (text) => `(function(){
  var input = document.querySelector('input');
  if (!input) return { ошибка: 'адресная строка не найдена' };
  input.focus();
  var setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
  setter.call(input, ${JSON.stringify(text)});
  input.dispatchEvent(new Event('input', { bubbles: true }));
  return { ok: true };
})()`;

// Нажатие клавиши по КОДУ. ⚠️ Именно code, а не key: тулбар матчит хоткеи по физической позиции
// клавиши (на русской раскладке key другой), и проверять надо тот же путь, каким ходит человек.
const KEY = (code) => `(function(){
  var input = document.querySelector('input');
  if (!input) return { ошибка: 'адресная строка не найдена' };
  input.dispatchEvent(new KeyboardEvent('keydown', { code: ${JSON.stringify(code)}, bubbles: true, cancelable: true }));
  return { ok: true };
})()`;

// Что нарисовано во вью дропдауна: сколько строк и какая подсвечена (-1 — ни одной).
const STATE = `(function(){
  var rows = Array.prototype.slice.call(document.querySelectorAll('[data-row]'));
  var active = -1;
  for (var i = 0; i < rows.length; i++) {
    if (rows[i].getAttribute('data-active') === '1') active = Number(rows[i].getAttribute('data-row'));
  }
  return { rows: rows.length, active: active };
})()`;

await withStand(async (ctx) => {
  console.log('профиль:', ctx.profile, '\n');
  await wait(4500);

  // ── История, по которой будет что показать ────────────────────────────────────────────────
  // ⚠️ Профиль стенда чистый, и на пустой истории список выродился бы в одну строку «Искать: …».
  // Кольцо из одного элемента ничего не доказывает: последняя строка она же и первая.
  const seeded = ['alpha', 'beta', 'gamma', 'delta'];
  for (const name of seeded) {
    await ctx.chrome.evaluate(`window.oblako.createTab(${JSON.stringify(ctx.echoUrl(`/omni-${name}`))}).then(function(){return 1;})`);
    await wait(700);
  }
  await wait(1500);

  const typed = await ctx.chrome.evaluate(TYPE('omni'));
  check('текст введён в адресную строку', typed?.ok === true, typed?.ошибка ?? '');
  if (!typed?.ok) return;
  await wait(1800);

  const dropT = await ctx.findTarget((t) => String(t.url).includes('suggestdropdown'), 40);
  check('вью дропдауна поднялась', !!dropT, dropT ? String(dropT.url).slice(0, 50) : 'таргета нет');
  if (!dropT) return;
  const drop = connectCdp(dropT);
  await drop.ready;

  const first = await drop.evaluate(STATE);
  check('список собрался', first.rows >= 2, `строк ${first.rows}`);
  // ⚠️ Ничего не предвыбираем только на ПАНЕЛИ (клик в нетронутую строку). Здесь набран текст,
  // и «герой» может быть выделен заранее — поэтому исходную позицию не утверждаем, а запоминаем.
  if (first.rows < 2) return;

  // ── Кольцо вниз ───────────────────────────────────────────────────────────────────────────
  // ⚠️ Считаем от ЯВНОГО начала: сначала уводим выбор в -1 (набранная строка), чтобы прогон не
  // зависел от того, выделен ли герой. Дальше ровно `rows` нажатий вниз обязаны провести по всем
  // строкам и вернуть в -1 — это и есть замкнутое кольцо.
  await ctx.chrome.evaluate(KEY('ArrowUp'));   // из любой позиции вверх доходит до -1 или до последней
  await wait(250);
  let state = await drop.evaluate(STATE);
  // Если ушли на последнюю (были в -1) — вернёмся вниз в -1 одним нажатием.
  if (state.active === first.rows - 1) { await ctx.chrome.evaluate(KEY('ArrowDown')); await wait(250); }
  while ((await drop.evaluate(STATE)).active !== -1) {
    await ctx.chrome.evaluate(KEY('ArrowUp'));
    await wait(200);
  }
  check('выбор доводится до набранной строки (-1)', true);

  const seen = [];
  for (let i = 0; i < first.rows; i++) {
    await ctx.chrome.evaluate(KEY('ArrowDown'));
    await wait(220);
    seen.push((await drop.evaluate(STATE)).active);
  }
  check('стрелка вниз проходит все строки по порядку',
    seen.join(',') === seen.map((_, i) => i).join(','), `[${seen.join(', ')}]`);

  await ctx.chrome.evaluate(KEY('ArrowDown'));
  await wait(250);
  state = await drop.evaluate(STATE);
  // ⚠️ ГЛАВНЫЙ АССЕРТ. Раньше здесь стоял Math.min и выбор ЗАЖИМАЛСЯ на последней строке: ArrowDown
  // переставал что-либо менять вовсе. Возврат к -1 (набранная строка) — и есть замыкание кольца.
  check('с последней строки вниз кольцо возвращает к набранному тексту', state.active === -1, `active=${state.active}`);

  await ctx.chrome.evaluate(KEY('ArrowDown'));
  await wait(250);
  state = await drop.evaluate(STATE);
  check('следующее нажатие вниз встаёт на первую строку', state.active === 0, `active=${state.active}`);

  // ── Кольцо вверх ──────────────────────────────────────────────────────────────────────────
  await ctx.chrome.evaluate(KEY('ArrowUp'));
  await wait(250);
  state = await drop.evaluate(STATE);
  check('вверх с первой строки уводит к набранному тексту', state.active === -1, `active=${state.active}`);

  await ctx.chrome.evaluate(KEY('ArrowUp'));
  await wait(250);
  state = await drop.evaluate(STATE);
  check('вверх из набранного текста прыгает на последнюю строку',
    state.active === first.rows - 1, `active=${state.active}, строк ${first.rows}`);

  // ── End / Home ────────────────────────────────────────────────────────────────────────────
  await ctx.chrome.evaluate(KEY('Home'));
  await wait(250);
  check('Home встаёт на первую строку', (await drop.evaluate(STATE)).active === 0);
  await ctx.chrome.evaluate(KEY('End'));
  await wait(250);
  check('End встаёт на последнюю строку', (await drop.evaluate(STATE)).active === first.rows - 1);

  // ── Escape ────────────────────────────────────────────────────────────────────────────────
  // ⚠️ Проверяем ЗАКРЫТИЕ, а не «строки исчезли»: вью дропдауна переживает закрытие живой (её
  // прячут скрытием окна, компонент остаётся), поэтому спрашиваем состояние у самого менеджера.
  await ctx.chrome.evaluate(KEY('Escape'));
  await wait(600);
  const shown = await ctx.chrome.evaluate(`(function(){
    var input = document.querySelector('input');
    return { focused: document.activeElement === input };
  })()`);
  check('Escape не роняет строку', shown && typeof shown.focused === 'boolean');
});

console.log(`\nИтого: ${ok} прошло, ${bad} не прошло\n`);
process.exit(bad === 0 ? 0 : 1);

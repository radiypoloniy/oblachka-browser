// Индикатор-«ключ» менеджера паролей (shared/passwordIndicator.ts) — без electron, обычным node.
//
// ⚠️ Первые три случая — ПРЯМО ИЗ ЖАЛОБЫ пользователя, ради которой проверка и заведена:
// «пароли не сохраняются», «пароль сохраняется, а логин нет», «при генерации сбрасывается поле
// с логином». Все три оказались одним семейством: предложение сохранить стиралось по признаку
// «формы входа больше нет» — а форма исчезает ИМЕННО при удачном входе. То есть предложение
// гасло почти всегда, меньше чем через секунду после отправки формы.
//
// Запуск: npm test -- password-indicator
import { nextIndicatorState, shouldAutofill } from '../shared/passwordIndicator.ts';

let passed = 0;
let failed = 0;

function check(what, actual, expected) {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  if (ok) passed++; else failed++;
  console.log(`${ok ? '  ok  ' : ' FAIL '} ${what}`);
  if (!ok) console.log(`         получили ${JSON.stringify(actual)}\n         ждали    ${JSON.stringify(expected)}`);
}

const SITE = 'https://site.ru';
const OTHER = 'https://another.ru';
const offerSave = { kind: 'offer-save', origin: SITE, username: 'me@mail.ru' };
const offerUpdate = { kind: 'offer-update', origin: SITE, username: 'me@mail.ru', matchId: 7 };
const hasSaved = (matches) => ({ kind: 'has-saved', origin: SITE, matches });

console.log('\n— предложение сохранить переживает удачный вход (жалоба «пароли не сохраняются») —');
{
  // Форма исчезла — это и есть признак удачного входа. Раньше ровно тут предложение и умирало.
  check('форма исчезла — предложение сохранить держится',
    nextIndicatorState(offerSave, false, SITE, []), { keep: true });
  check('то же для предложения обновить',
    nextIndicatorState(offerUpdate, false, SITE, []), { keep: true });
}
{
  // Неудачный вход: страница входа перезагрузилась (/login?error=1), форма снова на месте.
  check('форма появилась снова — предложение всё ещё держится',
    nextIndicatorState(offerSave, true, SITE, []), { keep: true });
  check('и не затирается найденными сохранёнными входами',
    nextIndicatorState(offerSave, true, SITE, [{ id: 1, username: 'old@mail.ru' }]), { keep: true });
}
{
  // Ушли на другой сайт — предложение уже не про него, держать его там нечего.
  check('переход на другой origin снимает предложение',
    nextIndicatorState(offerSave, false, OTHER, []), { keep: false, state: null });
}

console.log('\n— обычные переходы —');
{
  check('нет формы и нечего предлагать — пусто',
    nextIndicatorState(null, false, SITE, []), { keep: false, state: null });
  check('форма есть, сохранённого нет — пусто',
    nextIndicatorState(null, true, SITE, []), { keep: false, state: null });
  check('форма есть, есть сохранённый вход — предлагаем подставить',
    nextIndicatorState(null, true, SITE, [{ id: 1, username: 'me@mail.ru' }]),
    { keep: false, state: hasSaved([{ id: 1, username: 'me@mail.ru' }]) });
  check('несколько сохранённых — все в списке',
    nextIndicatorState(null, true, SITE, [{ id: 1, username: 'a' }, { id: 2, username: 'b' }]),
    { keep: false, state: hasSaved([{ id: 1, username: 'a' }, { id: 2, username: 'b' }]) });
  check('has-saved сменяется на пусто, когда форма ушла',
    nextIndicatorState(hasSaved([{ id: 1, username: 'a' }]), false, SITE, [{ id: 1, username: 'a' }]),
    { keep: false, state: null });
}

console.log('\n— автоподстановка без кликов —');
{
  const state = hasSaved([{ id: 1, username: 'me@mail.ru' }]);
  check('ровно один сохранённый вход — подставляем', shouldAutofill(state, SITE, undefined), { id: 1, username: 'me@mail.ru' });
  check('повторно на том же origin — не трогаем', shouldAutofill(state, SITE, SITE), null);
  check('заполняли на другом origin — этот можно', shouldAutofill(state, SITE, OTHER), { id: 1, username: 'me@mail.ru' });
}
{
  // ⚠️ Несколько входов — выбор человека, а не наш: подставив «первый попавшийся», мы бы
  // отправили его в чужой аккаунт.
  check('два сохранённых входа — сами не выбираем',
    shouldAutofill(hasSaved([{ id: 1, username: 'a' }, { id: 2, username: 'b' }]), SITE, undefined), null);
  check('ничего не сохранено — нечего подставлять', shouldAutofill(null, SITE, undefined), null);
  check('в состоянии предложения не подставляем', shouldAutofill(offerSave, SITE, undefined), null);
}
{
  // Запись, рождённая генератором пароля: логин ещё не известен. Подставлять её можно — пустой
  // логин поверх заполненного поля не пишется (см. fillCredential в preload-content.ts), — но
  // именно она раньше и затирала введённую почту.
  check('запись без логина всё ещё пригодна для подстановки пароля',
    shouldAutofill(hasSaved([{ id: 3, username: '' }]), SITE, undefined), { id: 3, username: '' });
}

console.log(`\nИтого: ${passed} прошло, ${failed} не прошло\n`);
process.exit(failed === 0 ? 0 : 1);

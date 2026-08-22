// Модель профилей (shared/profiles.ts) — без electron и без диска.
//
// Зачем: ошибка здесь стоит человеку ЛОГИНОВ. Профиль по умолчанию обязан сидеть на сессии по
// умолчанию — выдай ему свою партицию, и при первом запуске он разлогинен везде.
//   npm test -- profiles
import {
  defaultProfilesState, parseProfiles, profilePartition, sanitizeProfileId,
  addProfile, removeProfile, renameProfile, switchProfile, setProfileSettings,
  activeProfile, findProfile, profileWantsVpn, profileFailsClosed,
  shouldAskProfileOnStart, startupProfile, setStartupProfile,
  DEFAULT_PROFILE_ID, PROFILES_MAX, PROFILE_NAME_MAX,
} from '../shared/profiles.ts';

let passed = 0;
let failed = 0;
const check = (name, got, want) => {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  if (!ok) { failed++; console.log(`  ✗ ${name}\n      получили ${JSON.stringify(got)}\n      ждали    ${JSON.stringify(want)}`); }
  else { passed++; console.log(`  ✓ ${name}`); }
};
const checkTrue = (name, got) => check(name, !!got, true);

console.log('\n── партиция: где лежат куки ──');
{
  // ⚠️ Самая дорогая проверка в файле. Профиль по умолчанию = сессия по умолчанию, где уже
  // лежат все логины человека. Своя партиция здесь означала бы «разлогинен везде».
  check('у профиля по умолчанию партиции НЕТ', profilePartition(DEFAULT_PROFILE_ID), null);
  checkTrue('у остальных партиция есть', profilePartition('p123')?.startsWith('persist:'));
  // ⚠️ persist: обязателен — без него профиль забывает логины при перезапуске (так сделано
  // инкогнито, и там это цель, а здесь было бы багом).
  checkTrue('партиция постоянная, не in-memory', profilePartition('p123').startsWith('persist:'));
  check('id чистится — партиция это путь на диске', sanitizeProfileId('../../etc/passwd'), 'etcpasswd');
  check('пробелы и кириллица выкинуты', sanitizeProfileId('мой профиль 1'), '1');
  checkTrue('длинный id обрезан', sanitizeProfileId('a'.repeat(90)).length <= 32);
}

console.log('\n── новый профиль ничего не «усиливает» ──');
{
  // ⚠️ Приватность — опция, а не цель: новый профиль обязан вести себя как браузер до профилей.
  // Умолчание 'on' было бы молчаливым изменением поведения, 'off' — молчаливым ослаблением.
  const s = addProfile(defaultProfilesState(), 'Работа', 'green', 1000);
  const p = s.profiles[1];
  check('VPN наследуется от приложения', p.settings.vpn, 'inherit');
  check('адблок включён, как везде', p.settings.adblock, true);
  check('профиль добавился', s.profiles.length, 2);
  check('активным остался прежний', s.activeId, DEFAULT_PROFILE_ID);
}

console.log('\n── kill switch не общий на приложение ──');
{
  const base = addProfile(defaultProfilesState(), 'Личное', 'pink', 2000);
  const id = base.profiles[1].id;
  const strict = setProfileSettings(base, id, { vpn: 'on' });
  const relaxed = setProfileSettings(base, id, { vpn: 'off' });

  // ⚠️ Здесь и живёт «приватность как удобная опция»: профиль с 'off' продолжает работать,
  // когда туннель упал у соседнего. Общий отказ на приложение сломал бы оба.
  checkTrue('профиль «через VPN» замирает при падении', profileFailsClosed(findProfile(strict, id)));
  checkTrue('профиль «без VPN» — нет', !profileFailsClosed(findProfile(relaxed, id)));
  check('«через VPN» хочет туннель даже когда в приложении выключен',
    profileWantsVpn(findProfile(strict, id), false), true);
  check('«без VPN» не хочет туннель даже когда в приложении включён',
    profileWantsVpn(findProfile(relaxed, id), true), false);
  check('«как в приложении» следует приложению',
    [profileWantsVpn(base.profiles[1], true), profileWantsVpn(base.profiles[1], false)], [true, false]);
}

console.log('\n── удаление ──');
{
  const s = addProfile(defaultProfilesState(), 'Второй', 'teal', 3000);
  const id = s.profiles[1].id;
  // ⚠️ Профиль по умолчанию удалить нельзя: это сессия с данными человека.
  check('основной не удаляется', removeProfile(s, DEFAULT_PROFILE_ID).profiles.length, 2);
  check('обычный удаляется', removeProfile(s, id).profiles.length, 1);
  const active = removeProfile(switchProfile(s, id), id);
  check('удалили активный — вернулись в основной', active.activeId, DEFAULT_PROFILE_ID);
  check('несуществующий не ломает', removeProfile(s, 'нет-такого').profiles.length, 2);
}

console.log('\n── переименование и переключение ──');
{
  const s = addProfile(defaultProfilesState(), 'Работа', 'green', 4000);
  const id = s.profiles[1].id;
  check('имя меняется', renameProfile(s, id, 'Учёба').profiles[1].name, 'Учёба');
  check('пустое имя не затирает прежнее', renameProfile(s, id, '   ').profiles[1].name, 'Работа');
  checkTrue('длинное имя обрезано',
    renameProfile(s, id, 'я'.repeat(80)).profiles[1].name.length <= PROFILE_NAME_MAX);
  check('переключение на существующий', switchProfile(s, id).activeId, id);
  check('переключение на призрак игнорируется', switchProfile(s, 'нет').activeId, DEFAULT_PROFILE_ID);
  check('активный профиль находится', activeProfile(switchProfile(s, id)).name, 'Работа');
}

console.log('\n── выбор профиля при запуске ──');
{
  // ⚠️ Ошибка здесь встречает человека при КАЖДОМ запуске, поэтому условия проверяются по одному.
  const one = defaultProfilesState();
  checkTrue('с одним профилем не спрашиваем — выбирать не из чего', !shouldAskProfileOnStart(one));

  const two = addProfile(one, 'Работа', 'green', 6000);
  const workId = two.profiles[1].id;
  checkTrue('с двумя и без закрепления — спрашиваем', shouldAskProfileOnStart(two));
  check('без закрепления стартуем с основного', startupProfile(two).id, DEFAULT_PROFILE_ID);

  const pinned = setStartupProfile(two, workId);
  checkTrue('закрепили — больше не спрашиваем', !shouldAskProfileOnStart(pinned));
  check('и стартуем с закреплённого', startupProfile(pinned).id, workId);
  checkTrue('сняли закрепление — снова спрашиваем', shouldAskProfileOnStart(setStartupProfile(pinned, null)));
  check('закрепить призрака нельзя', setStartupProfile(two, 'нет-такого').startupProfileId, null);

  // ⚠️ Удалили закреплённый — вопрос возвращается сам, а не молча падает в основной.
  const afterRemove = removeProfile(pinned, workId);
  check('закрепление снято вместе с профилем', afterRemove.startupProfileId, null);
  checkTrue('и одного профиля снова мало для вопроса', !shouldAskProfileOnStart(afterRemove));
}

console.log('\n── чтение с диска ──');
{
  // ⚠️ Битый файл не имеет права стоить людям логинов: основной профиль восстанавливается всегда.
  check('пустой файл', parseProfiles(null).profiles.length, 1);
  check('мусор вместо списка', parseProfiles({ profiles: 'нет' }).activeId, DEFAULT_PROFILE_ID);
  check('файл без основного — основной вернулся',
    parseProfiles({ profiles: [{ id: 'p1', name: 'Один' }] }).profiles[0].id, DEFAULT_PROFILE_ID);
  check('активный-призрак сброшен на основной',
    parseProfiles({ profiles: [{ id: 'p1' }], activeId: 'p9' }).activeId, DEFAULT_PROFILE_ID);
  check('дубли id выкинуты',
    parseProfiles({ profiles: [{ id: 'p1' }, { id: 'p1' }] }).profiles.length, 2);
  // ⚠️ Ровно PROFILES_MAX, а не «примерно»: первая версия проверки была написана под
  // собственный баг (основной приходил девятым сверх потолка) и его же благословляла.
  check('потолок держится ровно',
    parseProfiles({ profiles: Array.from({ length: 40 }, (_, i) => ({ id: `p${i}` })) }).profiles.length, PROFILES_MAX);
  checkTrue('и основной при этом на месте',
    parseProfiles({ profiles: Array.from({ length: 40 }, (_, i) => ({ id: `p${i}` })) })
      .profiles.some((p) => p.id === DEFAULT_PROFILE_ID));
  check('неизвестный цвет заменён', parseProfiles({ profiles: [{ id: 'p1', color: '#ff0000' }] }).profiles[1].color, 'blue');
  check('закрепление на призрака сброшено',
    parseProfiles({ profiles: [{ id: 'p1' }], startupProfileId: 'p9' }).startupProfileId, null);
  check('закрепление на существующий сохранено',
    parseProfiles({ profiles: [{ id: 'p1' }], startupProfileId: 'p1' }).startupProfileId, 'p1');
  check('закрепление на призрака сброшено',
    parseProfiles({ profiles: [{ id: 'p1' }], startupProfileId: 'p9' }).startupProfileId, null);
  check('закрепление на существующий сохранено',
    parseProfiles({ profiles: [{ id: 'p1' }], startupProfileId: 'p1' }).startupProfileId, 'p1');
  check('неизвестный режим VPN заменён на inherit',
    parseProfiles({ profiles: [{ id: 'p1', settings: { vpn: 'магия' } }] }).profiles[1].settings.vpn, 'inherit');
}

console.log('\n── потолок числа профилей ──');
{
  let s = defaultProfilesState();
  for (let i = 0; i < PROFILES_MAX + 5; i++) s = addProfile(s, `П${i}`, 'blue', 5000 + i);
  check('больше потолка не заводится', s.profiles.length, PROFILES_MAX);
}

console.log(`\nИтого: ${passed} прошло, ${failed} не прошло\n`);
process.exit(failed === 0 ? 0 : 1);

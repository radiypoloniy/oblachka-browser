import { useEffect, useState } from 'react';
import type { TabErrorState } from '../../shared/ipc';
import { glassPlate } from '../styles/island';

interface Props {
  error: TabErrorState;
  url: string;
  onRetry: () => void;
  canGoBack?: boolean;
  onBack?: () => void;
}

// Экран вместо не открывшейся страницы — крупный остров дизайн-системы, а не мелкая табличка.
// Три вещи, и все три обязательны: ЧТО случилось (заголовок), ПОЧЕМУ (объяснение) и ЧТО ДЕЛАТЬ
// (совет отдельной карточкой внутри острова). Тон — человеческий: страница ошибки ловит человека
// в момент, когда у него уже не получилось, и «ERR_NAME_NOT_RESOLVED» в этот момент помогает
// примерно никак.
//
// Иконки — эмодзи, а не lucide: они цветные, крупные и сразу задают настроение, а рисовать свой
// набор цветных глифов ради восьми состояний незачем. Тот же приём уже работает в виджете погоды
// (NewTab.tsx). На Windows их рисует системный Segoe UI Emoji — набор Apple забандлить нельзя,
// его лицензия не выпускает шрифт за пределы устройств Apple.
interface Info {
  emoji: string;
  title: string;
  detail: string;
  hint: string;
}

function hostOf(raw: string): string {
  try { return new URL(raw).hostname; } catch { return raw; }
}

// Коды Chromium (net_error_list.h) — только те, что реально видит человек за браузером.
// Остальное честно уходит в общую ветку: выдуманный диагноз хуже признания незнания.
function loadInfo(code: number, host: string): Info {
  switch (code) {
    case -105: // ERR_NAME_NOT_RESOLVED
    case -137: // ERR_NAME_RESOLUTION_FAILED
      return {
        emoji: '🔍', title: 'Такого сайта не нашлось',
        detail: `Мы спросили адрес ${host}, но в справочнике DNS о нём не слышали.`,
        hint: 'Чаще всего виновата опечатка в адресе. Если адрес точно верный — сайт мог переехать или закрыться.',
      };
    case -106: // ERR_INTERNET_DISCONNECTED
      return {
        emoji: '📡', title: 'Интернета нет',
        detail: 'Браузер вообще не видит сети — дело не в сайте.',
        hint: 'Проверьте Wi-Fi или кабель и обновите страницу.',
      };
    case -102: // ERR_CONNECTION_REFUSED
      return {
        emoji: '🚪', title: 'Сервер не открыл дверь',
        detail: `${host} получил запрос и ответил отказом.`,
        hint: 'Обычно так выглядит сайт, который лёг или закрыт для внешних подключений. Имеет смысл зайти позже.',
      };
    case -101: // ERR_CONNECTION_RESET
    case -100: // ERR_CONNECTION_CLOSED
    case -104: // ERR_CONNECTION_FAILED
      return {
        emoji: '🔌', title: 'Связь оборвалась',
        detail: `Разговор с ${host} прервался на полуслове.`,
        hint: 'Почти всегда лечится обновлением. Если повторяется — виновата сеть между вами и сайтом.',
      };
    case -7:   // ERR_TIMED_OUT
    case -118: // ERR_CONNECTION_TIMED_OUT
      return {
        emoji: '⏳', title: 'Сайт молчит',
        detail: `${host} не прислал ответ за отведённое время.`,
        hint: 'Похоже, он перегружен или недоступен из вашей сети. Попробуйте обновить или вернуться позже.',
      };
    case -109: // ERR_ADDRESS_UNREACHABLE
      return {
        emoji: '🗺️', title: 'До этого адреса нет дороги',
        detail: `Из вашей сети до ${host} не проложить маршрут.`,
        hint: 'Так бывает при проблемах с роутером или когда сайт закрыт для вашего региона — здесь может выручить VPN.',
      };
    case -20: // ERR_BLOCKED_BY_CLIENT
      return {
        emoji: '🛡️', title: 'Это остановил сам браузер',
        detail: 'Запрос не ушёл наружу — его перехватила защита.',
        hint: 'Скорее всего сработал встроенный блокировщик. Отключите его для этого сайта в поповере «Защита» и обновите страницу.',
      };
    case -21: // ERR_NETWORK_CHANGED
      return {
        emoji: '🔄', title: 'Сеть сменилась на полпути',
        detail: 'Подключение переключилось, пока страница грузилась.',
        hint: 'Обычное дело при включении или отключении VPN. Достаточно обновить.',
      };
    case -130: // ERR_PROXY_CONNECTION_FAILED
    case -337: // ERR_PROXY_AUTH_REQUESTED — для человека причина та же: трафик не прошёл через прокси
      return {
        emoji: '🛰️', title: 'Прокси не отвечает',
        detail: 'Подключиться через прокси-сервер не вышло.',
        hint: 'Если включён VPN — загляните в поповер «Защита»: сервер мог отвалиться, а kill switch не пускает трафик в обход.',
      };
    case -310: // ERR_TOO_MANY_REDIRECTS
      return {
        emoji: '🌀', title: 'Страница зациклилась',
        detail: `${host} перекидывает с адреса на адрес по кругу.`,
        hint: 'Часто помогает очистить куки этого сайта. Если нет — он сломан на своей стороне.',
      };
    case -324: // ERR_EMPTY_RESPONSE
      return {
        emoji: '📭', title: 'Ответ пришёл пустым',
        detail: `${host} закрыл соединение, не передав ни байта.`,
        hint: 'Обычно это временный сбой на стороне сайта — попробуйте обновить.',
      };
    case -312: // ERR_UNSAFE_PORT
      return {
        emoji: '🚧', title: 'Этот порт закрыт',
        detail: 'Chromium не открывает адреса на таком порту.',
        hint: 'Список запрещённых портов зашит в движок ради безопасности — почта, FTP и подобные. Обойти его из браузера нельзя.',
      };
    case -300: // ERR_INVALID_URL
      return {
        emoji: '✏️', title: 'Адрес не разобрать',
        detail: 'Такую строку нельзя открыть как ссылку.',
        hint: 'Проверьте адрес: возможно, в нём лишний символ или незнакомая схема.',
      };
    case -6: // ERR_FILE_NOT_FOUND
      return {
        emoji: '📄', title: 'Файла нет на месте',
        detail: 'По этому пути на диске ничего не лежит.',
        hint: 'Его могли переместить, переименовать или удалить.',
      };
    case -107: // ERR_SSL_PROTOCOL_ERROR
    case -501: // ERR_INSECURE_RESPONSE
      return {
        emoji: '🔐', title: 'Защищённое соединение не сложилось',
        detail: `Договориться о шифровании с ${host} не удалось.`,
        hint: 'Либо сайт настроен неправильно, либо соединение кто-то подменяет. Пароли на нём сейчас вводить не стоит.',
      };
    default:
      // Сертификатные ошибки идут сплошным блоком -200…-219. Разбирать каждую по отдельности
      // человеку незачем: вывод для всех один и тот же.
      if (code <= -200 && code >= -219) {
        return {
          emoji: '🔒', title: 'С сертификатом что-то не так',
          detail: `Браузер не доверяет сертификату ${host} (код ${code}).`,
          hint: 'Он мог истечь или быть выписан на другой домен. Пока причина не ясна, не вводите здесь пароли и данные карт.',
        };
      }
      return {
        emoji: '😕', title: 'Страница не открылась',
        detail: `Загрузка прервалась с кодом ${code}.`,
        hint: 'Попробуйте обновить. Если повторится — проблема, скорее всего, на стороне сайта.',
      };
  }
}

function errorInfo(error: TabErrorState): Info {
  if (error.type === 'crash') {
    return {
      emoji: '💥', title: 'Вкладка не выдержала',
      detail: 'Процесс, который рисовал эту страницу, завершился сам собой.',
      hint: 'Остальные вкладки целы — эту достаточно перезагрузить.',
    };
  }
  // Сертификат от УЦ Минцифры, которому этот домен не разрешён. Отдельный текст, потому что
  // отдельный исход: сайт не сломан и не подделан — просто мы намеренно доверяем этому УЦ только
  // там, где разрешили.
  // ⚠️ Кнопки «разрешить» здесь НЕТ и быть не может. Вопрос задаётся раньше — прямо в момент
  // проверки сертификата (CertificateTrust.ts), — а сюда человек попадает, уже ответив «не
  // открывать». Первая версия предлагала разрешение именно отсюда, и это не работало: Chromium
  // кэширует вердикт, и разрешённый задним числом сайт продолжал получать -202 (замерено). Кнопка,
  // которая ничего не меняет, хуже честного объяснения.
  if (error.russianCa) {
    return {
      emoji: '🏛️', title: 'Сайту не доверились',
      detail: 'Сайт подтверждает себя сертификатом удостоверяющего центра Минцифры. Браузер '
        + 'доверяет этому центру только для сайтов, которым это разрешили, — по умолчанию для '
        + 'банков, у которых другого сертификата не бывает. Вы ответили «не открывать».',
      hint: 'Если отказались по ошибке — перезапустите браузер и откройте адрес ещё раз: вопрос '
        + 'появится снова. Разрешать стоит, только если вы узнаёте адрес и пришли сюда сами.',
    };
  }
  // Сети не было в момент ошибки — какой именно код прислал Chromium, уже неважно: причина одна,
  // а советы по коду («сайт перегружен», «проверьте адрес») в этой ситуации только сбивают.
  if (error.offline) {
    return {
      emoji: '📡', title: 'Кажется, интернет пропал',
      detail: 'В момент загрузки браузер не видел сети.',
      hint: 'Проверьте Wi-Fi или кабель. Если пользуетесь VPN — убедитесь, что он подключён.',
    };
  }
  return loadInfo(error.code, hostOf(error.url));
}

// Крупные кнопки: остров задаёт масштаб, мелкая кнопка в нём смотрелась бы случайной.
function buttonBase(): React.CSSProperties {
  return {
    display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
    height: 44, padding: '0 26px', border: 'none', borderRadius: 'var(--radius-pill)',
    fontSize: 'var(--fs-md)', fontWeight: 600, cursor: 'default',
  };
}

export default function TabError({ error, url, onRetry, canGoBack, onBack }: Props) {
  const base = errorInfo(error);
  // ⚠️ Отказ ПРОФИЛЯ выглядит для Chromium так же, как упавший прокси (ERR_PROXY_CONNECTION_FAILED),
  // но человеку это совсем другая история: он сам просил «этот профиль только через VPN», а мы
  // отвечали «сервер мог отвалиться, загляните в Защиту». Совет мимо причины хуже отсутствия
  // совета — человек идёт чинить то, что не сломано.
  const block = useProfileVpnBlock(error);
  const { emoji, title, detail, hint } = block ?? base;
  // ⚠️ Включение туннеля предлагается КНОПКОЙ, а не делается само. Автозапуск по факту перехода
  // означал бы, что любая открытая ссылка молча поднимает VPN — решение за человека там, где он
  // его не просил. Кнопка закрывает то же неудобство, ничего за него не решая.
  const [vpnBusy, setVpnBusy] = useState(false);
  const [vpnError, setVpnError] = useState('');
  const enableVpn = async (): Promise<void> => {
    if (vpnBusy) return;
    setVpnBusy(true);
    setVpnError('');
    try {
      const servers = await window.oblako.listVpnServers();
      const first = servers[0];
      if (!first) { setVpnError('Сначала добавьте подписку в настройках VPN'); return; }
      const res = await window.oblako.vpnConnect(first.id);
      if (!res.ok) { setVpnError(res.error || 'Не удалось подключиться'); return; }
      onRetry();
    } catch {
      setVpnError('Не удалось подключиться');
    } finally {
      setVpnBusy(false);
    }
  };
  const displayUrl = url.length > 72 ? url.slice(0, 69) + '…' : url;

  return (
    <div style={{
      position: 'absolute', inset: 0,
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      padding: 32,
      background: 'var(--app-bg)',
      pointerEvents: 'auto', // может сидеть внутри TAB_FRAME_STYLE (App.tsx) с pointer-events:none — кнопки должны остаться кликабельными
    }}>
      <div style={{
        display: 'flex', flexDirection: 'column', alignItems: 'center',
        gap: 'var(--space-4)',
        padding: '48px 52px 40px',
        // Внешний остров — тот же рецепт, что у плавающих оболочек (сайдбар, Hub), не карточка
        // внутри поверхности: страница ошибки ЗАМЕЩАЕТ сайт, а не лежит поверх нашего же UI.
        ...glassPlate({ surface: 'surface-island', shadow: 'shadow-island' }),
        borderRadius: 'var(--radius-island)',
        maxWidth: 560, width: '100%', textAlign: 'center',
      }}>
        <div style={{ fontSize: 64, lineHeight: 1, userSelect: 'none' }} aria-hidden>{emoji}</div>

        <h1 style={{
          margin: 0, fontSize: 'var(--fs-2xl)', fontWeight: 600,
          color: 'var(--text-strong)', letterSpacing: '-0.01em',
        }}>
          {title}
        </h1>

        <p style={{
          margin: 0, fontSize: 'var(--fs-lg)', color: 'var(--text-muted)',
          lineHeight: 1.5, maxWidth: 420,
        }}>
          {detail}
        </p>

        {/* Совет — «утопленной» карточкой внутри острова, чтобы «что делать» отделялось от «что
            случилось» не только отступом. Именно --surface-sunken, а НЕ --surface: последний в
            светлой теме тот же белый, что и сам остров, — карточка на нём не читается вовсе. */}
        <div style={{
          marginTop: 'var(--space-1)',
          padding: '14px 18px', borderRadius: 'var(--radius-card)',
          background: 'var(--surface-sunken)',
          fontSize: 'var(--fs-md)', color: 'var(--text-body)', lineHeight: 1.5,
          maxWidth: 440,
        }}>
          {hint}
        </div>

        {url && (
          // Адрес — без плашки: «утопленную» роль в острове уже занял совет выше, вторая серая
          // плитка рядом читалась бы как ещё один блок, хотя это всего лишь сноска.
          <div style={{
            maxWidth: '100%',
            fontSize: 'var(--fs-xs)', color: 'var(--text-faint)',
            overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
          }}>
            {displayUrl}
          </div>
        )}

        <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-2)', marginTop: 'var(--space-2)' }}>
          {canGoBack && onBack && (
            <button
              onClick={onBack}
              style={{ ...buttonBase(), background: 'var(--surface-sunken)', color: 'var(--text-body)' }}
            >
              Назад
            </button>
          )}
          {/* ⚠️ На отказе профиля главное действие — включить туннель, а не «Обновить»:
              обновление без VPN упрётся ровно в тот же отказ. */}
          {block ? (
            <button
              onClick={() => { void enableVpn(); }}
              disabled={vpnBusy}
              style={{
                ...buttonBase(), background: 'var(--accent)', color: 'var(--on-accent)',
                opacity: vpnBusy ? 0.6 : 1,
              }}
            >
              {vpnBusy ? 'Подключаю…' : 'Включить VPN'}
            </button>
          ) : (
            <button
              onClick={onRetry}
              style={{ ...buttonBase(), background: 'var(--accent)', color: 'var(--on-accent)' }}
            >
              Обновить
            </button>
          )}
        </div>
        {!!vpnError && (
          <div style={{ marginTop: 12, fontSize: 'var(--fs-sm)', color: 'var(--danger-500)' }}>
            {vpnError}
          </div>
        )}
      </div>
    </div>
  );
}

/**
 * Не заблокирован ли запрос НАШИМ ЖЕ правилом профиля.
 *
 * ⚠️ Спрашиваем только на прокси-ошибках: лишний поход в main на каждой странице с опечаткой в
 * адресе никому не нужен. И только для активного профиля — вкладка чужого профиля покажет
 * обычный текст, но она и не та, куда человек сейчас смотрит.
 */
function useProfileVpnBlock(error: TabErrorState):
  { emoji: string; title: string; detail: string; hint: string } | null {
  const [blocked, setBlocked] = useState<string | null>(null);
  const code = error?.code ?? 0;
  useEffect(() => {
    if (code !== -130 && code !== -337) { setBlocked(null); return; }
    let alive = true;
    void Promise.all([window.oblako.getProfiles(), window.oblako.getVpnConnectionState()])
      .then(([profiles, vpn]) => {
        if (!alive) return;
        const active = profiles.profiles.find((x) => x.id === profiles.activeId);
        const strict = active?.settings.vpn === 'on';
        setBlocked(strict && vpn?.state !== 'running' ? (active?.name ?? '') : null);
      })
      .catch(() => { /* не смогли спросить — покажем обычный текст */ });
    return () => { alive = false; };
  }, [code]);

  if (blocked === null) return null;
  return {
    emoji: '🛡️',
    title: 'Профиль ждёт VPN',
    detail: `Профиль «${blocked}» настроен открывать сайты только через VPN, а туннель сейчас выключен.`,
    hint: 'Включите VPN в поповере «Защита» — или смените выход в сеть у профиля в настройках.',
  };
}

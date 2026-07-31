import { AlertTriangle, WifiOff, Globe, RotateCcw, ArrowLeft, ShieldAlert, ShieldOff, Ban, ServerCrash, Clock } from 'lucide-react';
import type { TabErrorState } from '../../shared/ipc';
import { islandPlate } from '../styles/island';

interface Props {
  error: TabErrorState;
  url: string;
  onRetry: () => void;
  canGoBack?: boolean;
  onBack?: () => void;
}

// Экран вместо не открывшейся страницы. Три вещи, и все три обязательны: ЧТО случилось (заголовок),
// ПОЧЕМУ (деталь) и ЧТО ДЕЛАТЬ (подсказка). Голый «код ошибки -105» — не сообщение об ошибке, а
// отписка: человеку он не говорит ни одного из трёх.
interface Info {
  Icon: typeof Globe;
  title: string;
  detail: string;
  hint?: string;
}

function hostOf(raw: string): string {
  try { return new URL(raw).hostname; } catch { return raw; }
}

// Коды Chromium (net_error_list.h). Здесь только те, что реально видит пользователь браузера;
// остальное честно уходит в общую ветку с кодом — врать выдуманным диагнозом хуже, чем признать
// незнание.
function loadInfo(code: number, host: string): Info {
  switch (code) {
    case -105: // ERR_NAME_NOT_RESOLVED
    case -137: // ERR_NAME_RESOLUTION_FAILED
      return {
        Icon: Globe, title: 'Не удалось найти сервер',
        detail: `DNS не знает адреса для ${host}.`,
        hint: 'Проверьте, нет ли опечатки в адресе. Если адрес верный — сайт мог переехать или его больше нет.',
      };
    case -106: // ERR_INTERNET_DISCONNECTED
      return {
        Icon: WifiOff, title: 'Нет подключения к интернету',
        detail: 'Браузер не видит сети.',
        hint: 'Проверьте Wi-Fi или кабель, затем обновите страницу.',
      };
    case -102: // ERR_CONNECTION_REFUSED
      return {
        Icon: ServerCrash, title: 'Сервер отклонил соединение',
        detail: `${host} ответил отказом на попытку подключиться.`,
        hint: 'Обычно это значит, что сайт лежит или закрыт для внешних подключений. Стоит попробовать позже.',
      };
    case -101: // ERR_CONNECTION_RESET
    case -100: // ERR_CONNECTION_CLOSED
    case -104: // ERR_CONNECTION_FAILED
      return {
        Icon: ServerCrash, title: 'Соединение оборвалось',
        detail: `Связь с ${host} разорвана на полпути.`,
        hint: 'Чаще всего помогает просто обновить. Если повторяется — виновата сеть между вами и сайтом.',
      };
    case -7:   // ERR_TIMED_OUT
    case -118: // ERR_CONNECTION_TIMED_OUT
      return {
        Icon: Clock, title: 'Сайт не ответил вовремя',
        detail: `${host} не прислал ответ за отведённое время.`,
        hint: 'Сайт перегружен или недоступен из вашей сети. Попробуйте обновить или зайти позже.',
      };
    case -109: // ERR_ADDRESS_UNREACHABLE
      return {
        Icon: Globe, title: 'Адрес недостижим',
        detail: `К ${host} нет маршрута из вашей сети.`,
        hint: 'Так бывает при проблемах с роутером или когда сайт закрыт для вашего региона — здесь может выручить VPN.',
      };
    case -20: // ERR_BLOCKED_BY_CLIENT
      return {
        Icon: Ban, title: 'Запрос заблокирован',
        detail: 'Загрузку остановил сам браузер.',
        hint: 'Скорее всего сработал встроенный блокировщик. Отключите его для этого сайта в поповере «Защита» и обновите страницу.',
      };
    case -21: // ERR_NETWORK_CHANGED
      return {
        Icon: WifiOff, title: 'Сеть сменилась во время загрузки',
        detail: 'Подключение переключилось, пока страница грузилась.',
        hint: 'Обычная история при включении или отключении VPN. Достаточно обновить страницу.',
      };
    case -130: // ERR_PROXY_CONNECTION_FAILED
    case -337: // ERR_PROXY_AUTH_REQUESTED (близкий по смыслу для пользователя)
      return {
        Icon: ShieldOff, title: 'Прокси не отвечает',
        detail: 'Не удалось подключиться через прокси-сервер.',
        hint: 'Если включён VPN — проверьте подключение в поповере «Защита»: сервер мог отвалиться, а kill switch не пускает трафик мимо него.',
      };
    case -310: // ERR_TOO_MANY_REDIRECTS
      return {
        Icon: AlertTriangle, title: 'Слишком много переадресаций',
        detail: `${host} зациклил перенаправления.`,
        hint: 'Часто лечится очисткой кук этого сайта. Либо сайт сломан на своей стороне.',
      };
    case -324: // ERR_EMPTY_RESPONSE
      return {
        Icon: ServerCrash, title: 'Сервер прислал пустой ответ',
        detail: `${host} закрыл соединение, ничего не передав.`,
        hint: 'Обычно временный сбой на стороне сайта — попробуйте обновить.',
      };
    case -312: // ERR_UNSAFE_PORT
      return {
        Icon: Ban, title: 'Порт заблокирован',
        detail: 'Chromium не открывает адреса на этом порту.',
        hint: 'Список портов зашит в движок ради безопасности (почта, FTP и подобные). Обойти его из браузера нельзя — нужен другой порт.',
      };
    case -300: // ERR_INVALID_URL
      return {
        Icon: AlertTriangle, title: 'Неверный адрес',
        detail: 'Такой адрес нельзя открыть.',
        hint: 'Проверьте строку адреса: возможно, в ней лишний символ или неизвестная схема.',
      };
    case -6: // ERR_FILE_NOT_FOUND
      return {
        Icon: AlertTriangle, title: 'Файл не найден',
        detail: 'По этому пути на диске ничего нет.',
        hint: 'Файл могли переместить, переименовать или удалить.',
      };
    case -107: // ERR_SSL_PROTOCOL_ERROR
    case -501: // ERR_INSECURE_RESPONSE
      return {
        Icon: ShieldAlert, title: 'Защищённое соединение не установлено',
        detail: `Не удалось договориться о шифровании с ${host}.`,
        hint: 'Сайт настроен неправильно либо соединение кто-то подменяет. Вводить пароли на нём сейчас не стоит.',
      };
    default:
      // Сертификатные ошибки идут сплошным блоком -200…-219 — разбирать каждую по отдельности
      // пользователю незачем, вывод для всех один и тот же.
      if (code <= -200 && code >= -219) {
        return {
          Icon: ShieldAlert, title: 'Сертификат сайта не в порядке',
          detail: `Браузер не доверяет сертификату ${host} (код ${code}).`,
          hint: 'Сертификат мог истечь или быть выписан не на этот домен. Пока причина не ясна, не вводите на сайте пароли и карты.',
        };
      }
      return {
        Icon: AlertTriangle, title: 'Не удалось открыть страницу',
        detail: `Загрузка прервалась с кодом ${code}.`,
        hint: 'Попробуйте обновить. Если повторяется — проблема, скорее всего, на стороне сайта.',
      };
  }
}

function errorInfo(error: TabErrorState): Info {
  if (error.type === 'crash') {
    return {
      Icon: AlertTriangle, title: 'Вкладка упала',
      detail: 'Процесс, отвечавший за эту страницу, завершился неожиданно.',
      hint: 'Остальные вкладки не пострадали — эту достаточно перезагрузить.',
    };
  }
  // Сеть отсутствовала в момент ошибки — тогда неважно, какой именно код прислал Chromium:
  // причина одна, и совет по коду («сайт перегружен», «проверьте адрес») только собьёт с толку.
  if (error.offline) {
    return {
      Icon: WifiOff, title: 'Нет подключения к интернету',
      detail: 'В момент загрузки браузер не видел сети.',
      hint: 'Проверьте Wi-Fi или кабель. Если пользуетесь VPN — убедитесь, что он подключён.',
    };
  }
  return loadInfo(error.code, hostOf(error.url));
}

export default function TabError({ error, url, onRetry, canGoBack, onBack }: Props) {
  const { Icon, title, detail, hint } = errorInfo(error);
  const displayUrl = url.length > 60 ? url.slice(0, 57) + '…' : url;

  return (
    <div style={{
      position: 'absolute', inset: 0,
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      background: 'var(--app-bg)',
      pointerEvents: 'auto', // может сидеть внутри TAB_FRAME_STYLE (App.tsx) с pointer-events:none — кнопки должны остаться кликабельными
    }}>
      <div style={{
        display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 12,
        padding: '32px 40px',
        ...islandPlate,
        borderRadius: 'var(--radius-card)',
        maxWidth: 460, textAlign: 'center',
      }}>
        <Icon size={36} color="var(--text-faint)" strokeWidth={1.5} />
        <p style={{ margin: 0, fontSize: 'var(--fs-lg)', fontWeight: 600, color: 'var(--text-strong)' }}>
          {title}
        </p>
        <p style={{ margin: 0, fontSize: 'var(--fs-sm)', color: 'var(--text-muted)', lineHeight: 1.5 }}>
          {detail}
        </p>
        {hint && (
          <p style={{ margin: 0, fontSize: 'var(--fs-sm)', color: 'var(--text-faint)', lineHeight: 1.5 }}>
            {hint}
          </p>
        )}
        {url && (
          <p style={{ margin: 0, fontSize: 'var(--fs-xs)', color: 'var(--text-faint)', wordBreak: 'break-all' }}>
            {displayUrl}
          </p>
        )}
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 4 }}>
          {canGoBack && onBack && (
            <button
              onClick={onBack}
              style={{
                display: 'flex', alignItems: 'center', gap: 6,
                padding: '8px 16px',
                background: 'var(--surface-sunken)',
                color: 'var(--text-body)',
                border: 'none',
                borderRadius: 'calc(var(--radius-card) / 2)',
                fontSize: 'var(--fs-sm)', fontWeight: 500, cursor: 'pointer',
              }}
            >
              <ArrowLeft size={14} strokeWidth={2} />
              Назад
            </button>
          )}
          <button
            onClick={onRetry}
            style={{
              display: 'flex', alignItems: 'center', gap: 6,
              padding: '8px 20px',
              background: 'var(--accent)',
              color: '#fff',
              border: 'none',
              borderRadius: 'calc(var(--radius-card) / 2)',
              fontSize: 'var(--fs-sm)',
              fontWeight: 500,
              cursor: 'pointer',
            }}
          >
            <RotateCcw size={14} strokeWidth={2} />
            Обновить
          </button>
        </div>
      </div>
    </div>
  );
}

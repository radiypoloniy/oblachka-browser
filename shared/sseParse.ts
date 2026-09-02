// Разбор потока server-sent events — тем же куском, каким его отдаёт сеть.
//
// ⚠️ Зачем отдельный модуль под проверкой, а не десять строк в адаптере. Ответ облачной модели
// приходит потоком, и ГРАНИЦЫ СЕТЕВЫХ КУСКОВ НЕ СОВПАДАЮТ С ГРАНИЦАМИ СОБЫТИЙ: одно событие
// запросто приезжает двумя чанками, а один чанк несёт полтора события. Наивное
// `chunk.split('\n\n')` работает на localhost и на быстрых ответах, а ломается на медленной сети и
// на длинных ответах — то есть ровно там, где человек смотрит на текст и ждёт. Диагностируется
// такое отвратительно: пропадают отдельные куски текста, воспроизвести нельзя.
//
// ⚠️ Парсер ДЕРЖИТ ХВОСТ между вызовами. Это единственная причина, по которой он объект, а не
// функция: незавершённая строка обязана дожить до следующего чанка.
//
// Значимых импортов нет — модуль под проверкой (scripts/sse-parse-check.mjs), она гоняется голым
// node (см. правило про shared/ в CLAUDE.md).

export interface SseEvent {
  /** Склеенное содержимое всех строк `data:` события. */
  data: string;
  /** Значение `event:`, если провайдер его прислал (Anthropic — присылает, OpenAI — нет). */
  name?: string;
}

export interface SseParser {
  /** Скормить очередной кусок из сети. Возвращает события, которые в нём завершились. */
  push(chunk: string): SseEvent[];
  /** Поток кончился: отдать событие, если оно осталось без завершающей пустой строки. */
  flush(): SseEvent[];
}

export function createSseParser(): SseParser {
  // Незавершённая строка с прошлого чанка.
  let tail = '';
  // Накопленное текущее событие: строки data и имя.
  let dataLines: string[] = [];
  let name: string | undefined;

  function finish(out: SseEvent[]): void {
    if (dataLines.length === 0 && name === undefined) return;
    // ⚠️ Несколько строк `data:` в одном событии склеиваются через \n — так велит спецификация, и
    // на этом держится многострочный текст у некоторых прокси.
    out.push(name === undefined ? { data: dataLines.join('\n') } : { data: dataLines.join('\n'), name });
    dataLines = [];
    name = undefined;
  }

  function handleLine(raw: string, out: SseEvent[]): void {
    // \r остаётся от CRLF: сеть отдаёт \r\n, а бьём мы по \n.
    const line = raw.endsWith('\r') ? raw.slice(0, -1) : raw;

    if (line === '') { finish(out); return; }
    // Комментарий-пульс: провайдеры шлют его, чтобы соединение не закрыли по таймауту.
    if (line.startsWith(':')) return;

    const colon = line.indexOf(':');
    const field = colon === -1 ? line : line.slice(0, colon);
    let value = colon === -1 ? '' : line.slice(colon + 1);
    // Ровно ОДИН ведущий пробел после двоеточия принадлежит формату, а не значению.
    if (value.startsWith(' ')) value = value.slice(1);

    if (field === 'data') dataLines.push(value);
    else if (field === 'event') name = value;
    // id/retry и незнакомые поля нам не нужны — молча пропускаем.
  }

  return {
    push(chunk: string): SseEvent[] {
      const out: SseEvent[] = [];
      const text = tail + chunk;
      const parts = text.split('\n');
      // Последний кусок — недописанная строка; придержим до следующего чанка.
      tail = parts.pop() ?? '';
      for (const line of parts) handleLine(line, out);
      return out;
    },

    flush(): SseEvent[] {
      const out: SseEvent[] = [];
      if (tail !== '') { handleLine(tail, out); tail = ''; }
      finish(out);
      return out;
    },
  };
}

/**
 * Признак конца потока у OpenAI-совместимых.
 *
 * ⚠️ Проверяется ПОСЛЕ обрезки пробелов: часть шлюзов отдаёт `data: [DONE] `, и строгое сравнение
 * с '[DONE]' на них не срабатывает — поток выглядит незакрытым, а ответ повисает до таймаута.
 */
export function isSseDone(data: string): boolean {
  return data.trim() === '[DONE]';
}

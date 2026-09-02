// «Дай объект по схеме» — единственный путь, общий для всех четырёх механизмов.
//
// ⚠️ Зачем этаж поверх адаптеров. Гарантии у провайдеров разные и НИ ОДНА не полная: грамматика
// llama.cpp держит форму и границы; `json_schema strict` у OpenAI держит форму, но не принимает
// maxLength/minItems и потому их теряет; tool use у Anthropic держит почти всё; произвольный
// совместимый endpoint не держит ничего. Если разбирать это в каждом адаптере, получится четыре
// слегка разных представления о валидном ответе — и вёрстка начнёт ломаться в зависимости от того,
// какую модель человек подключил. Поэтому проверка одна и стоит НАД всеми.
//
// ⚠️ Ремонтный повтор РОВНО ОДИН, и это не экономия строк. Второй и третий превращают редкий сбой
// в тихую задержку на десятки секунд, за которую человек платит деньгами своего провайдера.
// Честный отказ дешевле молчаливой дороговизны.

import { validateAgainst, type JsonSchema } from '../../shared/aiSchema';
import { ProviderError, type GenOpts, type Provider } from './Provider';

export interface StructuredOutcome<T> {
  value: T;
  /** Понадобился ли ремонт. Нужно замеру: по этому числу видно, какой провайдер держит схему. */
  repaired: boolean;
}

/**
 * Спросить у провайдера объект и убедиться, что он подошёл.
 *
 * ⚠️ Проверяется ИСХОДНАЯ схема, а не та, что ушла провайдеру. Диалект по дороге выбросил границы
 * (см. shared/aiSchema.ts), и восстановить их можно только здесь — иначе виджет на сорок элементов
 * вместо шестнадцати доедет до стола и разъедет плитку.
 */
export async function structured<T>(
  provider: Provider,
  schema: JsonSchema,
  prompt: string,
  opts?: GenOpts,
): Promise<StructuredOutcome<T>> {
  const first = await provider.generateStructured(schema, prompt, opts);
  const errors = validateAgainst(schema, first);
  if (errors.length === 0) return { value: first as T, repaired: false };

  // Грамматика ошибиться не может — если ошиблась, дело не в модели, и повтор не поможет.
  if (provider.caps().schema === 'grammar') {
    throw new ProviderError('schema', `ответ под грамматикой не сошёлся со схемой: ${errors.join('; ')}`);
  }

  console.warn(`[ai] ответ не сошёлся со схемой, ремонт: ${errors.slice(0, 3).join('; ')}`);

  // ⚠️ Претензии идут модели ДОСЛОВНО и по-русски: validateAgainst писался так, чтобы его вывод
  // читался как инструкция («нет обязательного поля "title"»), а не как код ошибки. Второй раз
  // формулировать то же самое другими словами — лишний источник расхождения.
  const repaired = await provider.generateStructured(schema, repairPrompt(prompt, first, errors), opts);
  const stillWrong = validateAgainst(schema, repaired);
  if (stillWrong.length > 0) {
    throw new ProviderError('schema', `ответ не сошёлся со схемой: ${stillWrong.join('; ')}`);
  }
  return { value: repaired as T, repaired: true };
}

function repairPrompt(original: string, got: unknown, errors: string[]): string {
  return [
    original,
    '',
    'Предыдущий ответ не подошёл:',
    JSON.stringify(got),
    '',
    'Что именно не так:',
    ...errors.map((e) => `— ${e}`),
    '',
    'Ответь заново, исправив только это. Никакого текста вокруг объекта.',
  ].join('\n');
}

import { useEffect, useRef, useState } from 'react';
import { ChevronDown, Loader2 } from 'lucide-react';
import { InlineError, Panel, TextField } from './kit';
import { RADIUS, TEXT, motion, pad, selected, sp } from '../../styles/system';
import { filterModels } from '../../../shared/modelList';
import type { ProviderKind } from '../../../shared/aiProviders';
import type { AiConnection } from '../../../shared/ipc';

/**
 * Поле имени модели со списком от самого провайдера.
 *
 * ⚠️ Список ДОПОЛНЯЕТ ручной ввод, а не заменяет его. Метода `/models` нет у половины совместимых
 * шлюзов, а у Ollama он показывает ровно то, что скачано, — то есть выпадашка обязана уметь быть
 * пустой, не мешая вписать имя руками. Поэтому это поле ввода с подсказками, а не `<select>`.
 *
 * ⚠️ Список тянется ПО НАЖАТИЮ, а не по вводу адреса. Автозагрузка на каждый символ означала бы
 * запрос к провайдеру на каждую букву в поле адреса, а у части из них он ограничен по частоте.
 *
 * ⚠️ Список РАЗДВИГАЕТ форму, а не висит над ней слоем. Плавающая панель потребовала бы своей
 * заливки и тени — то есть ещё одной самодельной карточки в настройках, ровно той, против которой
 * заведено правило «только рецепты из kit» (см. conventions-check). В потоке рецепт уже есть:
 * рамка коробки плюс заливка у выбранной строки.
 *
 * ⚠️ Показываем не больше LIMIT строк. У OpenRouter в списке три сотни имён: рисовать их все —
 * триста узлов DOM ради перечня, который человек всё равно сузит запросом.
 */
const LIMIT = 50;
/** Ступенчатое появление — только у первых строк: на пятидесятой задержка уже не читается. */
const STAGGER = 8;

export function ModelField({ kind, baseUrl, apiKey, value, known, onChange, onEnter, style }: {
  kind: ProviderKind;
  baseUrl: string;
  /** Ключ из формы. Пустая строка означает «возьми сохранённый» — сам ключ сюда не приезжает. */
  apiKey: string;
  value: string;
  /**
   * Список, уже полученный снаружи. ⚠️ Им приезжает находка автообнаружения: раннер на этой машине
   * ответил своим списком ещё до того, как человек нажал «Подключить», и спрашивать его второй раз
   * значило бы показать пустую выпадашку там, где ответ уже на руках.
   */
  known?: string[];
  onChange: (v: string) => void;
  onEnter?: () => void;
  style?: React.CSSProperties;
}) {
  const [models, setModels] = useState<string[] | null>(known ?? null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [open, setOpen] = useState(false);
  const [cursor, setCursor] = useState(0);
  const box = useRef<HTMLDivElement>(null);

  // Адрес сменился — прежний список описывает уже не этот провайдер.
  useEffect(() => { setModels(known ?? null); setError(''); setOpen(false); }, [baseUrl, kind, known]);

  // ⚠️ Закрытие по клику мимо, а не по blur поля: blur срабатывает раньше клика по строке списка,
  // и выбор мышью не доходил бы до обработчика вовсе.
  useEffect(() => {
    if (!open) return;
    const away = (e: MouseEvent): void => {
      if (!box.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', away);
    return () => document.removeEventListener('mousedown', away);
  }, [open]);

  async function load(): Promise<void> {
    if (busy) return;
    // Список уже на руках — второй запрос к провайдеру не нужен, просто раскрываем.
    if (models !== null) { setOpen((o) => !o); return; }
    setBusy(true);
    setError('');
    // ⚠️ Подключение здесь ЧЕРНОВОЕ: его ещё нет ни в хранилище, ни в списке. main берёт из него
    // только адрес и форму запроса, а `id` служит ключу — «probe» гарантированно не совпадёт с
    // заведённым, то есть чужой сохранённый ключ подставлен не будет.
    const conn: AiConnection = {
      id: 'probe', label: '', kind, baseUrl: baseUrl.trim(), model: value.trim() || 'probe', concurrency: 4,
    };
    const res = await window.oblako.listAiModels(conn, apiKey.trim() || null);
    setBusy(false);
    if (!res.ok) { setError(res.error); return; }
    setModels(res.models);
    setCursor(0);
    setOpen(true);
  }

  const shown = models === null ? [] : filterModels(models, value);
  const visible = shown.slice(0, LIMIT);
  const hidden = shown.length - visible.length;

  function pick(name: string): void {
    onChange(name);
    setOpen(false);
  }

  /**
   * ⚠️ Клавиши ловим на ОБЁРТКЕ, а не свойством поля: событие всплывает от input сюда, и так
   * ModelField обходится без правки общего TextField ради одного своего случая.
   */
  function keys(e: React.KeyboardEvent<HTMLDivElement>): void {
    const list = open && visible.length > 0;
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      if (!list) return;
      e.preventDefault();
      const step = e.key === 'ArrowDown' ? 1 : -1;
      setCursor((c) => (c + step + visible.length) % visible.length);
    } else if (e.key === 'Enter') {
      // Enter при раскрытом списке выбирает подсвеченное, а не сохраняет подключение с тем, что
      // человек набрал наполовину. Список закрыт — обычное «сохранить».
      if (list) pick(visible[cursor] ?? value);
      else onEnter?.();
    } else if (e.key === 'Escape') {
      setOpen(false);
    }
  }

  return (
    <div ref={box} onKeyDown={keys} style={{ display: 'flex', flexDirection: 'column', gap: sp(1), minWidth: 0, ...style }}>
      <div style={{ position: 'relative', minWidth: 0 }}>
        <TextField
          value={value}
          onChange={(v) => { onChange(v); setCursor(0); if (models !== null) setOpen(true); }}
          placeholder="gpt-5"
          mono
          // Поле кончается там, где начинается кнопка списка: ширина кнопки — ступень шкалы.
          inputStyle={{ paddingRight: sp(8) }}
        />
        <button
          type="button"
          onClick={() => void load()}
          title={models === null ? 'Показать модели провайдера' : 'Список моделей'}
          aria-label="Список моделей"
          disabled={busy || baseUrl.trim() === ''}
          style={{
            position: 'absolute', top: 0, bottom: 0, right: 0, width: sp(8),
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            background: 'transparent', border: 'none', cursor: 'pointer',
            color: 'var(--text-muted)', borderRadius: RADIUS.control,
            transition: motion.hover('color'),
          }}
          onMouseEnter={(e) => (e.currentTarget.style.color = 'var(--text-body)')}
          onMouseLeave={(e) => (e.currentTarget.style.color = 'var(--text-muted)')}
        >
          {busy
            ? <Loader2 size={15} style={{ animation: 'oblako-spin 1s linear infinite' }} />
            : <ChevronDown size={15} style={{ transform: open ? 'rotate(180deg)' : 'none', transition: motion.state('transform') }} />}
        </button>
      </div>

      {error !== '' && <InlineError>{error}</InlineError>}

      {open && visible.length > 0 && (
        <Panel style={{ maxHeight: 232, overflowY: 'auto', padding: sp(1) }}>
          {visible.map((name, i) => (
            <button
              key={name}
              type="button"
              className="popover-row"
              onMouseEnter={() => setCursor(i)}
              onClick={() => pick(name)}
              style={{
                ...TEXT.body, display: 'block', width: '100%', textAlign: 'left',
                fontFamily: 'var(--font-mono)', fontSize: 'var(--fs-xs)',
                padding: pad(1, 2), border: 'none', cursor: 'pointer',
                borderRadius: RADIUS.control, whiteSpace: 'nowrap', overflow: 'hidden',
                textOverflow: 'ellipsis', background: 'transparent',
                ...selected(i === cursor),
                animation: 'popover-row-in var(--dur-base) var(--ease-out) both',
                animationDelay: `${Math.min(i, STAGGER) * 18}ms`,
              }}
            >{name}</button>
          ))}
          {hidden > 0 && (
            // ⚠️ Говорим про обрезку прямо: молча показанные пятьдесят из трёхсот читаются как
            // «моей модели тут нет», и человек уходит вписывать имя руками — мимо списка.
            <div style={{ ...TEXT.caption, padding: pad(1, 2), color: 'var(--text-faint)' }}>
              и ещё {hidden} — уточните запрос
            </div>
          )}
        </Panel>
      )}
    </div>
  );
}

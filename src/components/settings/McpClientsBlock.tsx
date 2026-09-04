import { useEffect, useState } from 'react';
import { Check, Copy, FileJson, Plug } from 'lucide-react';
import type { McpClientTarget } from '../../../shared/ipc';
import { CapsLabel, InlineError, InlineHint, StatusCard, btnGhost, btnTone } from './kit';
import { RADIUS, TEXT, pad, sp } from '../../styles/system';

/**
 * Подключение к чужому клиенту в одно нажатие.
 *
 * ⚠️ Зачем: команда на три сотни знаков — это фича для тех, кто и так умеет. Claude Desktop,
 * Cursor и VS Code читают обычный JSON-файл, путь к которому мы знаем; «подключить» там означает
 * дописать в него один объект, и делать это руками человек не должен.
 *
 * ⚠️ ПРЕДПРОСМОТР ОБЯЗАТЕЛЕН, и это не вежливость. Мы собираемся править файл, который человек
 * настраивал сам и в котором лежат его другие серверы. Прежде чем это произойдёт, он должен
 * увидеть путь к файлу и точный текст, который туда уедет, — иначе кнопка «Настроить» просит
 * доверия, которого мы не заслужили.
 *
 * ⚠️ Список только ОСМАТРИВАЕТСЯ при открытии: scan читает чужие конфиги и ничего не пишет.
 * Пишет отдельный канал, и зовётся он из этой карточки, после показа предпросмотра.
 */
export function McpClientsBlock() {
  const [targets, setTargets] = useState<McpClientTarget[] | null>(null);
  const [open, setOpen] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState<Record<string, string>>({});
  const [error, setError] = useState('');

  const scan = (): void => { void window.oblako.scanMcpClients().then(setTargets); };
  useEffect(scan, []);

  async function install(id: string): Promise<void> {
    setBusy(true);
    setError('');
    const res = await window.oblako.installMcpClient(id);
    setBusy(false);
    if (!res.ok) { setError(res.error); return; }
    setDone((d) => ({
      ...d,
      // ⚠️ Про копию говорим ИМЕНЕМ ФАЙЛА, а не «резервная копия создана»: если человек захочет
      // откатить нашу правку, ему нужен путь, а не факт.
      [id]: res.backup ? `Готово. Прежний файл сохранён рядом: ${fileName(res.backup)}` : 'Готово.',
    }));
    setOpen(null);
    scan();
  }

  // Показывать нечего — ни одного клиента на машине. Пустой заголовок в настройках хуже молчания.
  if (targets !== null && targets.length === 0) return null;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: sp(2) }}>
      <CapsLabel style={{ color: 'var(--text-faint)' }}>Программы на этой машине</CapsLabel>

      {(targets ?? []).map((t) => (
        <div key={t.id} style={{ display: 'flex', flexDirection: 'column', gap: sp(2) }}>
          <StatusCard
            icon={t.plan === 'same'
              ? <Check size={20} style={{ color: 'var(--success-500)', flex: 'none' }} />
              : <Plug size={20} style={{ color: 'var(--text-faint)', flex: 'none' }} />}
            title={t.label}
            subtitle={subtitleFor(t, done[t.id])}
            actions={actionFor(t, open === t.id, () => setOpen(open === t.id ? null : t.id))}
          />

          {open === t.id && (
            <Preview
              target={t}
              busy={busy}
              onCancel={() => setOpen(null)}
              onWrite={() => void install(t.id)}
            />
          )}
        </div>
      ))}

      {error !== '' && <InlineError>{error}</InlineError>}

      <InlineHint>
        Программу после записи нужно перезапустить — конфиг она читает при старте. Прежний файл
        сохраняется рядом копией, наши строки в нём помечены именем oblako.
      </InlineHint>
    </div>
  );
}

/**
 * Что именно уедет в чужой файл.
 *
 * ⚠️ Показываем ТОЛЬКО НАШ блок, а не получившийся файл целиком: в конфиге лежат чужие серверы
 * человека, и показывать их обратно в нашем окне незачем — вопрос стоит «что вы допишете», а не
 * «что у меня там лежит».
 */
function Preview({ target, busy, onCancel, onWrite }: {
  target: McpClientTarget; busy: boolean; onCancel: () => void; onWrite: () => void;
}) {
  const [copied, setCopied] = useState(false);
  const blocked = target.plan === 'blocked';

  const copy = (): void => {
    void navigator.clipboard.writeText(target.block);
    setCopied(true);
    setTimeout(() => setCopied(false), 1600);
  };

  return (
    <div style={{
      display: 'flex', flexDirection: 'column', gap: sp(3),
      padding: pad(3), borderRadius: RADIUS.box, border: '1px solid var(--divider)',
    }}>
      <div>
        <span style={{ ...TEXT.caption }}>{blocked ? 'Впишите сами в файл' : 'Допишем в файл'}</span>
        {/* ⚠️ Путь ломается по любому символу: это путь, а не текст, и человек читает его глазами
            прежде, чем разрешить запись. Полоса прокрутки внутри рамки прятала бы конец пути —
            то есть ровно ту часть, по которой видно, тот ли это профиль. */}
        <div style={{
          ...TEXT.body, fontFamily: 'var(--font-mono)', fontSize: 'var(--fs-xs)',
          wordBreak: 'break-all', color: 'var(--text-strong)',
        }}>{target.file}</div>
      </div>

      <pre style={{
        margin: 0, padding: pad(2, 3), borderRadius: RADIUS.control,
        border: '1px solid var(--divider)', overflowX: 'auto',
        fontFamily: 'var(--font-mono)', fontSize: 'var(--fs-xs)',
        color: 'var(--text-body)', lineHeight: 1.5,
      }}>{target.block}</pre>

      <div style={{ display: 'flex', gap: sp(2), flexWrap: 'wrap' }}>
        {!blocked && (
          <button onClick={onWrite} disabled={busy} style={{ ...btnTone, opacity: busy ? 0.6 : 1 }}>
            {busy ? 'Пишу…' : 'Записать в файл'}
          </button>
        )}
        <button onClick={copy} style={{ ...btnGhost, display: 'inline-flex', gap: sp(2), alignItems: 'center' }}>
          {copied ? <Check size={15} /> : <Copy size={15} />}
          {copied ? 'Скопировано' : 'Копировать блок'}
        </button>
        <button onClick={onCancel} style={btnGhost}>Отмена</button>
      </div>
    </div>
  );
}

/**
 * Строка состояния клиента.
 *
 * ⚠️ У «уже настроено» и «настроено иначе» разные тексты, и это важнее, чем кажется: второе
 * означает, что приложение или профиль переехали, и клиент СЕЙЧАС до браузера не достучится, хотя
 * запись у него есть. Молчаливое «настроено» в этом случае было бы неправдой.
 */
function subtitleFor(t: McpClientTarget, doneText: string | undefined): string {
  if (doneText !== undefined) return doneText;
  switch (t.plan) {
    case 'same': return 'Уже подключено к этому браузеру.';
    case 'replace': return 'Запись есть, но ведёт не сюда — приложение или профиль переехали.';
    case 'create': return `Конфига ещё нет — создадим: ${fileName(t.file)}`;
    case 'add': return `Допишем одну запись в ${fileName(t.file)}, остальное не тронем.`;
    case 'blocked': return blockedText(t);
  }
}

function blockedText(t: McpClientTarget): string {
  return t.problem === 'not-json'
    ? 'Конфиг не читается как строгий JSON — похоже, в нём есть комментарии. Сами править не будем.'
    : 'Конфиг устроен неожиданно — сами править не будем.';
}

function actionFor(t: McpClientTarget, open: boolean, toggle: () => void): React.ReactNode {
  if (t.plan === 'same') return null;
  return (
    <button onClick={toggle} style={{ ...btnGhost, display: 'inline-flex', gap: sp(2), alignItems: 'center' }}>
      <FileJson size={15} />
      {open ? 'Свернуть' : t.plan === 'blocked' ? 'Показать блок' : 'Настроить'}
    </button>
  );
}

/** Имя файла из полного пути — в подписи путь целиком не нужен, он есть в предпросмотре. */
function fileName(full: string): string {
  const cut = Math.max(full.lastIndexOf('\\'), full.lastIndexOf('/'));
  return cut === -1 ? full : full.slice(cut + 1);
}

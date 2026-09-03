import { useEffect, useState } from 'react';
import { Download, ImageOff, Paperclip } from 'lucide-react';
import { RADIUS, TEXT, sp, pad } from '../../styles/system';
import { aiBridge } from './bridge';
import type { AiFileMeta } from '../../../shared/aiAttachments';

/**
 * Вложения в ответе модели: картинки показываем, всё остальное — строкой с именем.
 *
 * ⚠️ БАЙТЫ ПРОСИМ ОТДЕЛЬНО и только под показ. Вместе с ответом приезжает лишь описание файла —
 * иначе мегабайты картинки уезжали бы через IPC на каждом пуше беседы и оседали бы в истории.
 * Здесь мы просим содержимое ровно один раз на компонент и держим его в его же состоянии.
 *
 * ⚠️ Скачивание — ОДНИМ КЛИКОМ ПО КАРТИНКЕ, а не кнопкой в углу. Кнопка поверх изображения либо
 * закрывает его часть, либо теряется на светлом кадре; клик по самой картинке — то, чего человек
 * и ждёт. Подпись под кадром говорит, что будет по клику, чтобы это не приходилось угадывать.
 */
export function ChatFiles({ files }: { files: AiFileMeta[] }) {
  if (files.length === 0) return null;
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: sp(2), marginTop: sp(2) }}>
      {files.map((f) => (f.kind === 'image' ? <Picture key={f.id} file={f} /> : <FileRow key={f.id} file={f} />))}
    </div>
  );
}

function Picture({ file }: { file: AiFileMeta }) {
  const [src, setSrc] = useState<string | null>(null);
  const [gone, setGone] = useState(false);

  useEffect(() => {
    let alive = true;
    const api = aiBridge();
    if (!api) { setGone(true); return; }
    void api.aiFileData(file.id).then((url) => {
      if (!alive) return;
      if (url === null) setGone(true);
      else setSrc(url);
    });
    return () => { alive = false; };
  }, [file.id]);

  // ⚠️ Файла может не быть законно: каталог вложений с потолком, и самые давние из него выселяются.
  // Молча показать пустоту нельзя — человек решит, что сломалось; поэтому говорим прямо.
  if (gone) {
    return (
      <div style={{
        display: 'flex', alignItems: 'center', gap: sp(2), padding: pad(2, 3),
        borderRadius: RADIUS.box, background: 'var(--surface-sunken)', ...TEXT.caption,
      }}>
        <ImageOff size={14} />
        Изображение больше не хранится
      </div>
    );
  }

  return (
    <figure style={{ margin: 0, display: 'flex', flexDirection: 'column', gap: sp(1), alignItems: 'flex-start' }}>
      <button
        onClick={() => void aiBridge()?.aiFileSave(file.id)}
        title="Сохранить изображение"
        style={{
          padding: 0, border: '1px solid var(--glass-edge)', borderRadius: RADIUS.box,
          background: 'var(--surface-sunken)', cursor: 'pointer', overflow: 'hidden',
          maxWidth: '100%', lineHeight: 0,
        }}
      >
        {src === null
          // Место под картинку занимаем сразу: без этого лента чата дёргается, когда байты доедут.
          ? <span style={{ display: 'block', width: 220, height: 140 }} />
          : <img src={src} alt={file.name} style={{ display: 'block', maxWidth: '100%', height: 'auto' }} />}
      </button>
      <figcaption style={{ ...TEXT.caption, display: 'flex', alignItems: 'center', gap: sp(1) }}>
        <Download size={12} />
        Нажмите, чтобы сохранить
      </figcaption>
    </figure>
  );
}

function FileRow({ file }: { file: AiFileMeta }) {
  return (
    <button
      onClick={() => void aiBridge()?.aiFileSave(file.id)}
      title="Сохранить файл"
      style={{
        display: 'flex', alignItems: 'center', gap: sp(2), width: '100%', textAlign: 'left',
        padding: pad(2, 3), borderRadius: RADIUS.box, border: '1px solid var(--glass-edge)',
        background: 'var(--surface-sunken)', cursor: 'pointer', color: 'var(--text-strong)',
      }}
    >
      <Paperclip size={14} />
      <span style={{ fontSize: 'var(--fs-sm)', fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
        {file.name}
      </span>
      <span style={{ ...TEXT.caption, marginLeft: 'auto' }}>{humanSize(file.size)}</span>
    </button>
  );
}

/** ⚠️ Килобайт по 1024: человек сверяет это число с проводником Windows, а тот считает так же. */
function humanSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} Б`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} КБ`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} МБ`;
}

import { createContext, useContext, useState, type HTMLAttributes } from 'react';
import { INPUT_COUNT_MAX, INPUT_FILE_MAX, type DroppedInput } from '../../../shared/aiChatInputs';
import { useChatInputs } from '../useChatInputs';

const DraftInputs = createContext<ReturnType<typeof useChatInputs> | null>(null);
export function useDraftInputs() {
  const draft = useContext(DraftInputs);
  if (!draft) throw new Error('Черновик вложений недоступен');
  return draft;
}

async function readDrop(data: DataTransfer): Promise<DroppedInput[]> {
  const local = Array.from(data.files);
  // Строки копируются до await: Chromium закрывает доступ к DataTransfer после обработчика.
  const html = data.getData('text/html'), uri = data.getData('text/uri-list'), plain = data.getData('text/plain');
  if (local.length) {
    if (local.length > INPUT_COUNT_MAX || local.some(file => file.size > INPUT_FILE_MAX)) throw new Error('До пяти изображений, каждое не больше 5 МБ');
    if (local.some(file => !file.type.startsWith('image/') && !/\.(png|jpe?g|webp|gif)$/i.test(file.name))) throw new Error('Перетащите изображение. Документы можно прикрепить скрепкой.');
    return Promise.all(local.map(async file => ({ name: file.name, bytes: new Uint8Array(await file.arrayBuffer()) })));
  }
  const image = html ? new DOMParser().parseFromString(html, 'text/html').querySelector('img')?.getAttribute('src') : null;
  const url = image || uri.split(/\r?\n/).find(line => line && !line.startsWith('#')) || plain.trim();
  if (!url || !/^(https?:|blob:|data:image\/)/i.test(url)) throw new Error('Перетащите картинку с сайта или файл изображения');
  return [{ url }];
}

export function ChatInputZone({ tabId, inputEpoch, sending, children, style, ...props }: HTMLAttributes<HTMLDivElement> & {
  tabId: string; inputEpoch: string; sending: boolean;
}) {
  const draft = useChatInputs(tabId, sending, inputEpoch), [over, setOver] = useState(false);
  return <DraftInputs.Provider value={draft}>
    <div {...props} className={`ai-chat-drop-zone ${props.className ?? ''}`} style={{ ...style, position: 'relative' }}
      onDragOver={event => {
        if (!Array.from(event.dataTransfer.types).some(type => ['Files', 'text/html', 'text/uri-list'].includes(type))) return;
        event.preventDefault(); event.dataTransfer.dropEffect = sending || draft.busy ? 'none' : 'copy';
        setOver(!sending && !draft.busy);
      }}
      onDragLeave={event => { if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setOver(false); }}
      onDrop={event => {
        setOver(false);
        const data = event.dataTransfer;
        if (!data.files.length && !/<img\b/i.test(data.getData('text/html')) && !data.getData('text/uri-list') && !/^(https?:|blob:|data:image\/)/i.test(data.getData('text/plain'))) return;
        event.preventDefault(); event.stopPropagation();
        if (!sending && !draft.busy) void draft.add(false, () => readDrop(event.dataTransfer));
      }}>
      {children}
      {over && <div style={{ position: 'absolute', inset: 'var(--pad-island)', pointerEvents: 'none',
        border: '2px dashed var(--accent)', borderRadius: 'var(--radius-island)', background: 'var(--surface-solid)',
        display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--text-strong)', fontSize: 'var(--fs-md)' }}>
        Отпустите изображение, чтобы прикрепить
      </div>}
    </div>
  </DraftInputs.Provider>;
}

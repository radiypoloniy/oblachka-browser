import { useEffect, useState } from 'react';
import { FileText, X } from 'lucide-react';
import type { AiInputMeta } from '../../../shared/aiChatInputs';
import { pad, RADIUS, sp } from '../../styles/system';

export function InputPreviews({ files, tabId, remove }: { files: AiInputMeta[]; tabId: string; remove?: (id: string) => void }) {
  return <span style={{ display: 'flex', flexWrap: 'wrap', gap: sp(2), marginBottom: files.length ? sp(2) : 0 }}>
    {files.map(file => <InputPreview key={file.id} file={file} tabId={tabId} remove={remove} />)}
  </span>;
}

function InputPreview({ file, tabId, remove }: { file: AiInputMeta; tabId: string; remove?: (id: string) => void }) {
  const [url, setUrl] = useState<string | null>(null);
  useEffect(() => {
    let alive = true;
    if (file.kind === 'image') void window.aiPanel.inputPreview(tabId, file.id).then(value => { if (alive) setUrl(value); }).catch(() => {});
    return () => { alive = false; };
  }, [file.id, file.kind, tabId]);
  return <span title={`${file.name} · ${(file.size / 1024).toFixed(0)} КБ`} style={{ display: 'inline-flex',
    alignItems: 'center', gap: sp(2), padding: pad(1, 2), border: '1px solid currentColor',
    borderRadius: RADIUS.control, maxWidth: '100%', fontSize: 'var(--fs-xs)' }}>
    {url ? <img src={url} alt={file.name} style={{ width: 48, height: 48, objectFit: 'cover', borderRadius: RADIUS.control }} /> : <FileText size={16} />}
    <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{file.name}</span>
    {remove && <button onClick={() => remove(file.id)} title={`Удалить ${file.name}`} style={{ border: 'none',
      background: 'transparent', color: 'inherit', display: 'flex', padding: 0, cursor: 'pointer' }}><X size={14} /></button>}
  </span>;
}

import { useRef, useState } from 'react';
import { appendContextFiles, parseContextFile, type ImportedContext } from '../../../shared/aiContextImport';
import { btnGhost, InlineError, InlineHint } from './kit';
import { sp } from '../../styles/system';

export function ContextFileFields({ materials, length, onMaterials, onImport }: {
  materials: string; length: number; onMaterials: (text: string) => void; onImport: (preset: ImportedContext) => void;
}) {
  const importPicker = useRef<HTMLInputElement>(null), materialsPicker = useRef<HTMLInputElement>(null);
  const [error, setError] = useState(''), [busy, setBusy] = useState(false);
  async function read(files: File[], wholePreset: boolean) {
    setError(''); setBusy(true);
    try {
      if (files.length > 5 || files.some(file => file.size > 100000 || !/\.(json|md|txt)$/i.test(file.name))) {
        throw new Error('До пяти файлов JSON, MD или TXT, каждый не больше 100 КБ');
      }
      const loaded = await Promise.all(files.map(async file => ({ name: file.name, text: await file.text() })));
      if (wholePreset) onImport(parseContextFile(loaded[0].text));
      else {
        const next = appendContextFiles(materials, loaded);
        if (length - materials.length + next.length > 12000) throw new Error('С файлами набор превышает 12 000 символов. Прикрепите нужный фрагмент.');
        onMaterials(next);
      }
    } catch (reason) { setError(reason instanceof Error ? reason.message : 'Не удалось прочитать файл'); }
    finally { setBusy(false); }
  }
  return <>
    <div style={{ display: 'flex', gap: sp(2), flexWrap: 'wrap' }}>
      <button type="button" style={btnGhost} disabled={busy} onClick={() => importPicker.current?.click()}>Импорт набора JSON</button>
      <button type="button" style={btnGhost} disabled={busy} onClick={() => materialsPicker.current?.click()}>Прикрепить материалы</button>
    </div>
    <input ref={importPicker} type="file" accept=".json" hidden onChange={event => {
      const files = Array.from(event.target.files ?? []); event.target.value = ''; if (files.length) void read(files, true);
    }} />
    <input ref={materialsPicker} type="file" accept=".json,.md,.txt" multiple hidden onChange={event => {
      const files = Array.from(event.target.files ?? []); event.target.value = ''; if (files.length) void read(files, false);
    }} />
    <InlineHint>Файлы добавляются в черновик. Проверьте инструкции и материалы перед сохранением.</InlineHint>
    {error && <InlineError>{error}</InlineError>}
  </>;
}

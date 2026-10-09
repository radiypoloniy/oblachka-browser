import { useEffect, useRef, useState } from 'react';
import { INPUT_COUNT_MAX, type AiInputMeta, type InputResult } from '../../shared/aiChatInputs';

export function useChatInputs(tabId: string, sending: boolean, inputEpoch: string) {
  const [files, setFiles] = useState<AiInputMeta[]>([]);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const activeAdd = useRef(false);
  const lifetime = useRef<AbortController | null>(null), currentFiles = useRef(files);
  currentFiles.current = files;
  useEffect(() => {
    const controller = new AbortController(); lifetime.current = controller;
    setFiles([]); setError(''); setBusy(false); activeAdd.current = false;
    // Черновик принадлежит источнику: переключение не переносит файлы в другую беседу.
    return () => {
      controller.abort();
      currentFiles.current.forEach(file => { void window.aiPanel.removeInput(tabId, file.id); });
    };
  }, [tabId, inputEpoch]);

  async function add(paste = false) {
    if (!tabId || sending || activeAdd.current) return;
    activeAdd.current = true;
    const signal = lifetime.current?.signal;
    if (!signal || signal.aborted) { activeAdd.current = false; return; }
    setBusy(true); setError('');
    let result: InputResult;
    try { result = await (paste ? window.aiPanel.pasteInput(tabId) : window.aiPanel.pickInputs(tabId)); }
    catch { result = { ok: false, error: 'Не удалось прикрепить файл' }; }
    if (signal.aborted) {
      if (result.ok) result.files.forEach(file => { void window.aiPanel.removeInput(tabId, file.id); });
      return;
    }
    setBusy(false); activeAdd.current = false;
    if (!result.ok) { setError(result.error); return; }
    if (currentFiles.current.length + result.files.length > INPUT_COUNT_MAX) {
      result.files.forEach(file => { void window.aiPanel.removeInput(tabId, file.id); });
      setError('Не более пяти вложений в сообщении'); return;
    }
    const next = [...currentFiles.current, ...result.files];
    currentFiles.current = next; setFiles(next);
  }
  function remove(id: string) {
    void window.aiPanel.removeInput(tabId, id);
    setFiles(prev => prev.filter(file => file.id !== id));
  }
  function consumed() {
    // Идентификаторы уже переданы отправке: очистка поля не удаляет вложения истории.
    currentFiles.current = []; setFiles([]); setError('');
  }
  return { files, error, busy, add, remove, consumed };
}

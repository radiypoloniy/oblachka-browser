import { useEffect } from 'react';

/**
 * ⚠️ ПРЕДОХРАНИТЕЛЬ ОТ ДРОПА ФАЙЛА В САМ ИНТЕРФЕЙС. Слой хрома — обычная веб-страница, и по
 * умолчанию Chromium на брошенный файл её ПЕРЕОТКРЫВАЕТ: у нас это означало голое окно без
 * вкладок и адресной строки (а в худшем случае — подмену самого интерфейса браузера файлом).
 *
 * Ни одного места, где такой жест что-то осмысленно значит, в чроме нет: адресная строка
 * обрабатывает дроп сама и до сюда его не пускает (stopPropagation), перетаскивание вкладок
 * живёт на pointer-событиях dnd-kit и HTML5-драга не использует вовсе. Поэтому здесь глухая
 * заглушка, а не разбор случаев.
 */
export function useFileDropGuard(): void {
  useEffect(() => {
    const swallow = (e: DragEvent) => { e.preventDefault(); };
    document.addEventListener('dragover', swallow);
    document.addEventListener('drop', swallow);
    return () => {
      document.removeEventListener('dragover', swallow);
      document.removeEventListener('drop', swallow);
    };
  }, []);
}

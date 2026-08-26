import { useEffect, useRef, useState } from 'react';
import type { DownloadEntry } from '../../shared/ipc';

// Загрузки: список из main плюс три сигнала, которые из него выводятся. Сигналы живут здесь, а не
// у кнопки в тулбаре, потому что считаются из ОДНОГО списка и обязаны меняться вместе с ним.
export function useDownloads() {
  const [downloads, setDownloads] = useState<DownloadEntry[]>([]);

  useEffect(() => {
    void window.oblako.getDownloads().then(setDownloads);
    const unsub = window.oblako.onDownloadsChanged(setDownloads);
    return () => unsub();
  }, []);

  const downloadsActive = downloads.some((d) => d.state === 'progressing');
  // Совокупный прогресс всех идущих загрузок — по БАЙТАМ, а не как среднее процентов: иначе
  // мелкий файл рядом с большим тянул бы шкалу вперёд, хотя работа почти не сдвинулась.
  // null — считать нечего (нечего качать либо ни у одного файла неизвестен размер).
  const downloadsProgress = (() => {
    const live = downloads.filter((d) => d.state === 'progressing' && d.totalBytes > 0);
    if (live.length === 0) return null;
    const total = live.reduce((n, d) => n + d.totalBytes, 0);
    const done = live.reduce((n, d) => n + d.receivedBytes, 0);
    return total > 0 ? Math.min(1, done / total) : null;
  })();
  // Тик «началась новая загрузка» — сигнал для анимации прилёта в кнопку. Считаем по ПОЯВЛЕНИЮ
  // нового id, а не по downloadsActive: тот истинен всё время скачивания, и анимация по нему
  // играла бы один раз на пачку файлов либо повторялась на каждом кадре прогресса.
  const seenDownloadIds = useRef<Set<string> | null>(null);
  const [downloadStartTick, setDownloadStartTick] = useState(0);
  useEffect(() => {
    const ids = new Set(downloads.map((d) => d.id));
    // Первый приход списка — это восстановление с диска, а не новые загрузки: запоминаем молча.
    if (seenDownloadIds.current === null) { seenDownloadIds.current = ids; return; }
    // ⚠️ Ловим ЛЮБОЙ новый id, а не только 'progressing'. Мелкий файл успевает докачаться до
    // того, как список доедет до рендерера, и приходит уже 'completed' — по прежнему условию
    // такая загрузка проходила молча, то есть анимация не играла именно на быстрых файлах.
    const fresh = downloads.some((d) => !seenDownloadIds.current!.has(d.id));
    seenDownloadIds.current = ids;
    if (fresh) setDownloadStartTick((n) => n + 1);
  }, [downloads]);

  return { downloads, downloadsActive, downloadsProgress, downloadStartTick };
}

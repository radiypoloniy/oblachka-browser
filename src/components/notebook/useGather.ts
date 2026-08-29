import { useEffect, useState } from 'react';
import type { GatherHit } from './GatherSheet';

/**
 * Состояние «Собрать материал»: тема → предложенные запросы → правки человека → поиск → находки.
 *
 * ⚠️ Шага ровно два, и между ними — человек. Никакого цикла «модель ищет → читает → ищет ещё»:
 * локальная 4B не планирует на длинном горизонте (см. разбор в electron/NotebookGather.ts).
 */
export function useGather(onAddUrls: (urls: string[]) => void) {
  // Настроен ли поиск. ⚠️ Без него кнопки «Собрать материал» нет ВОВСЕ, а не «есть, но ругается»:
  // предлагать то, чего человек не настраивал, — обещание, которое браузер не сдержит.
  const [available, setAvailable] = useState(false);
  useEffect(() => {
    void window.oblako.getSearxngStatus().then(setAvailable);
    return window.oblako.onSearxngStatusChanged(setAvailable);
  }, []);

  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [step, setStep] = useState<'topic' | 'queries' | 'hits'>('topic');
  const [topic, setTopic] = useState('');
  const [queries, setQueries] = useState<string[]>([]);
  const [hits, setHits] = useState<GatherHit[]>([]);
  const [error, setError] = useState<string | null>(null);

  /** Открыть лист на шаге «тема». Ничего наружу пока не уходит. */
  function open_() {
    setOpen(true); setStep('topic'); setBusy(false); setError(null);
    setTopic(''); setQueries([]); setHits([]);
  }

  /** Тема введена — просим модель предложить запросы. Сеть НЕ трогаем. */
  async function suggest(context: string) {
    setStep('queries'); setBusy(true); setError(null); setQueries([]);
    const r = await window.oblako.suggestNotebookQueries(topic, context);
    setBusy(false);
    if (r.ok && r.queries) setQueries(r.queries);
    else setError(r.error || 'Не удалось подобрать запросы');
  }

  async function search() {
    setBusy(true); setError(null);
    const r = await window.oblako.searchNotebook(queries);
    setBusy(false);
    setStep('hits');
    if (r.ok && r.hits) setHits(r.hits);
    else { setHits([]); setError(r.error || 'Поиск не удался'); }
  }

  function add(urls: string[]) {
    onAddUrls(urls);
    setOpen(false);
  }

  return {
    available, open, busy, step, topic, queries, hits, error,
    setTopic, setQueries, start: open_, suggest, search, add, close: () => setOpen(false),
  };
}

import { useEffect, useRef, useState } from 'react';
import { Clock, Star, FileText, Sparkles } from 'lucide-react';
import type { StuffHit } from '../../shared/ipc';
import { RADIUS, TEXT, sp } from '../styles/system';
import { GroupCap, Row, Rows, type LibrarySummary } from './library/kit';
import { EmptyState } from './EmptyState';

// «Куда я это дел» (AI-IDEAS.md №4) — один вопрос сразу по истории, закладкам и загрузкам.
// Компонент только рисует и зовёт window.oblako.searchStuff: вся логика (сбор кандидатов из трёх
// источников и переранжирование) живёт в main (electron/StuffSearch.ts).
//
// ⚠️ Поиск по ENTER, а не на каждую букву: он ходит к модели, а это секунды, не миллисекунды —
// то же правило, что у умного поиска истории и смыслового Ctrl+F.
//
// ⚠️ Своего поля ввода здесь БОЛЬШЕ НЕТ. Строка одна на всю библиотеку и живёт в оболочке, а
// сюда приходит уже набранный запрос и `runToken` — счётчик нажатий Enter. Раньше полей было
// три (у истории, у закладок и своё здесь), все с разным поведением.

const KIND_ICON = {
  history: Clock,
  bookmark: Star,
  download: FileText,
} as const;

const KIND_LABEL = {
  history: 'История',
  bookmark: 'Закладка',
  download: 'Загрузка',
} as const;

export default function StuffSearchView({ query, runToken, onSummary, onClose }: {
  query: string;
  /** Растёт на каждое нажатие Enter в общей строке — это и есть команда «ищи». */
  runToken: number;
  onSummary: (s: LibrarySummary) => void;
  onClose: () => void;
}) {
  const [hits, setHits] = useState<StuffHit[] | null>(null);
  const [working, setWorking] = useState(false);
  const [degraded, setDegraded] = useState(false);
  // Запрос, по которому получена нынешняя выдача: он и стоит героем в шапке.
  const [asked, setAsked] = useState('');
  // Ответы асинхронные и могут разъехаться с последним нажатием — применяем только последний.
  const seqRef = useRef(0);

  useEffect(() => {
    if (runToken === 0) return;
    const q = query.trim();
    if (!q) return;
    const seq = ++seqRef.current;
    setWorking(true);
    setAsked(q);
    void window.oblako.searchStuff(q)
      .catch(() => ({ hits: [] as StuffHit[], degraded: true }))
      .then((res) => {
        if (seq !== seqRef.current) return;
        setHits(res.hits);
        setDegraded(res.degraded);
        setWorking(false);
      });
    // ⚠️ Зависимость ТОЛЬКО от runToken: реагировать на сам query значило бы ходить к модели на
    // каждую букву — ровно то, ради чего поиск и сделан по Enter.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [runToken]);

  useEffect(() => {
    onSummary({
      // ⚠️ Герой здесь — САМ ЗАПРОС, а не количество: у остальных разделов число отвечает
      // «сколько у меня этого», а тут вопрос задаёт человек, и крупно показать надо его слово —
      // чтобы видеть, что именно искала модель.
      hero: asked || 'Везде',
      heroLabel: working ? 'ищу по истории, закладкам и загрузкам'
        : hits === null ? 'спросите словами — Enter ищет'
          : `${hits.length} ${plural(hits.length, 'находка', 'находки', 'находок')} в истории, закладках и загрузках`,
      // Плиток у поиска нет: сводить нечего, тут вопрос, а не архив.
      facts: [],
    });
  }, [onSummary, asked, working, hits]);

  function open(hit: StuffHit) {
    // ⚠️ Загрузку открываем штатным путём по её id: там уже есть перепроверка «файл ещё на месте»
    // в момент клика. Своим open по пути мы бы эту проверку потеряли.
    if (hit.kind === 'download') { if (hit.downloadId) void window.oblako.openDownloadFile(hit.downloadId); }
    else void window.oblako.createTab(hit.url);
    onClose();
  }

  if (working) {
    return (
      <div style={{ ...TEXT.body, color: 'var(--text-faint)', padding: sp(4) }}>Ищу…</div>
    );
  }

  if (hits === null) {
    return (
      <EmptyState
        icon={<Sparkles size={22} />}
        title="Спросите словами"
        hint="Например «та статья про ипотеку» или «договор, который я скачивал». Enter — искать: вопрос уходит модели, поэтому не на каждую букву."
      />
    );
  }

  if (hits.length === 0) {
    return (
      <EmptyState
        icon={<Sparkles size={22} />}
        title="Ничего не нашлось"
        hint="Попробуйте другими словами — поиск смотрит по заголовкам, адресам и именам файлов."
      />
    );
  }

  return (
    <Rows>
      <GroupCap
        title="Находки"
        // Честно говорим, что модель не участвовала: иначе человек решит, что так она и отобрала.
        note={degraded ? 'по словам — модель не отвечала' : 'порядок по смыслу'}
      />
      {hits.map((hit, i) => {
        const Icon = KIND_ICON[hit.kind];
        return (
          <Row
            key={`${hit.kind}-${hit.url}-${i}`}
            icon={<span style={{
              width: 24, height: 24, flex: 'none', borderRadius: RADIUS.tight,
              display: 'grid', placeItems: 'center', background: 'var(--surface-sunken)',
              color: 'var(--text-muted)',
            }}><Icon size={14} /></span>}
            title={hit.title}
            subtitle={hit.subtitle}
            meta={KIND_LABEL[hit.kind]}
            title2={hit.url}
            onClick={() => open(hit)}
          />
        );
      })}
    </Rows>
  );
}

/** Русское склонение: 1 находка, 2 находки, 5 находок. */
function plural(n: number, one: string, few: string, many: string): string {
  const mod100 = n % 100;
  if (mod100 >= 11 && mod100 <= 14) return many;
  const mod10 = n % 10;
  if (mod10 === 1) return one;
  if (mod10 >= 2 && mod10 <= 4) return few;
  return many;
}

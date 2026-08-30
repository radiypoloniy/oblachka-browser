import { useEffect, useMemo, useState } from 'react';
import type {
  BackfillProgress, CatalogEntry, DownloadProgress, ImportDataType, ImportRunResult,
  ImportSource, InstalledModel,
} from '../../../shared/ipc';
import type { StepKind } from '../Onboarding';

/**
 * Вся машинерия мастера: состояние, подписки, набор шагов и действия.
 *
 * ⚠️ Вынесено из Onboarding.tsx не ради красоты: экран собирал в одной функции пять шагов,
 * четыре независимых источника данных (браузеры, каталог моделей, установленное, прогресс
 * индексации) и навигацию — и любая правка одного шага требовала прочитать всё.
 *
 * ⚠️ Разбор ПОЧЕМУ шаги считаются, а не перечислены, и почему обе долгие работы живут в main,
 * оставлен здесь же, рядом с кодом, — он оплачен живыми случаями.
 */
export function useOnboarding() {
  const [step, setStep] = useState(0);
  const [sources, setSources] = useState<ImportSource[] | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [checked, setChecked] = useState<Set<ImportDataType>>(new Set());
  const [running, setRunning] = useState(false);
  const [report, setReport] = useState<ImportRunResult | null>(null);
  // CSV-путь для паролей прямо в мастере: пароли современного Chrome с диска не переносятся
  // (App-Bound v20), поэтому после отчёта с нулём паролей предлагаем выбрать CSV, не выходя отсюда.
  const [csvBusy, setCsvBusy] = useState(false);
  const [csvMsg, setCsvMsg] = useState('');

  // Модель: каталог и уже установленное. Оба грузим заранее, на слайдах, — как и источники
  // импорта: к своему шагу список обязан быть готов, а не появляться с задержкой.
  const [catalog, setCatalog] = useState<CatalogEntry[] | null>(null);
  const [installed, setInstalled] = useState<InstalledModel[] | null>(null);
  const [dl, setDl] = useState<DownloadProgress | null>(null);
  const [backfill, setBackfill] = useState<BackfillProgress | null>(null);
  const [indexAsked, setIndexAsked] = useState(false);

  // Что предлагаем скачать. ⚠️ Роль назначает КАТАЛОГ (см. shared/ipc.ts::ModelRole), а не этот
  // экран: там же живут замеры и резервы видеопамяти. Наше дело — показать 'recommended', то есть
  // самую лёгкую модель с измеренным качеством, и ничего не придумывать сверх.
  const modelOffer = useMemo(
    () => catalog?.find((e) => e.role === 'recommended') ?? catalog?.find((e) => e.role !== null) ?? null,
    [catalog],
  );
  // Шаг модели не показываем вовсе, если модель уже стоит: человек её не просил, и повторное
  // предложение выглядело бы навязчивым. Каталог ещё не приехал — шага тоже нет, дорисовывать его
  // задним числом посреди мастера незачем.
  // ⚠️ СЧИТАЕМ ТОЛЬКО СКАЧАННЫЕ ('downloaded'). Реестр моделей отдаёт ещё и бандловую из
  // resources/models/gguf с пометкой 'legacy' — она лежит на диске у КАЖДОГО, и по наивной проверке
  // «список непуст» этот шаг не показался бы никогда, то есть ровно на чистой машине, ради которой
  // он и сделан. Бандл — аварийный фолбэк на EuroLLM-1.7B, а не «у человека есть модель».
  const modelStepShown = installed !== null && catalog !== null
    && installed.every((m) => m.source !== 'downloaded');
  // Индексация — ТОЛЬКО если историю действительно перенесли и она непустая: без импорта
  // индексировать нечего, а предлагать работу над пустотой значит просить о бессмысленном.
  const historyImported = (report?.history?.inserted ?? 0) > 0;

  const steps = useMemo<StepKind[]>(() => {
    // ⚠️ ПЕРВЫМ идёт ПЕРЕНОС. Раньше перед ним стояли четыре слайда рассказа, и до дела, ради
    // которого браузер ставят, долистывали не все.
    const out: StepKind[] = ['import'];
    if (modelStepShown) out.push('model');
    if (historyImported) out.push('index');
    // Облик — безусловный: тему и палитру человек всё равно выбирает в первые минуты, а узнать
    // о них было неоткуда.
    out.push('look');
    // ⚠️ Гайд — БЕЗУСЛОВНЫЙ и последний. Соблазн привязать его к загрузке модели («расскажем, пока
    // качается») есть, но привязка означала бы, что человек, отказавшийся от модели, гайда не
    // увидит вовсе — а отказ от модели не должен ничего отнимать. Меняется только рамка разговора:
    // идёт загрузка — «пока качается», не идёт — просто «напоследок».
    out.push('guide');
    return out;
  }, [modelStepShown, historyImported]);

  const kind = steps[step] ?? 'import';
  const importStep = kind === 'import';
  const isLastStep = step >= steps.length - 1;
  // Загрузка ЗАВЕРШИЛАСЬ успешно. Отдельным именем, а не тройным условием в трёх местах: от него
  // зависят и текст в теле шага, и обе кнопки, и разъехаться им нельзя.
  const modelDone = !!dl && !dl.running && !dl.cancelled && !dl.error && dl.receivedBytes > 0;

  // Источники ищем заранее, ещё на слайдах: разбор профилей на диске занимает время, и к
  // последнему шагу список должен быть уже готов, а не появляться с задержкой.
  useEffect(() => {
    let alive = true;
    void window.oblako.listImportSources().then((list) => {
      if (!alive) return;
      setSources(list);
      if (list.length > 0) selectSource(list[0]);
    });
    return () => { alive = false; };
  }, []);

  // Каталог и установленные модели — тем же приёмом «готовим заранее», что и источники импорта.
  useEffect(() => {
    let alive = true;
    void window.oblako.getModelCatalog()
      .then((c) => { if (alive) setCatalog(c); })
      .catch(() => { if (alive) setCatalog([]); }); // не смогли посчитать железо — просто не предлагаем
    void window.oblako.getInstalledModels()
      .then((m) => { if (alive) setInstalled(m); })
      .catch(() => { if (alive) setInstalled([]); });
    return () => { alive = false; };
  }, []);

  // ⚠️ Обе долгие работы идут в MAIN и переживают закрытие этого экрана — в том и смысл. Здесь
  // только подписка на их прогресс, никакой отмены при размонтировании: человек нажал «скачать» и
  // ушёл пользоваться браузером, загрузка обязана продолжиться.
  useEffect(() => window.oblako.onModelDownloadProgress(setDl), []);
  useEffect(() => window.oblako.onHistoryContentBackfillProgress(setBackfill), []);

  const selected = useMemo(() => sources?.find((s) => s.id === selectedId) ?? null, [sources, selectedId]);

  // Стрелки — привычный способ листать презентацию. ⚠️ Назад с последнего шага разрешаем только
  // до отчёта: после переноса «вернуться» значило бы предложить сделать его ещё раз.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      // Вперёд стрелкой — только там, где шаг ничего не требует: на шаге переноса и модели
      // «дальше» это решение, и принимать его случайным нажатием стрелки нельзя.
      if (e.key === 'ArrowRight' && (kind === 'look' || kind === 'guide') && !isLastStep) setStep((s) => s + 1);
      if (e.key === 'ArrowLeft' && step > 0 && !report && !running) setStep((s) => s - 1);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [step, report, running]);

  function selectSource(source: ImportSource) {
    setSelectedId(source.id);
    setChecked(new Set(source.dataTypes));
    setReport(null);
  }

  function toggleType(type: ImportDataType) {
    setChecked((prev) => {
      const next = new Set(prev);
      if (next.has(type)) next.delete(type); else next.add(type);
      return next;
    });
  }

  async function handleRun() {
    if (!selected || checked.size === 0 || running) return;
    setRunning(true);
    setReport(null);
    try {
      const types = selected.dataTypes.filter((t) => checked.has(t));
      setReport(await window.oblako.runImport(selected.id, types));
      setCsvMsg('');
    } finally {
      setRunning(false);
    }
  }

  // Импорт паролей из CSV-экспорта браузера — тот же путь, что в разделе Пароли. Без парольной фразы.
  async function handleCsvImport() {
    if (csvBusy) return;
    setCsvBusy(true); setCsvMsg('');
    const res = await window.oblako.importPasswordsCsv();
    setCsvBusy(false);
    switch (res.status) {
      case 'canceled':          break;
      case 'ok':                setCsvMsg(res.inserted > 0
        ? `Перенесено паролей: ${res.inserted}. Удалите CSV-файл — пароли в нём открытым текстом.`
        : `Ничего не добавлено — все ${res.skipped} записей уже были.`); break;
      case 'empty':             setCsvMsg('В файле не нашлось паролей — это точно CSV-экспорт паролей?'); break;
      case 'read-error':        setCsvMsg('Не удалось прочитать файл.'); break;
      case 'vault-unavailable': setCsvMsg('Хранилище паролей недоступно.'); break;
    }
  }

  function handleDownload() {
    if (!modelOffer) return;
    const m = modelOffer.model;
    // fire-and-forget: startModelDownload — send, не invoke, ошибки приходят через progress.error
    // (тот же вызов, что в ModelsSection.tsx — второй способ скачать модель заводить незачем).
    window.oblako.startModelDownload({
      url: m.url, fileName: m.fileName, label: m.label, expectedSha256: m.expectedSha256,
    });
  }

  function handleIndex() {
    setIndexAsked(true);
    window.oblako.startHistoryContentBackfill();
  }

  return {
    step, setStep, steps, kind, importStep, isLastStep,
    sources, selected, selectedId, checked, running, report,
    csvBusy, csvMsg, catalog, installed, dl, backfill, indexAsked,
    modelOffer, modelDone, historyImported,
    selectSource, toggleType, handleRun, handleCsvImport, handleDownload, handleIndex,
  };
}

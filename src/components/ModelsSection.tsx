import { useEffect, useRef, useState } from 'react';
import { Trash2, AlertTriangle } from 'lucide-react';
import type { InstalledModel, CatalogEntry, CatalogModel, DownloadProgress, DeleteModelResult, HardwareSnapshot, ModelLoadMode } from '../../shared/ipc';
import { OptionList, OptionRow, Segmented, StatusCardSkeleton, btnPrimary, btnGhost, settingsBox,
} from './settings/kit';
import { sp, TEXT, CAPS, RADIUS } from '../styles/system';

function gb(bytes: number): string {
  return (bytes / 1e9).toFixed(1);
}

// reason из ModelRegistry.ts::deleteModel — коды известны (см. её комментарий у DeleteModelResult),
// FS_ERROR несёт динамический текст исключения ФС, остальное — фиксированные строки.
function deleteErrorText(reason: string): string {
  if (reason === 'NOT_FOUND') return 'Модель уже не найдена в реестре (возможно, удалена в другом месте).';
  if (reason === 'LEGACY_NOT_DELETABLE') return 'Эта модель лежит вне папки приложения — удалить её отсюда нельзя.';
  if (reason === 'LAST_MODEL') return 'Нельзя удалить последнюю оставшуюся модель.';
  if (reason.startsWith('FS_ERROR')) return 'Ошибка файловой системы при удалении файла модели.';
  return 'Не удалось удалить модель.';
}

// ⚠️ Подпись роли — обычными словами и без цветного шума. Прежний набор («рекомендуем», «полегче»,
// «помощнее», «слабее», «не поместится» — пять состояний в пяти цветах) требовал сначала выучить
// словарь, а потом ещё догадаться, чем «полегче» отличается от «слабее». Ролей теперь две, и
// каждая говорит, ЗАЧЕМ её брать.
function roleTitle(entry: CatalogEntry): string {
  return entry.role === 'recommended' ? 'Рекомендуем' : 'Помощнее';
}

// Строка требований: сколько качать и сколько нужно видеопамяти. Про контекст в токенах человеку
// знать незачем — это внутренняя единица, из которой ничего не следует для его решения.
// ⚠️ Требование берём готовым из каталога (minVramBytes), а не считаем здесь: в него входят
// резерв под систему и запас движка, которые живут в ModelCatalog.ts. Без них выходит заниженное
// число, и человек с картой впритык скачивает то, что у него не заработает.
function requirementsLine(entry: CatalogEntry): string {
  return `${gb(entry.model.sizeBytes)} ГБ загрузки · нужно ${Math.ceil(entry.minVramBytes / 1024 ** 3)} ГБ видеопамяти`;
}

const groupLabelStyle: React.CSSProperties = { ...CAPS };

// ── Модели: установленные (выбор дефолта, удаление) + каталог для скачивания ──────────────────
// Первая подсекция AI — без хотя бы одной установленной модели остальной AI (перевод/чат/группировка)
// не работает, поэтому она наверху (см. AiSection). electron/ здесь не трогается — вся логика уже
// проброшена через window.oblako.* (заход «проброс model-IPC наружу»), этот файл только рисует.
export default function ModelsSection() {
  const [installed, setInstalled] = useState<InstalledModel[] | null>(null);
  const [defaultModelId, setDefaultModelId] = useState<string | null>(null);
  const [loadedModelId, setLoadedModelId] = useState<string | null>(null);
  const [catalog, setCatalog] = useState<CatalogEntry[] | null>(null);
  const [progress, setProgress] = useState<DownloadProgress | null>(null);
  const [unloading, setUnloading] = useState(false);
  const [hardware, setHardware] = useState<HardwareSnapshot | null>(null);
  const [loadMode, setLoadModeState] = useState<ModelLoadMode | null>(null);

  // Флаг перехода running true→false — по нему решаем, когда перечитать installed/catalog
  // (скачанная модель должна переехать из группы B в группу A без перезагрузки Settings).
  const wasRunningRef = useRef(false);

  const reloadInstalled = () => {
    void window.oblako.getInstalledModels().then(setInstalled);
    void window.oblako.getDefaultModelId().then(setDefaultModelId);
    void window.oblako.getLoadedModelId().then(setLoadedModelId);
  };
  const reloadCatalog = () => { void window.oblako.getModelCatalog().then(setCatalog); };

  useEffect(() => {
    let mounted = true;
    reloadInstalled();
    reloadCatalog();
    // Обычный (кэшированный) снапшот годится для первого показа — свежий пересчёт нужен только
    // после unloadModel() (см. handleUnloadNow), где vramFree заведомо изменился.
    void window.oblako.getHardwareSnapshot().then((s) => { if (mounted) setHardware(s); });
    void window.oblako.getModelLoadMode().then((m) => { if (mounted) setLoadModeState(m); });
    window.oblako.getModelDownloadProgress().then((p) => {
      if (!mounted) return;
      setProgress(p);
      wasRunningRef.current = p.running;
    });
    const unsub = window.oblako.onModelDownloadProgress((p) => {
      if (!mounted) return;
      setProgress(p);
      if (wasRunningRef.current && !p.running) {
        reloadInstalled();
        reloadCatalog();
      }
      wasRunningRef.current = p.running;
    });
    // Модель может загрузиться в VRAM извне (сообщение в AI-панели) без отдельного push-события
    // на этот счёт — getLoadedModelId() чисто pull. Панель и chrome — разные WebContentsView
    // ОДНОГО BrowserWindow, поэтому window.addEventListener('focus') здесь не срабатывает (ОС не
    // считает это сменой окна) — используем уже существующий канал открытия/закрытия панели:
    // закрытие панели — надёжный повод перечитать loadedModelId и честно пересчитанный снапшот VRAM.
    const unsubPanel = window.oblako.onAiPanelStateChanged((open) => {
      if (!mounted || open) return;
      void window.oblako.getLoadedModelId().then((id) => { if (mounted) setLoadedModelId(id); });
      void window.oblako.refreshHardwareSnapshot().then((s) => { if (mounted) setHardware(s); });
    });
    return () => { mounted = false; unsub(); unsubPanel(); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function handleSetDefault(id: string) {
    const res = await window.oblako.setDefaultModel(id);
    // ok:false здесь практически недостижим (id берём из уже установленного списка), но
    // перечитываем состояние в любом случае — реестр остаётся источником истины, не оптимистичный UI.
    void res;
    reloadInstalled();
  }

  async function handleUnloadNow() {
    setUnloading(true);
    await window.oblako.unloadModel();
    setUnloading(false);
    reloadInstalled();
    // Не getHardwareSnapshot() (кэш) — vramFree только что изменился, нужен честный пересчёт,
    // иначе строка состояния памяти покажет старую занятую VRAM.
    void window.oblako.refreshHardwareSnapshot().then(setHardware);
  }

  function handleSetLoadMode(mode: ModelLoadMode) {
    setLoadModeState(mode); // оптимистично — та же схема, что у select(engine) в TranslationEngineSection
    void window.oblako.setModelLoadMode(mode);
  }

  function handleDownload(model: CatalogModel) {
    // fire-and-forget: startModelDownload — send, не invoke. Ошибки придут через progress.error,
    // не через промис (см. shared/ipc.ts::MODEL_DOWNLOAD_START).
    window.oblako.startModelDownload({
      url: model.url, fileName: model.fileName, label: model.label, expectedSha256: model.expectedSha256,
    });
  }

  // ⚠️ Пока список моделей и каталог едут (замерено ~600 мс), блок рисует ту же рамку, что и
  // после загрузки: тот же отступ, та же верхняя линия, тот же заголовок с описанием. Меняется
  // только содержимое ниже. Прежде здесь была строка «Загрузка…» высотой в текст, и раздел
  // подпрыгивал, когда на её место разом вставал весь блок моделей, — это и был видимый рывок
  // при открытии раздела AI (остальные блоки успевают за 150 мс и глазом не ловятся).
  // Заголовок дублируется намеренно: вынести его наружу значило бы разнести один блок по двум
  // местам ради экономии шести строк.
  if (installed === null || catalog === null) {
    return (
      <div style={{
        display: 'flex', flexDirection: 'column', gap: 12,
        paddingTop: 24, marginTop: 4, borderTop: '1px solid var(--divider)',
      }}>
        <div>
          <h3 style={{ margin: 0, ...TEXT.section }}>
            Локальные модели
          </h3>
          <p style={{ margin: `${sp(1)}px 0 0`, ...TEXT.body, color: 'var(--text-faint)' }}>
            Модель для AI-перевода, чата и остальных функций хранится и считается на этом устройстве.
            Без хотя бы одной установленной модели остальные AI-функции не работают.
          </p>
        </div>
        <StatusCardSkeleton />
        <StatusCardSkeleton />
      </div>
    );
  }

  const bySize = (a: { sizeBytes: number }, b: { sizeBytes: number }) => a.sizeBytes - b.sizeBytes;
  const sortedInstalled = [...installed].sort(bySize);

  const installedIds = new Set(installed.map((m) => m.id));
  const notInstalled = catalog.filter((e) => !installedIds.has(e.model.id));
  // Показываем ТОЛЬКО то, что каталог посчитал пригодным для этой видеокарты. Рекомендованная
  // идёт первой независимо от размера: это ответ на вопрос «что взять», а не сортировка по весу.
  const visibleCatalog = notInstalled
    .filter((e) => e.visibleByDefault)
    .sort((a, b) => (a.role === 'recommended' ? -1 : b.role === 'recommended' ? 1 : bySize(a.model, b.model)));

  const loadedModel = installed.find((m) => m.id === loadedModelId) ?? null;
  const defaultModel = installed.find((m) => m.id === defaultModelId) ?? null;
  const diverged = loadedModelId !== null && defaultModelId !== null && loadedModelId !== defaultModelId;

  const downloadRunning = progress?.running ?? false;
  const pct = progress?.totalBytes ? Math.min(100, Math.round((progress.receivedBytes / progress.totalBytes) * 100)) : 0;

  // «Занято видеопамяти» = total − free (Chromium/драйвер/система тоже в этой разнице, не только
  // модель) — намеренно не подписываем как «модель занимает». Оба поля снапшота нужны вместе:
  // асимметрия null у одного при числе у другого не встречается по конструкции HardwareInfo.ts.
  const vramUsedText = hardware && hardware.vramTotalBytes !== null && hardware.vramFreeBytes !== null
    ? `${gb(hardware.vramTotalBytes - hardware.vramFreeBytes)} из ${gb(hardware.vramTotalBytes)} ГБ`
    : null;

  return (
    <div style={{
      display: 'flex', flexDirection: 'column', gap: 12,
      paddingTop: 24, marginTop: 4, borderTop: '1px solid var(--divider)',
    }}>
      <div>
        <h3 style={{ margin: 0, ...TEXT.section }}>
          Локальные модели
        </h3>
        <p style={{ margin: `${sp(1)}px 0 0`, ...TEXT.body, color: 'var(--text-faint)' }}>
          Модель для AI-перевода, чата и остальных функций хранится и считается на этом устройстве.
          Без хотя бы одной установленной модели остальные AI-функции не работают.
        </p>
      </div>

      {/* ── Группа A: установленные ── */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        <div style={groupLabelStyle}>Установленные модели</div>

        {diverged && (
          // ⚠️ Без цветной подложки: статус говорит значком и словом, фон он не красит (закон
          // цвета, разбор — в colors.css у --accent).
          <div style={{
            ...settingsBox,
            display: 'flex', alignItems: 'center', gap: 12, padding: '12px 16px',
            fontSize: 'var(--fs-xs)', color: 'var(--text-body)',
          }}>
            <AlertTriangle size={15} style={{ color: 'var(--warning-500)', flex: 'none' }} />
            <span style={{ flex: 1 }}>
              Сейчас в памяти «{loadedModel?.label ?? loadedModelId}», а активна по умолчанию «{defaultModel?.label ?? defaultModelId}»
              — сменится при следующей загрузке.
            </span>
            <button
              onClick={() => void handleUnloadNow()}
              disabled={unloading}
              style={{ ...btnGhost, opacity: unloading ? 0.6 : 1, flex: 'none' }}
            >
              {unloading ? 'Выгружаю…' : 'Выгрузить сейчас'}
            </button>
          </div>
        )}

        {installed.length === 0 && (
          <div style={{ fontSize: 'var(--fs-xs)', color: 'var(--text-faint)' }}>Нет установленных моделей.</div>
        )}

        {/* ⚠️ Состояние памяти живёт ПОДПИСЬЮ активной строки, а не отдельной плашкой под списком.
            Прежняя плашка была третьим прямоугольником подряд и повторяла то, что и так сказано
            строкой («в памяти»), — а из-за неё же список читался стопкой плит. */}
        <OptionList>
          {sortedInstalled.map((m) => (
            <InstalledModelRow
              key={m.id}
              model={m}
              isDefault={m.id === defaultModelId}
              isLoaded={m.id === loadedModelId}
              memoryNote={m.id === loadedModelId && vramUsedText ? `видеопамять: ${vramUsedText}` : null}
              unloading={unloading}
              onUnload={() => void handleUnloadNow()}
              canDelete={m.source !== 'legacy' && installed.length > 1}
              deleteDisabledReason={
                m.source === 'legacy' ? 'файл вне папки приложения' : installed.length <= 1 ? 'последняя оставшаяся модель' : null
              }
              onSetDefault={() => void handleSetDefault(m.id)}
              onChanged={reloadInstalled}
            />
          ))}
        </OptionList>

        {loadedModelId === null && installed.length > 0 && (
          <div style={{ fontSize: 'var(--fs-xs)', color: 'var(--text-faint)' }}>
            Модель не загружена в память — первый запрос (чат, перевод) займёт около 30 секунд.
          </div>
        )}

        {/* Режим загрузки — когда именно модель поднимается в память (SettingsManager.ts,
            modelLoadMode). Оба варианта явно называют цену размена (память vs время первого
            ответа), пользователь выбирает осознанно, не вслепую. */}
        {loadMode !== null && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginTop: 12 }}>
            {/* Своя подпись группы: без неё выбор висит вплотную к списку моделей и читается как
                его продолжение, а это отдельный вопрос. */}
            <div style={{ ...groupLabelStyle, marginBottom: 4 }}>Когда загружать модель</div>
            {/* ⚠️ Сегменты, а не две строки-карточки: выбор бинарный и короткий, а цена размена
                (память против времени первого ответа) не теряется — она уходит подписью под
                пилюлей, см. Segmented в kit.tsx. */}
            <Segmented
              value={loadMode}
              onChange={(id) => handleSetLoadMode(id)}
              options={[
                { id: 'startup', label: 'При старте браузера', hint: 'Модель готова сразу, занимает ~6 ГБ оперативной памяти постоянно.' },
                { id: 'on-demand', label: 'При первом обращении', hint: 'Экономит память, первый ответ займёт около 30 секунд.' },
              ]}
            />
          </div>
        )}
      </div>

      {/* ── Группа B: доступные для загрузки ── */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginTop: 4 }}>
        <div style={groupLabelStyle}>Доступные для загрузки</div>

        {downloadRunning && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            <div style={{ fontSize: 'var(--fs-xs)', color: 'var(--text-body)' }}>
              Скачиваю {progress?.modelId ?? ''}: {gb(progress?.receivedBytes ?? 0)} из {progress?.totalBytes ? gb(progress.totalBytes) : '?'} ГБ ({pct}%)
            </div>
            <div style={{ height: 6, borderRadius: RADIUS.tight, background: 'var(--surface-hover)', overflow: 'hidden' }}>
              <div style={{
                height: '100%', width: `${pct}%`, background: 'var(--accent)',
                transition: 'width 0.2s ease-out',
              }} />
            </div>
            <button
              onClick={() => window.oblako.cancelModelDownload()}
              style={{ ...btnGhost, alignSelf: 'flex-start' }}
            >
              Отменить
            </button>
          </div>
        )}
        {!downloadRunning && progress?.error && (
          <div style={{ fontSize: 'var(--fs-xs)', color: 'var(--danger-500)' }}>{progress.error}</div>
        )}

        {/* ⚠️ Ни «показать все модели», ни списка того, что не поедет. Каталог сам решает, что
            предложить этой видеокарте (ModelCatalog.ts::assignRoles), и показывается ТОЛЬКО это.
            Раньше здесь была кнопка «показать все» — за ней лежали модели, которые на этом железе
            не работают, и человек имел полное право их скачать, потратив гигабайты впустую. */}
        <OptionList>
          {visibleCatalog.map((entry) => (
            <CatalogRow key={entry.model.id} entry={entry} downloadDisabled={downloadRunning} onDownload={handleDownload} />
          ))}
        </OptionList>

        {visibleCatalog.length === 0 && installed.length > 0 && (
          <div style={{ fontSize: 'var(--fs-xs)', color: 'var(--text-faint)' }}>
            Всё, что подходит вашей видеокарте, уже установлено.
          </div>
        )}

        {/* Честный тупик: на этом железе ни одна модель не заработает как следует. Говорим прямо
            и не предлагаем скачать что-нибудь «хотя бы такое» — браузер без локального AI лучше
            браузера с моделью, которая отвечает мимо. */}
        {visibleCatalog.length === 0 && installed.length === 0 && (
          <div style={{ ...settingsBox, padding: '16px' }}>
            <div style={{ fontSize: 'var(--fs-sm)', fontWeight: 600, color: 'var(--text-strong)' }}>
              Локальный AI на этом устройстве не потянет
            </div>
            <div style={{ fontSize: 'var(--fs-xs)', color: 'var(--text-faint)', marginTop: 4, lineHeight: 1.45 }}>
              Нужна видеокарта минимум с 4 ГБ памяти. Всё остальное — вкладки, блокировка рекламы,
              VPN, пароли — работает как обычно.
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

interface InstalledModelRowProps {
  model: InstalledModel;
  isDefault: boolean;
  isLoaded: boolean;
  /** Что занято видеопамятью — показываем только у той модели, что реально в памяти. */
  memoryNote: string | null;
  unloading: boolean;
  onUnload: () => void;
  canDelete: boolean;
  deleteDisabledReason: string | null;
  onSetDefault: () => void;
  onChanged: () => void;
}

function InstalledModelRow({
  model, isDefault, isLoaded, memoryNote, unloading, onUnload,
  canDelete, deleteDisabledReason, onSetDefault, onChanged,
}: InstalledModelRowProps) {
  // Подтверждение — тот же локальный булев паттерн, что SkillForm (Settings.tsx) — модалок в
  // проекте нет. deleting — отдельный флаг, чтобы двойной клик на «Да» не дал гонку в deleteModel().
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState('');

  async function handleDelete() {
    setDeleting(true);
    setDeleteError('');
    const res: DeleteModelResult = await window.oblako.deleteModel(model.id);
    setDeleting(false);
    setConfirmDelete(false);
    if (!res.ok) setDeleteError(deleteErrorText(res.reason));
    onChanged(); // перечитать списки в любом случае, даже при отказе — реестр мог измениться
  }

  // Подпись собирается из того, что человек спросит по порядку: сколько весит, где лежит (если
  // не у нас), сколько ест видеопамяти прямо сейчас.
  const parts = [`${gb(model.sizeBytes)} ГБ`];
  if (model.source === 'legacy') parts.push('вне папки приложения');
  if (memoryNote) parts.push(memoryNote);

  return (
    <OptionRow
      active={isDefault}
      onClick={onSetDefault}
      title={model.label}
      subtitle={
        <>
          {parts.join(' · ')}
          {deleteError && <span style={{ color: 'var(--danger-500)' }}> · {deleteError}</span>}
        </>
      }
      badge={isDefault ? { text: 'активна', color: 'var(--accent)' } : undefined}
      badge2={isLoaded ? { text: 'в памяти', color: 'var(--dot-local)' } : undefined}
      actions={
        <>
          {/* «Выгрузить» стоит у той строки, к которой относится, а не отдельной плашкой снизу. */}
          {isLoaded && (
            <button
              onClick={onUnload}
              disabled={unloading}
              style={{ ...btnGhost, opacity: unloading ? 0.6 : 1 }}
            >
              {unloading ? 'Выгружаю…' : 'Выгрузить'}
            </button>
          )}
          {confirmDelete ? (
            <>
              <button onClick={() => void handleDelete()} disabled={deleting} style={{ ...btnGhost, color: 'var(--danger-500)', opacity: deleting ? 0.6 : 1 }}>
                {deleting ? 'Удаляю…' : 'Да'}
              </button>
              <button onClick={() => setConfirmDelete(false)} disabled={deleting} style={btnGhost}>Нет</button>
            </>
          ) : (
            <button
              onClick={() => setConfirmDelete(true)}
              disabled={!canDelete}
              title={deleteDisabledReason ?? 'Удалить модель'}
              style={{
                ...btnGhost, color: 'var(--danger-500)',
                opacity: canDelete ? 1 : 0.4,
                display: 'flex', alignItems: 'center', gap: 8,
              }}
            >
              <Trash2 size={14} />
            </button>
          )}
        </>
      }
    />
  );
}

// Карточка модели из каталога.
//
// ⚠️ Порядок строк — это порядок вопросов, которые человек задаёт себе на самом деле: «что взять»
// (роль крупно), «чем она отличается» (одна фраза из наших замеров), «во что мне это встанет»
// (загрузка и видеопамять — мелко, справа от кнопки внимание не отнимает). Название модели —
// самое мелкое: «Qwen3.5 4B» не помогает выбрать, оно нужно только чтобы узнать её потом в списке
// установленных.
function CatalogRow({ entry, downloadDisabled, onDownload }: { entry: CatalogEntry; downloadDisabled: boolean; onDownload: (m: CatalogModel) => void }) {
  const primary = entry.role === 'recommended';
  return (
    <OptionRow
      selectable={false}
      title={`${roleTitle(entry)} · ${entry.model.label}`}
      // ⚠️ Требования — ОТДЕЛЬНОЙ строкой, а не хвостом описания: это ответ на другой вопрос
      // («во что мне это встанет»), и слитый в одну строку он тонул в конце абзаца.
      subtitle={
        <>
          {entry.summary}
          <div style={{ marginTop: 4 }}>{requirementsLine(entry)}</div>
        </>
      }
      // ⚠️ Бейджа «рекомендуем» здесь НЕТ намеренно: роль уже стоит первым словом заголовка
      // (roleTitle), и бейдж повторял её же — на снимке это читалось как заикание.
      actions={
        <button
          onClick={() => onDownload(entry.model)}
          disabled={downloadDisabled}
          style={{
            ...(primary ? btnPrimary : btnGhost),
            opacity: downloadDisabled ? 0.5 : 1,
          }}
        >
          Скачать
        </button>
      }
    />
  );
}

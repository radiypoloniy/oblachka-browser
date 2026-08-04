import { useEffect, useRef, useState } from 'react';
import { Trash2 } from 'lucide-react';
import type { InstalledModel, CatalogEntry, CatalogModel, DownloadProgress, DeleteModelResult, HardwareSnapshot, ModelLoadMode } from '../../shared/ipc';
import { islandPlate } from '../styles/island';
import { EngineOption, btnPrimary, btnGhost } from './settings/kit';

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

const groupLabelStyle: React.CSSProperties = {
  fontSize: 'var(--fs-xs)', fontWeight: 600, letterSpacing: 'var(--ls-caps)',
  textTransform: 'uppercase', color: 'var(--text-faint)',
};

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

  if (installed === null || catalog === null) {
    return <div style={{ color: 'var(--text-faint)', fontSize: 'var(--fs-sm)' }}>Загрузка…</div>;
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
      paddingTop: 20, marginTop: 4, borderTop: '1px solid var(--divider)',
    }}>
      <div>
        <h3 style={{ margin: 0, fontSize: 'var(--fs-sm)', fontWeight: 600, color: 'var(--text-strong)' }}>
          Локальные модели
        </h3>
        <p style={{ margin: '4px 0 0', fontSize: 'var(--fs-xs)', color: 'var(--text-faint)' }}>
          Модель для AI-перевода, чата и остальных функций хранится и считается на этом устройстве.
          Без хотя бы одной установленной модели остальные AI-функции не работают.
        </p>
      </div>

      {/* ── Группа A: установленные ── */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        <div style={groupLabelStyle}>Установленные модели</div>

        {diverged && (
          <div style={{
            display: 'flex', alignItems: 'center', gap: 10, padding: '10px 14px',
            borderRadius: 'var(--radius-sm)',
            background: 'color-mix(in srgb, var(--warning-500) 12%, transparent)',
            color: 'var(--warning-500)', fontSize: 'var(--fs-xs)',
          }}>
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

        {sortedInstalled.map((m) => (
          <InstalledModelRow
            key={m.id}
            model={m}
            isDefault={m.id === defaultModelId}
            isLoaded={m.id === loadedModelId}
            canDelete={m.source !== 'legacy' && installed.length > 1}
            deleteDisabledReason={
              m.source === 'legacy' ? 'файл вне папки приложения' : installed.length <= 1 ? 'последняя оставшаяся модель' : null
            }
            onSetDefault={() => void handleSetDefault(m.id)}
            onChanged={reloadInstalled}
          />
        ))}

        {/* Постоянная строка состояния памяти — видна всегда, не только при расхождении дефолт/загружено. */}
        <div style={{
          display: 'flex', alignItems: 'center', gap: 12, padding: '12px 16px',
          ...islandPlate, borderRadius: 'var(--radius-sm)',
        }}>
          {loadedModelId ? (
            <>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: 'var(--fs-sm)', fontWeight: 600, color: 'var(--text-strong)' }}>
                  В памяти: {loadedModel?.label ?? loadedModelId}
                </div>
                {vramUsedText && (
                  <div style={{ fontSize: 'var(--fs-xs)', color: 'var(--text-faint)', marginTop: 2 }}>
                    занято видеопамяти: {vramUsedText}
                  </div>
                )}
              </div>
              <button
                onClick={() => void handleUnloadNow()}
                disabled={unloading}
                style={{ ...btnGhost, opacity: unloading ? 0.6 : 1, flex: 'none' }}
              >
                {unloading ? 'Выгружаю…' : 'Выгрузить'}
              </button>
            </>
          ) : (
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontSize: 'var(--fs-sm)', fontWeight: 600, color: 'var(--text-strong)' }}>
                Модель не загружена в память
              </div>
              <div style={{ fontSize: 'var(--fs-xs)', color: 'var(--text-faint)', marginTop: 2 }}>
                Первый запрос (чат, перевод) займёт около 30 секунд — модель нужно поднять с диска.
              </div>
            </div>
          )}
        </div>

        {/* Режим загрузки — когда именно модель поднимается в память (SettingsManager.ts,
            modelLoadMode). Оба варианта явно называют цену размена (память vs время первого
            ответа), пользователь выбирает осознанно, не вслепую. */}
        {loadMode !== null && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6, marginTop: 8 }}>
            {/* Своя подпись группы: без неё два варианта висят вплотную к карточке состояния
                памяти и читаются как её продолжение, а это отдельный выбор. */}
            <div style={{ ...groupLabelStyle, marginBottom: 2 }}>Когда загружать модель</div>
            <EngineOption
              active={loadMode === 'startup'}
              onClick={() => handleSetLoadMode('startup')}
              title="При старте браузера"
              subtitle="Модель готова сразу, занимает ~6 ГБ оперативной памяти постоянно."
            />
            <EngineOption
              active={loadMode === 'on-demand'}
              onClick={() => handleSetLoadMode('on-demand')}
              title="При первом обращении к AI"
              subtitle="Экономит память, первый ответ займёт около 30 секунд."
            />
          </div>
        )}
      </div>

      {/* ── Группа B: доступные для загрузки ── */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginTop: 4 }}>
        <div style={groupLabelStyle}>Доступные для загрузки</div>

        {downloadRunning && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            <div style={{ fontSize: 'var(--fs-xs)', color: 'var(--text-body)' }}>
              Скачиваю {progress?.modelId ?? ''}: {gb(progress?.receivedBytes ?? 0)} из {progress?.totalBytes ? gb(progress.totalBytes) : '?'} ГБ ({pct}%)
            </div>
            <div style={{ height: 6, borderRadius: 3, background: 'var(--surface-hover)', overflow: 'hidden' }}>
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
        {visibleCatalog.map((entry) => (
          <CatalogRow key={entry.model.id} entry={entry} downloadDisabled={downloadRunning} onDownload={handleDownload} />
        ))}

        {visibleCatalog.length === 0 && installed.length > 0 && (
          <div style={{ fontSize: 'var(--fs-xs)', color: 'var(--text-faint)' }}>
            Всё, что подходит вашей видеокарте, уже установлено.
          </div>
        )}

        {/* Честный тупик: на этом железе ни одна модель не заработает как следует. Говорим прямо
            и не предлагаем скачать что-нибудь «хотя бы такое» — браузер без локального AI лучше
            браузера с моделью, которая отвечает мимо. */}
        {visibleCatalog.length === 0 && installed.length === 0 && (
          <div style={{ ...islandPlate, borderRadius: 'var(--radius-sm)', padding: '16px 18px' }}>
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
  canDelete: boolean;
  deleteDisabledReason: string | null;
  onSetDefault: () => void;
  onChanged: () => void;
}

function InstalledModelRow({ model, isDefault, isLoaded, canDelete, deleteDisabledReason, onSetDefault, onChanged }: InstalledModelRowProps) {
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

  const subtitle = model.source === 'legacy'
    ? `${gb(model.sizeBytes)} ГБ · вне папки приложения`
    : `${gb(model.sizeBytes)} ГБ`;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
      <div style={{ display: 'flex', gap: 8, alignItems: 'stretch' }}>
        <div style={{ flex: 1, minWidth: 0 }}>
          <EngineOption
            active={isDefault}
            onClick={onSetDefault}
            title={model.label}
            subtitle={subtitle}
            badge={isDefault ? { text: 'активна', color: 'var(--accent)' } : undefined}
            badge2={isLoaded ? { text: 'в памяти', color: 'var(--dot-local)' } : undefined}
          />
        </div>

        {confirmDelete ? (
          <div style={{ display: 'flex', alignItems: 'center', gap: 6, flex: 'none' }}>
            <button onClick={() => void handleDelete()} disabled={deleting} style={{ ...btnGhost, color: 'var(--danger-500)', opacity: deleting ? 0.6 : 1 }}>
              {deleting ? 'Удаляю…' : 'Да'}
            </button>
            <button onClick={() => setConfirmDelete(false)} disabled={deleting} style={btnGhost}>Нет</button>
          </div>
        ) : (
          <button
            onClick={() => setConfirmDelete(true)}
            disabled={!canDelete}
            title={deleteDisabledReason ?? 'Удалить модель'}
            style={{
              ...btnGhost, flex: 'none', color: 'var(--danger-500)',
              opacity: canDelete ? 1 : 0.4,
              display: 'flex', alignItems: 'center', gap: 6,
            }}
          >
            <Trash2 size={14} />
          </button>
        )}
      </div>
      {deleteError && <span style={{ fontSize: 'var(--fs-xs)', color: 'var(--danger-500)' }}>{deleteError}</span>}
    </div>
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
    <div style={{
      ...islandPlate,
      borderRadius: 'var(--radius-sm)',
      padding: '16px 18px',
      display: 'flex', gap: 16, alignItems: 'flex-start', flexWrap: 'wrap',
      // Рекомендованную выделяем контуром акцента, а не заливкой и не цветным бейджем: это тот же
      // приём, что у выбранного варианта в остальных настройках (EngineOption).
      boxShadow: primary ? '0 0 0 1.5px var(--accent) inset' : undefined,
    }}>
      <div style={{ flex: '1 1 240px', minWidth: 0, display: 'flex', flexDirection: 'column', gap: 6 }}>
        <div style={{ display: 'flex', alignItems: 'baseline', gap: 8, flexWrap: 'wrap' }}>
          <span style={{
            fontSize: 'var(--fs-md)', fontWeight: 700,
            color: primary ? 'var(--accent)' : 'var(--text-strong)',
          }}>
            {roleTitle(entry)}
          </span>
          <span style={{ fontSize: 'var(--fs-xs)', color: 'var(--text-faint)' }}>{entry.model.label}</span>
        </div>
        <div style={{ fontSize: 'var(--fs-sm)', color: 'var(--text-body)', lineHeight: 1.45 }}>
          {entry.summary}
        </div>
        <div style={{ fontSize: 'var(--fs-xs)', color: 'var(--text-faint)' }}>
          {requirementsLine(entry)}
        </div>
      </div>
      <button
        onClick={() => onDownload(entry.model)}
        disabled={downloadDisabled}
        style={{
          ...(primary ? btnPrimary : btnGhost),
          flex: 'none', alignSelf: 'center', opacity: downloadDisabled ? 0.5 : 1,
        }}
      >
        Скачать
      </button>
    </div>
  );
}

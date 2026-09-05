import { useEffect, useState } from 'react'
import { AppsMode, wallpaperBackground } from '../components/aiApps'
import { PanelCloseButton, PanelShell } from './parts/PanelShell'
import { useEscapeClose, useWallpaper } from './usePanelShell'

/**
 * Панель лёгкого окна: тот же домашний экран приложений, без чата.
 *
 * ⚠️ Отдельный компонент, а не флаг внутри AiPanel: чат здесь не должен монтироваться вовсе, а
 * условный вызов его хуков запрещён правилами React (и линтером). Так в лёгком окне нет ни одной
 * подписки на каналы беседы и ни одного повода разбудить модель.
 *
 * ⚠️ Приложения при этом ТЕ ЖЕ и настроены одинаково: порядок иконок, скрытые, свои
 * веб-приложения и обои лежат в localStorage, а origin у обеих панелей один (oblako-chrome://).
 * Разное только то, что открыто прямо сейчас, — это состояние живёт в памяти своего окна.
 */
export function AppsPanel() {
  const { wallpaper, selectWallpaper } = useWallpaper()
  useEscapeClose()

  // Просьба открыть приложение снаружи — иконка на рабочем столе новой вкладки этого же окна
  // (см. AiPanelManager.openAiPanelApp). Сбрасывается сразу после обработки, иначе повторный клик
  // по той же иконке ничего бы не делал: значение не изменилось бы.
  const [requestedApp, setRequestedApp] = useState<string | null>(null)
  useEffect(() => window.aiPanel.onOpenApp((appId) => setRequestedApp(appId)), [])

  return (
    <PanelShell wallpaper={wallpaperBackground(wallpaper)}>
      {/* Шапка та же по геометрии, что у полной панели, — только вместо переключателя режимов
          пусто: переключать не на что. */}
      <div style={{
        display: 'flex', alignItems: 'center', gap: 8,
        padding: 'var(--pad-island)', paddingBottom: 0, flexShrink: 0,
      }}>
        <div style={{ flex: 1 }} />
        <PanelCloseButton />
      </div>

      <div style={{ flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column' }}>
        <AppsMode
          wallpaper={wallpaper}
          onSelectWallpaper={selectWallpaper}
          requestedApp={requestedApp}
          onRequestHandled={() => setRequestedApp(null)}
        />
      </div>
    </PanelShell>
  )
}

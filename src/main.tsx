import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import './styles/global.css';

// Окно держится скрытым (show:false в main.ts) до этого сигнала — против белого экрана на старте.
// БЕЗ requestAnimationFrame: окно в этот момент скрыто, Chromium не даёт кадров невидимому
// контенту — rAF не стреляет, и сигнал не уходил (окно показывалось только fallback-таймаутом).
// useEffect стреляет после коммита DOM независимо от видимости; первый кадр Chromium дорисует
// сразу после win.show(), а до него фон уже цвета интерфейса (backgroundColor окна и chromeView).
// StrictMode в dev вызовет эффект дважды — main слушает через ipcMain.once, повтор безвреден.
function ChromeReadySignal() {
  React.useEffect(() => {
    window.oblako.chromeUiReady();
  }, []);
  return null;
}

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
    <ChromeReadySignal />
  </React.StrictMode>,
);

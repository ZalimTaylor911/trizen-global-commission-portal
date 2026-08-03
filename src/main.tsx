import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { HashRouter } from 'react-router-dom';
import App from './App';
import { ThemeProvider } from './context/ThemeContext';
import { applyFavicon } from './components/Logo';
// Bundled rather than fetched: the packaged app runs offline and its CSP
// blocks external hosts, so Google Fonts is not an option.
import '@fontsource/montserrat/400.css';
import '@fontsource/montserrat/500.css';
import '@fontsource/montserrat/600.css';
import '@fontsource/montserrat/700.css';
import '@fontsource/montserrat/800.css';
import './styles/app.css';

// A file dropped anywhere other than a drop target would otherwise make the
// window navigate to it — in Electron that replaces the whole app with the
// file's contents and there is no back button. Swallow strays; the import drop
// zone calls preventDefault itself and handles the ones it wants.
for (const event of ['dragover', 'drop'] as const) {
  window.addEventListener(event, (e) => e.preventDefault());
}

// Swaps the placeholder favicon for the real mark, if one has been added.
applyFavicon();

// HashRouter, not BrowserRouter: the packaged app is loaded from file://, where
// history-based routing has no server to fall back on.
createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <ThemeProvider>
      <HashRouter>
        <App />
      </HashRouter>
    </ThemeProvider>
  </StrictMode>,
);

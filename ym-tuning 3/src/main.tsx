import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import './fonts';
import './styles/app.css';
import { setLocale } from './i18n';
import { SessionProvider } from './state/session';
import { ToastProvider } from './ui/toast';
import { App } from './App';

setLocale('he');

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <ToastProvider>
      <SessionProvider>
        <App />
      </SessionProvider>
    </ToastProvider>
  </StrictMode>,
);

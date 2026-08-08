import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import App from './App';
import { I18nProvider } from './i18n';
import { SessionProvider } from './session';
import { ThemeProvider } from './theme';
import './styles.css';

const container = document.getElementById('root');
if (!container) throw new Error('Missing #root element');

createRoot(container).render(
  <StrictMode>
    <BrowserRouter>
      {/* Both outside the session on purpose: the guest share page and every
          signed-out screen need a language and a theme, and none of them has an
          account to read one from. For somebody signed in, `session.tsx` adopts
          the account's saved pair on top (`ARCHITECTURE.md` §9.1b). */}
      <I18nProvider>
        <ThemeProvider>
          <SessionProvider>
            <App />
          </SessionProvider>
        </ThemeProvider>
      </I18nProvider>
    </BrowserRouter>
  </StrictMode>,
);

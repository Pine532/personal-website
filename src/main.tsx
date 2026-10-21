import { StrictMode } from 'react';
import { flushSync } from 'react-dom';
import { createRoot } from 'react-dom/client';
import App from './App';
import { ErrorBoundary } from './components/ErrorBoundary';
import './styles/fonts.css';
import './styles/base.css';
import './styles/controls.css';
import './styles/hero.css';
import './styles/work.css';
import './styles/about.css';
import './styles/contact.css';
import './styles/light.css';
import './styles/print.css';

const root = createRoot(document.getElementById('root')!);
// Render synchronously. Otherwise the page is still empty when the browser restores the scroll
// position after a reload, and the reader is sent back to the top.
flushSync(() => {
  root.render(
    <StrictMode>
      <ErrorBoundary>
        <App />
      </ErrorBoundary>
    </StrictMode>,
  );
});

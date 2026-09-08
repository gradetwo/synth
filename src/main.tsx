import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';

// Self-hosted fonts keep the PWA fully offline (CJK falls back to the system
// font stack, which is present on every target device).
// Latin-only subsets: CJK falls back to the OS font, so shipping cyrillic and
// latin-ext glyphs would only inflate the offline bundle.
import '@fontsource/space-grotesk/latin-500.css';
import '@fontsource/space-grotesk/latin-600.css';
import '@fontsource/space-grotesk/latin-700.css';
import '@fontsource/ibm-plex-mono/latin-400.css';
import '@fontsource/ibm-plex-mono/latin-500.css';
import '@fontsource/ibm-plex-mono/latin-600.css';
import './styles/gs1.css';

import App from './App';

const root = document.getElementById('root');
if (root) {
  createRoot(root).render(
    <StrictMode>
      <App />
    </StrictMode>,
  );
}

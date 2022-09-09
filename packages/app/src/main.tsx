import '@fontsource/figtree/400.css';
import '@fontsource/figtree/500.css';
import '@fontsource/literata/600.css';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { Demo } from './Demo';
import './styles.css';

const root = document.getElementById('root');
if (root && location.protocol !== 'file:') {
  createRoot(root).render(
    <StrictMode>
      <Demo />
    </StrictMode>,
  );
}

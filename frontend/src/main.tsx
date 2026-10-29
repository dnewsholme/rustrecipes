import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import './index.css';
import App from './App.tsx';

// Register PWA service worker if supported
if ('serviceWorker' in navigator && window.location.protocol.startsWith('http')) {
  window.addEventListener('load', () => {
    const swUrl = './sw.js';
    navigator.serviceWorker
      .register(swUrl)
      .then((reg) => {
        console.debug('PWA ServiceWorker registered with scope:', reg.scope);
      })
      .catch((err) => {
        console.debug('PWA ServiceWorker registration failed:', err);
      });
  });
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);

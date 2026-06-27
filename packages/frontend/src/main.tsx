import React from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App';
import './styles.css';

// 在 Electron 桌面端给 <html> 打标记，CSS 据此开启毛玻璃（浏览器端回退纯色）
if (typeof navigator !== 'undefined' && /Electron/.test(navigator.userAgent)) {
  document.documentElement.classList.add('is-electron');
}

createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);

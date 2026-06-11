import React from 'react';
import ReactDOM from 'react-dom/client';
import { registerSW } from 'virtual:pwa-register';
import App from './App';
import './index.css';

// 新バージョン公開時にService Workerを即時更新し、自動でページを再読み込みする
// （旧キャッシュのアプリが表示され続ける問題への対策）
registerSW({ immediate: true });

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);

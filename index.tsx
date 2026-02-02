
import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import { initWebErrorLogging } from './services/webLogger';

initWebErrorLogging({
  getUserId: () => localStorage.getItem('user_id') || undefined,
});

const rootElement = document.getElementById('root');
if (!rootElement) {
  throw new Error("Could not find root element to mount to");
}

const root = ReactDOM.createRoot(rootElement);
root.render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);

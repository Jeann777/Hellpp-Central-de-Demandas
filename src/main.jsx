import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App.jsx';
import './index.css';

// Polyfill window.storage if not present (uses localStorage)
if (typeof window !== 'undefined' && !window.storage) {
  window.storage = {
    async get(key) {
      try {
        const value = localStorage.getItem(key);
        return value !== null ? { value } : null;
      } catch (err) {
        console.error('Storage get error:', err);
        return null;
      }
    },
    async set(key, value) {
      try {
        localStorage.setItem(key, value);
      } catch (err) {
        console.error('Storage set error:', err);
      }
    },
    async delete(key) {
      try {
        localStorage.removeItem(key);
      } catch (err) {
        console.error('Storage delete error:', err);
      }
    }
  };
}

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);

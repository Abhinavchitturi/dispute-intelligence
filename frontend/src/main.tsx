import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import './index.css';
import { installAuthFetch } from './lib/auth';

installAuthFetch(); // every call to our API carries the signed-in user's token

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);

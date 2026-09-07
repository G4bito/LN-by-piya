import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import './index.css';
import { initFirebase } from './firebase';

// The shared Firebase module owns the Vite configuration and all service instances.
initFirebase();

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);

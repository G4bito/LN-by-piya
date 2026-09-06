import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import './index.css';
import { initFirebase } from './firebase';

// Initialize Firebase if environment variables are provided (Vite: import.meta.env)
if (import.meta.env.VITE_FIREBASE_API_KEY) {
  initFirebase({
    apiKey: import.meta.env.VITE_FIREBASE_API_KEY,
    authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN,
    projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID,
    storageBucket: import.meta.env.VITE_FIREBASE_STORAGE_BUCKET,
    messagingSenderId: import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID,
    appId: import.meta.env.VITE_FIREBASE_APP_ID,
    databaseURL: import.meta.env.VITE_FIREBASE_DATABASE_URL,
    passwordResetContinueUrl: import.meta.env.VITE_PASSWORD_RESET_CONTINUE_URL,
  });
}

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);

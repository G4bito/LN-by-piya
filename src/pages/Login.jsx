import { useRef, useState } from 'react';
import LuxeNailsAuth from './LuxeNailsAuth';
import { signInWithGoogle, signInWithEmail, createAccountWithEmail } from '../firebase';
import { getGoogleAuthErrorMessage } from '../authFlow';

export default function Login({ onAuthSuccess, onAuthStart, onAuthFinish, pendingBooking, errorMessage = '' }) {
  const [loading, setLoading] = useState(false);
  const [loadingMethod, setLoadingMethod] = useState(null);
  const [error, setError] = useState('');
  const authInFlightRef = useRef(false);

  async function handleSubmit({ name, email, password, mode, remember }) {
    if (authInFlightRef.current) return;
    authInFlightRef.current = true;
    setError('');
    setLoading(true);
    setLoadingMethod('form');
    onAuthStart?.();
    const normalizedEmail = email.trim().toLowerCase();

    try {
      let authenticatedUser;
      if (mode === 'signup') {
        authenticatedUser = await createAccountWithEmail(name, normalizedEmail, password, remember);
      } else {
        authenticatedUser = await signInWithEmail(normalizedEmail, password, remember);
      }

      onAuthSuccess?.(authenticatedUser);
    } catch (err) {
      setError(err.message || 'Failed to authenticate. Please try again.');
      onAuthFinish?.();
    } finally {
      authInFlightRef.current = false;
      setLoading(false);
      setLoadingMethod(null);
    }
  }

  async function handleGoogleSignIn(remember) {
    if (authInFlightRef.current) return;
    authInFlightRef.current = true;
    setError('');
    setLoading(true);
    setLoadingMethod('google');
    onAuthStart?.();

    try {
      const user = await signInWithGoogle(remember);

      onAuthSuccess?.(user);
    } catch (err) {
      setError(getGoogleAuthErrorMessage(err));
      onAuthFinish?.();
    } finally {
      authInFlightRef.current = false;
      setLoading(false);
      setLoadingMethod(null);
    }
  }

  return (
    <LuxeNailsAuth
      title=""
      subtitle=""
      onSubmit={handleSubmit}
      onGoogleSignIn={handleGoogleSignIn}
      helperText=""
      errorMessage={error || errorMessage}
      isLoading={loading}
      loadingMethod={loadingMethod}
    />
  );
}

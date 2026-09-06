import { useState } from 'react';
import PasswordRecoveryModal from '../components/PasswordRecoveryModal';

function EyeIcon({ size = 16, visible = false }) {
  return visible ? (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M2 12s3.5-6 10-6 10 6 10 6-3.5 6-10 6S2 12 2 12Z" />
      <circle cx="12" cy="12" r="3" />
    </svg>
  ) : (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M3 3l18 18" />
      <path d="M10.6 10.6A3 3 0 0 0 13.4 13.4" />
      <path d="M9.88 5.08A10.94 10.94 0 0 1 12 5c6.5 0 10 7 10 7a18.75 18.75 0 0 1-2.54 3.12" />
      <path d="M6.53 6.53A18.69 18.69 0 0 0 2 12s3.5 6 10 6a10.95 10.95 0 0 0 4.14-.84" />
    </svg>
  );
}

function GoogleIcon({ size = 18 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 48 48" aria-hidden="true">
      <path fill="#FFC107" d="M43.6 20.5H42V20H24v8h11.3C33.9 32.9 29.4 36 24 36c-6.6 0-12-5.4-12-12s5.4-12 12-12c3.1 0 5.8 1.1 8 3l6-6C34.5 5.5 29.6 3.5 24 3.5 12.7 3.5 3.5 12.7 3.5 24S12.7 44.5 24 44.5 44.5 35.3 44.5 24c0-1.2-.1-2.4-.3-3.5z" />
      <path fill="#FF3D00" d="M6.3 14.7l6.6 4.8C14.6 15.9 18.9 13 24 13c3.1 0 5.8 1.1 8 3l6-6C34.5 5.5 29.6 3.5 24 3.5c-7.6 0-14.1 4.3-17.4 10.6l-.3.6z" />
      <path fill="#4CAF50" d="M24 44.5c5.5 0 10.4-1.9 14.1-5.2l-6.5-5.5c-2 1.4-4.6 2.2-7.6 2.2-5.4 0-9.9-3.1-11.4-7.6l-6.6 5.1C9.8 40.1 16.4 44.5 24 44.5z" />
      <path fill="#1976D2" d="M43.6 20.5H42V20H24v8h11.3c-1 2.8-2.9 5.1-5.3 6.6l6.5 5.5C40.4 37 44.5 31.5 44.5 24c0-1.2-.1-2.4-.3-3.5z" />
    </svg>
  );
}

export default function LuxeNailsAuth({ onSubmit, onGoogleSignIn, title = 'Welcome back', subtitle = '', helperText = '', errorMessage = '', isLoading = false, loadingMethod = null }) {
  const [mode, setMode] = useState('signin');
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [rememberMe, setRememberMe] = useState(true);
  const [error, setError] = useState('');
  const [showPasswordRecovery, setShowPasswordRecovery] = useState(false);
  const isSignUp = mode === 'signup';

  async function handleGoogleClick() {
    setError('');
    if (onGoogleSignIn) {
      await onGoogleSignIn(rememberMe);
    }
  }

  function handleSubmit(event) {
    event.preventDefault();
    setError('');

    const trimmedName = name.trim().replace(/\s+/g, ' ');
    const trimmedEmail = email.trim().toLowerCase();
    const trimmedPassword = password.trim();
    const nameRegex = /^[A-Za-zÀ-ÖØ-öø-ÿ' -]{2,60}$/;
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    const passwordRegex = /^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)(?=.*[^A-Za-z\d]).{8,}$/;

    if (isSignUp && !nameRegex.test(trimmedName)) {
      setError('Please enter a valid name with 2-60 letters.');
      return;
    }

    if (!emailRegex.test(trimmedEmail)) {
      setError('Please enter a valid email address.');
      return;
    }

    if (mode === 'signup' && !passwordRegex.test(trimmedPassword)) {
      setError('Password must be at least 8 characters with upper, lower, number, and symbol.');
      return;
    }

    if (mode === 'signin' && trimmedPassword.length === 0) {
      setError('Please enter your password.');
      return;
    }

    if (onSubmit) {
      onSubmit({ name: trimmedName, email: trimmedEmail, password: trimmedPassword, mode, remember: rememberMe });
    }
  }

  return (
    <section className="auth-shell">
      <div className="auth-orb auth-orb-left" />
      <div className="auth-orb auth-orb-right" />

      <div className="auth-card">
        <div className="auth-brand">
          <div className="brand-mark brand-mark--large">
            <span>LN</span>
          </div>
          <div>
            <p className="brand-title">LUXE NAILS</p>
            <span className="brand-subtitle">BY PIYA</span>
          </div>
        </div>

        <p className="auth-eyebrow">Luxury · Precision · Perfection</p>
        {title ? <h2>{title}</h2> : null}
        {subtitle ? <p className="auth-subtitle">{subtitle}</p> : null}
        {helperText ? <p className="auth-hint">{helperText}</p> : null}

        <form onSubmit={handleSubmit} className="auth-form">
          {isSignUp ? (
            <label className="auth-field">
              <span>Name</span>
              <input
                type="text"
                value={name}
                onChange={(event) => setName(event.target.value.replace(/[^A-Za-zÀ-ÖØ-öø-ÿ' -]/g, ''))}
                placeholder="Your name"
                autoComplete="name"
              />
            </label>
          ) : null}

          <label className="auth-field">
            <span>Email</span>
            <input
              type="email"
              value={email}
              onChange={(event) => setEmail(event.target.value.toLowerCase())}
              placeholder="name@email.com"
              autoComplete="email"
            />
          </label>

          <div className="auth-field">
            <div className="auth-field-heading">
              <label htmlFor="auth-password">Password</label>
              {!isSignUp ? (
                <button
                  type="button"
                  className="auth-forgot-password"
                  onClick={() => setShowPasswordRecovery(true)}
                  disabled={isLoading}
                >
                  Forgot Password?
                </button>
              ) : null}
            </div>
            <div className="auth-password-wrap">
              <input
                id="auth-password"
                type={showPassword ? 'text' : 'password'}
                value={password}
                onChange={(event) => setPassword(event.target.value)}
                placeholder="Enter password"
                autoComplete="current-password"
              />
              <button
                type="button"
                className="auth-eye"
                onClick={() => setShowPassword((value) => !value)}
                aria-label={showPassword ? 'Hide password' : 'Show password'}
              >
                <EyeIcon visible={showPassword} />
              </button>
            </div>
          </div>

          <label className="auth-remember">
            <input type="checkbox" checked={rememberMe} onChange={(event) => setRememberMe(event.target.checked)} />
            Remember me
          </label>

          {error || errorMessage ? <p className="auth-error">{error || errorMessage}</p> : null}

          <button type="submit" className="auth-submit-btn" disabled={isLoading}>
            {loadingMethod === 'form' ? (isSignUp ? 'CREATING ACCOUNT...' : 'SIGNING IN...') : isSignUp ? 'CREATE ACCOUNT' : 'SIGN IN'}
          </button>
        </form>

        <div className="auth-divider">
          <span>or continue with Google</span>
        </div>

        <button type="button" className="auth-google-btn" onClick={handleGoogleClick} disabled={isLoading}>
          <GoogleIcon />
          {loadingMethod === 'google' ? 'Signing in...' : 'Continue with Google'}
        </button>

        <p className="auth-footer-text">
          {isSignUp ? 'Already have an account?' : 'New to LN by piya?'}{' '}
          <button
            type="button"
            className="auth-footer-link"
            onClick={() => {
              setError('');
              setMode(isSignUp ? 'signin' : 'signup');
            }}
          >
            {isSignUp ? 'Sign In' : 'Sign Up'}
          </button>
        </p>
      </div>

      {showPasswordRecovery ? (
        <PasswordRecoveryModal
          initialEmail={email}
          onClose={() => setShowPasswordRecovery(false)}
        />
      ) : null}
    </section>
  );
}

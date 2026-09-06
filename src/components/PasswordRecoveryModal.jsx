import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { requestPasswordResetEmail } from '../firebase';

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const RESEND_COOLDOWN_SECONDS = 60;
const FOCUSABLE_SELECTOR = [
  'button:not([disabled])',
  'input:not([disabled])',
  'a[href]',
  '[tabindex]:not([tabindex="-1"])',
].join(',');

export default function PasswordRecoveryModal({ initialEmail = '', onClose }) {
  const [step, setStep] = useState('email');
  const [email, setEmail] = useState(String(initialEmail || '').trim().toLowerCase());
  const [cooldownSeconds, setCooldownSeconds] = useState(0);
  const [busyAction, setBusyAction] = useState('');
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const dialogRef = useRef(null);
  const emailRef = useRef(null);
  const primaryActionRef = useRef(null);
  const openerRef = useRef(null);
  const requestInFlightRef = useRef(false);

  useEffect(() => {
    openerRef.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const previousOverflow = document.body.style.overflow;
    const previousDocumentOverflow = document.documentElement.style.overflow;
    document.body.style.overflow = 'hidden';
    document.documentElement.style.overflow = 'hidden';

    const handleKeyDown = (event) => {
      if (event.key === 'Escape') {
        onClose?.();
        return;
      }
      if (event.key !== 'Tab' || !dialogRef.current) return;

      const focusable = [...dialogRef.current.querySelectorAll(FOCUSABLE_SELECTOR)];
      if (!focusable.length) {
        event.preventDefault();
        dialogRef.current.focus();
        return;
      }
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (event.shiftKey && (document.activeElement === first || !dialogRef.current.contains(document.activeElement))) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    const focusFrame = window.requestAnimationFrame(() => emailRef.current?.focus());

    return () => {
      window.cancelAnimationFrame(focusFrame);
      window.removeEventListener('keydown', handleKeyDown);
      document.body.style.overflow = previousOverflow;
      document.documentElement.style.overflow = previousDocumentOverflow;
      if (openerRef.current?.isConnected) openerRef.current.focus();
    };
  }, [onClose]);

  useEffect(() => {
    const focusFrame = window.requestAnimationFrame(() => {
      if (step === 'sent') primaryActionRef.current?.focus();
      const scrollable = dialogRef.current?.querySelector('.auth-recovery-body');
      if (scrollable) scrollable.scrollTop = 0;
    });
    return () => window.cancelAnimationFrame(focusFrame);
  }, [step]);

  useEffect(() => {
    if (cooldownSeconds <= 0) return undefined;
    const timer = window.setInterval(() => {
      setCooldownSeconds((current) => Math.max(0, current - 1));
    }, 1000);
    return () => window.clearInterval(timer);
  }, [cooldownSeconds]);

  const closeModal = () => onClose?.();

  const sendResetEmail = async (isResend = false) => {
    if (requestInFlightRef.current) return;
    const normalizedEmail = email.trim().toLowerCase();
    if (!EMAIL_PATTERN.test(normalizedEmail)) {
      setError('Please enter a valid email address.');
      return;
    }

    setError('');
    setNotice('');
    requestInFlightRef.current = true;
    setBusyAction(isResend ? 'resend' : 'send');
    try {
      const result = await requestPasswordResetEmail(normalizedEmail);
      if (result.success !== true) {
        throw new Error("We couldn't complete the request. Please try again.");
      }
      setEmail(normalizedEmail);
      setCooldownSeconds(RESEND_COOLDOWN_SECONDS);
      setNotice(result.message);
      setStep('sent');
    } catch (sendError) {
      console.error('Password reset email could not be requested', {
        code: sendError?.code || 'unknown',
      });
      setError(sendError?.message || "We couldn't complete the request. Please try again.");
    } finally {
      requestInFlightRef.current = false;
      setBusyAction('');
    }
  };

  if (typeof document === 'undefined') return null;

  return createPortal(
    <div
      className="auth-recovery-overlay"
      role="presentation"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) closeModal();
      }}
    >
      <section
        ref={dialogRef}
        className="auth-card auth-recovery-card"
        role="dialog"
        aria-modal="true"
        aria-labelledby="auth-recovery-title"
        tabIndex="-1"
      >
        <button
          type="button"
          className="auth-recovery-close"
          onClick={closeModal}
          aria-label="Close password recovery"
        >
          &#215;
        </button>

        <div className="auth-recovery-body">
          {step === 'email' ? (
            <>
              <p className="auth-eyebrow">Account recovery</p>
              <h2 id="auth-recovery-title">Forgot Password</h2>
              <p className="auth-recovery-copy">
                Enter the email associated with your Luxe Nails account. We&apos;ll send a secure password-reset link.
              </p>
              <form
                className="auth-form"
                onSubmit={(event) => {
                  event.preventDefault();
                  sendResetEmail(false);
                }}
              >
                <label className="auth-field">
                  <span>Email address</span>
                  <input
                    ref={emailRef}
                    type="email"
                    value={email}
                    onChange={(event) => setEmail(event.target.value.toLowerCase())}
                    placeholder="customer@email.com"
                    autoComplete="email"
                  />
                </label>
                {error ? <p className="auth-error" role="alert">{error}</p> : null}
                <div className="auth-recovery-actions">
                  <button
                    type="button"
                    className="auth-recovery-secondary"
                    onClick={closeModal}
                  >
                    Cancel
                  </button>
                  <button type="submit" className="auth-submit-btn" disabled={busyAction === 'send'}>
                    {busyAction === 'send' ? 'Sending...' : 'Send Reset Email'}
                  </button>
                </div>
              </form>
            </>
          ) : null}

          {step === 'sent' ? (
            <div className="auth-recovery-success">
              <span className="auth-recovery-success-icon" aria-hidden="true">&#9993;</span>
              <p className="auth-eyebrow">Account recovery</p>
              <h2 id="auth-recovery-title">Check Your Email or Spam Message</h2>
              <p className="auth-recovery-copy">
                Open the secure Firebase password-reset link in the email, create your new password, then return here to sign in.
              </p>
              {notice ? <p className="auth-recovery-notice" role="status">{notice}</p> : null}
              {error ? <p className="auth-error" role="alert">{error}</p> : null}
              <div className="auth-resend-row">
                <span>Didn&apos;t receive the email?</span>
                <button
                  type="button"
                  className="auth-footer-link"
                  onClick={() => sendResetEmail(true)}
                  disabled={busyAction === 'resend' || cooldownSeconds > 0}
                >
                  {busyAction === 'resend'
                    ? 'Sending...'
                    : cooldownSeconds > 0
                      ? `Resend email in ${cooldownSeconds}s`
                      : 'Resend Email'}
                </button>
              </div>
              <button
                ref={primaryActionRef}
                type="button"
                className="auth-submit-btn"
                onClick={onClose}
              >
                Back to Sign In
              </button>
            </div>
          ) : null}
        </div>
      </section>
    </div>,
    document.body
  );
}

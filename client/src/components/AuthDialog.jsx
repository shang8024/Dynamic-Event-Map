import { useEffect, useState } from 'react';
import { useAuth } from '../contexts/AuthContext';
import { authErrorMessage } from '../services/authSession';
import Modal from './Modal';

export default function AuthDialog({initialMode='signin',reason='',onClose,onAuthenticated}) {
  const {
    user, account, loading, sessionError, verificationSentAt,
    loginWithGoogle, loginWithEmail, registerWithEmail, resetPassword,
    sendVerification, refreshAccount, logout,
  } = useAuth();
  const [mode, setMode] = useState(initialMode);
  const [email, setEmail] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [busy, setBusy] = useState('');
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [now, setNow] = useState(Date.now());

  useEffect(() => {
    if(user) onAuthenticated();
  },[user,onAuthenticated]);

  useEffect(() => {
    if (!verificationSentAt) return;
    setNow(Date.now());
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [verificationSentAt]);

  const switchMode = (nextMode) => {
    setMode(nextMode); setError(''); setNotice('');
    setPassword(''); setConfirmPassword('');
  };
  const pending = Boolean(busy) || loading;
  const resendSeconds = Math.max(0, Math.ceil((verificationSentAt + 60000 - now) / 1000));
  const needsVerification = Boolean(account && !account.emailVerified);
  const title = account
    ? (needsVerification ? 'Verify your email' : 'Finish signing in')
    : mode === 'register' ? 'Create your account' : mode === 'reset' ? 'Reset your password' : 'Welcome back';

  async function run(action, callback) {
    setBusy(action); setError(''); setNotice('');
    try { await callback(); }
    catch (failure) {
      const prefix = failure.verificationAfterSignup ? 'Your account was created, but the verification email could not be sent. ' : '';
      setError(prefix + authErrorMessage(failure));
    } finally { setBusy(''); }
  }

  async function submit(event) {
    event.preventDefault();
    if (pending) return;
    if (mode === 'register' && password !== confirmPassword) {
      setError('The passwords do not match. Please enter them again.'); return;
    }
    await run(mode, async () => {
      if (mode === 'register') {
        const result = await registerWithEmail({ displayName, email, password });
        setNotice(result.nameSaved
          ? 'We sent a verification link to your email. Open it, then return here to continue.'
          : 'Your account was created and a verification email was sent. Your display name could not be saved.');
      } else if (mode === 'reset') {
        await resetPassword(email);
        setNotice('If an account can be reset at that address, you will receive an email with a reset link. Check your inbox and spam folder.');
      } else {
        await loginWithEmail(email, password);
      }
    });
    setPassword(''); setConfirmPassword('');
  }

  return (
    <Modal title={title} onClose={onClose} closeLabel="Close sign-in window" className="auth-dialog">
        <div className="mb-6">
          {reason && <p className="auth-purpose">Sign in to {reason}. We’ll bring you right back.</p>}
          {!account && <p className="text-base-content/70 mt-2 text-sm">
            {mode === 'register' ? 'Save events and keep your plans in one place.'
              : mode === 'reset' ? 'Enter your email and we will help you get back in.'
                : 'Sign in to save events, join the conversation and share your own.'}
          </p>}
        </div>

        {(error || sessionError) && <div role="alert" className="alert alert-error mb-4 text-sm">{error || sessionError}</div>}
        {notice && <div role="status" className="alert alert-info mb-4 text-sm">{notice}</div>}

        {account ? (
          <div className="space-y-4">
            {needsVerification ? (
              <>
                <p className="text-sm leading-relaxed">Check the inbox for <strong className="break-all">{account.email}</strong> and open the verification link. Your email needs to be verified before you can save, comment on or create events.</p>
                <p className="text-base-content/70 text-sm">You can keep browsing while you wait. Check your spam folder if the email has not arrived.</p>
                <button type="button" className="btn btn-primary w-full" disabled={pending} onClick={() => run('verify', async () => {
                  const verified = await refreshAccount();
                  if (!verified) setNotice('Your email is not verified yet. Open the link in your email, then check again.');
                })}>{busy === 'verify' || loading ? 'Checking…' : 'I have verified my email'}</button>
                <button type="button" className="btn btn-outline w-full" disabled={pending || resendSeconds > 0} onClick={() => run('resend', async () => {
                  await sendVerification(); setNotice('A new verification email has been sent.');
                })}>{busy === 'resend' ? 'Sending…' : resendSeconds > 0 ? `Resend email in ${resendSeconds}s` : 'Resend verification email'}</button>
              </>
            ) : (
              <>
                <p className="text-sm">{loading ? 'Loading your account…' : 'Your email is verified. We need to finish connecting your account before you can continue.'}</p>
                <button type="button" className="btn btn-primary w-full" disabled={pending} onClick={() => run('retry', refreshAccount)}>{pending ? 'Please wait…' : 'Try again'}</button>
              </>
            )}
            <button type="button" className="btn btn-ghost w-full" disabled={pending} onClick={() => run('signout', async () => { await logout(); switchMode('signin'); })}>Sign out and use another account</button>
          </div>
        ) : (
          <>
            <form onSubmit={submit} className="space-y-4">
              {mode === 'register' && <label className="form-control block">
                <span className="mb-1 block text-sm font-medium">Display name</span>
                <input className="input input-bordered w-full" name="name" autoComplete="nickname" required maxLength={50} value={displayName} onChange={event => setDisplayName(event.target.value)} disabled={pending} />
              </label>}
              <label className="form-control block">
                <span className="mb-1 block text-sm font-medium">Email</span>
                <input className="input input-bordered w-full" name="email" type="email" inputMode="email" autoComplete="email" autoCapitalize="none" spellCheck={false} required value={email} onChange={event => setEmail(event.target.value)} disabled={pending} />
              </label>
              {mode !== 'reset' && <label className="form-control block">
                <span className="mb-1 block text-sm font-medium">Password</span>
                <input className="input input-bordered w-full" name="password" type="password" autoComplete={mode === 'register' ? 'new-password' : 'current-password'} required minLength={mode === 'register' ? 8 : undefined} value={password} onChange={event => setPassword(event.target.value)} disabled={pending} />
                {mode === 'register' && <span className="text-base-content/60 mt-1 block text-xs">Use at least 8 characters. A longer, unique password is best.</span>}
              </label>}
              {mode === 'register' && <label className="form-control block">
                <span className="mb-1 block text-sm font-medium">Confirm password</span>
                <input className="input input-bordered w-full" name="confirmPassword" type="password" autoComplete="new-password" required minLength={8} value={confirmPassword} onChange={event => setConfirmPassword(event.target.value)} disabled={pending} />
              </label>}
              {mode === 'signin' && <div className="text-right"><button type="button" className="link link-primary text-sm" disabled={pending} onClick={() => switchMode('reset')}>Forgot password?</button></div>}
              <button type="submit" className="btn btn-primary w-full" disabled={pending}>
                {pending ? 'Please wait…' : mode === 'register' ? 'Create account' : mode === 'reset' ? 'Send reset link' : 'Sign in'}
              </button>
            </form>
            {mode !== 'reset' && <>
              <div className="divider text-base-content/50 text-xs">or</div>
              <button type="button" className="btn btn-outline w-full" disabled={pending} onClick={() => run('google', loginWithGoogle)}>
                {busy === 'google' ? 'Opening Google…' : 'Continue with Google'}
              </button>
            </>}
            <div className="mt-6 text-center text-sm">
              {mode === 'signin' ? <>New here? <button type="button" className="link link-primary" disabled={pending} onClick={() => switchMode('register')}>Create an account</button></>
                : <button type="button" className="link link-primary" disabled={pending} onClick={() => switchMode('signin')}>{mode === 'register' ? 'Already have an account? Sign in' : 'Back to sign in'}</button>}
            </div>
          </>
        )}
    </Modal>
  );
}

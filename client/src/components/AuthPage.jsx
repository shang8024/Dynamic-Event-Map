import {useEffect,useRef,useState} from 'react';
import {Link,useLocation,useNavigate,useSearchParams} from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import { authErrorMessage } from '../services/authSession';
import Icon from './Icon';
import {authPath,safeReturnTo,returnWithoutAction,authIntent} from '../services/authNavigation';

export default function AuthPage({initialMode='signin'}) {
  const [search]=useSearchParams(),location=useLocation(),navigate=useNavigate(),heading=useRef(null),warning=useRef(null);
  const returnTo=safeReturnTo(search.get('returnTo')||'/'),reason=(search.get('reason')||'').slice(0,200);
  const {
    user, account, loading, sessionError, verificationSentAt,
    loginWithGoogle, loginWithEmail, registerWithEmail, resetPassword,
    sendVerification, refreshAccount, logout,
  } = useAuth();
  const mode=initialMode;
  const [email,setEmail]=useState(()=>typeof location.state?.email==='string'?location.state.email.slice(0,320):'');
  const [displayName, setDisplayName] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [busy, setBusy] = useState('');
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [now, setNow] = useState(Date.now());
  useEffect(()=>{if(error||sessionError) warning.current?.focus();},[error,sessionError]);

  useEffect(() => {
    if(user) navigate(returnTo,{replace:true,state:{authIntent:authIntent(location.state?.intent,returnTo)}});
  },[user,navigate,returnTo,location.state]);

  useEffect(() => {
    if (!verificationSentAt) return;
    setNow(Date.now());
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [verificationSentAt]);

  const switchMode = (nextMode) => {
    navigate(authPath(nextMode==='reset'?'reset-password':nextMode,reason,returnTo),{state:{intent:location.state?.intent,email}});
    setPassword(''); setConfirmPassword('');
  };
  const pending = Boolean(busy) || loading;
  const resendSeconds = Math.max(0, Math.ceil((verificationSentAt + 60000 - now) / 1000));
  const needsVerification = Boolean(account && !account.emailVerified);
  const title = account
    ? (needsVerification ? 'Verify your email' : 'Finish signing in')
    : mode === 'register' ? 'Create account' : mode === 'reset' ? 'Reset your password' : 'Sign in';
  useEffect(()=>{heading.current?.focus({preventScroll:true});document.title=title+' · Dynamic Event Map';},[title]);

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
    <main className="auth-page">
      <div className="auth-intro"><Link className="auth-back" to={returnWithoutAction(returnTo)}>← Go back</Link>
        <p className="eyebrow">Explore the GTA</p><p className="auth-intro-title">Keep your plans together.</p>
        <p>Find local events, follow the conversations and share something worth going to.</p>
        <ul><li><Icon name="bookmark"/>Save events for later</li><li><Icon name="calendar"/>Keep up with the events you follow</li><li><Icon name="pin"/>Discover more around you</li></ul>
      </div>
      <section className="auth-card" aria-labelledby="auth-page-title"><Link className="auth-mobile-back" to={returnWithoutAction(returnTo)}>← Go back</Link><h1 id="auth-page-title" ref={heading} tabIndex={-1}>{title}</h1>
        <div className="mb-6">
          {reason && <p className="auth-purpose">{mode==='register'?'Create an account':'Sign in'} to {reason}. We’ll bring you right back.</p>}
          {!account && <p className="muted mt-2 text-sm">
            {mode === 'register' ? 'Save events and keep your plans in one place.'
              : mode === 'reset' ? 'Enter your email and we will help you get back in.'
                : 'Sign in to save events, join the conversation and share your own.'}
          </p>}
        </div>

        {(error || sessionError) && <div ref={warning} tabIndex={-1} role="alert" className="form-error mb-4">{error || sessionError}</div>}
        {notice && <div role="status" className="alert alert-info mb-4 text-sm">{notice}</div>}

        {account ? (
          <div className="space-y-4">
            {needsVerification ? (
              <>
                <p className="text-sm leading-relaxed">Check the inbox for <strong className="break-all">{account.email}</strong> and open the verification link. Your email needs to be verified before you can save, comment on or create events.</p>
                <p className="muted text-sm">You can keep browsing while you wait. Check your spam folder if the email has not arrived.</p>
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
              {mode !== 'reset' && <div><label className="form-control block">
                <span className="mb-1 block text-sm font-medium">Password</span>
                <input className="input input-bordered w-full" name="password" type="password" autoComplete={mode === 'register' ? 'new-password' : 'current-password'} aria-describedby={mode==='register'?'signup-password-help':undefined} required minLength={mode === 'register' ? 8 : undefined} value={password} onChange={event => setPassword(event.target.value)} disabled={pending} />
              </label>{mode==='register'&&<p id="signup-password-help" className="muted mt-2 text-xs">Use at least 8 characters. A longer, unique password is best.</p>}</div>}
              {mode === 'register' && <label className="form-control block">
                <span className="mb-1 block text-sm font-medium">Confirm password</span>
                <input className="input input-bordered w-full" name="confirmPassword" type="password" autoComplete="new-password" required minLength={8} value={confirmPassword} onChange={event => setConfirmPassword(event.target.value)} disabled={pending} />
              </label>}
              {mode === 'signin' && <div className="text-right"><Link className="link link-primary text-sm" to={authPath('reset-password',reason,returnTo)} state={{intent:location.state?.intent,email}}>Forgot password?</Link></div>}
              <button type="submit" className="btn btn-primary w-full" disabled={pending}>
                {pending ? 'Please wait…' : mode === 'register' ? 'Create account' : mode === 'reset' ? 'Send reset link' : 'Sign in'}
              </button>
            </form>
            {mode !== 'reset' && <>
              <div className="divider muted text-xs">or</div>
              <button type="button" className="btn btn-outline w-full" disabled={pending} onClick={() => run('google', loginWithGoogle)}>
                {busy === 'google' ? 'Opening Google…' : 'Continue with Google'}
              </button>
            </>}
            <div className="mt-6 text-center text-sm">
              {mode === 'signin' ? <>New here? <Link className="link link-primary" to={authPath('register',reason,returnTo)} state={{intent:location.state?.intent,email}}>Create an account</Link></>
                : <Link className="link link-primary" to={authPath('signin',reason,returnTo)} state={{intent:location.state?.intent,email}}>{mode === 'register' ? 'Already have an account? Sign in' : 'Back to sign in'}</Link>}
            </div>
          </>
        )}
    </section></main>
  );
}

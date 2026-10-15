'use client';
import { useState } from 'react';
import { Eye, EyeOff, Loader2 } from 'lucide-react';
import { getSupabase } from '@/lib/supabase';
import { toLoginEmail } from '@/lib/username';

export default function Login() {
  const [login, setLogin] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  async function signIn(e: React.FormEvent) {
    e.preventDefault();
    setError('');
    setBusy(true);
    const { error } = await getSupabase().auth.signInWithPassword({ email: toLoginEmail(login), password });
    setBusy(false);
    if (error) {
      setError(error.message === 'Invalid login credentials'
        ? 'That username and password don’t match.'
        : error.message);
    }
  }

  return (
    <main className="login-wrap">
      <form className="login" onSubmit={signIn}>
        <div className="login-head">
          <div className="logo" aria-hidden>N</div>
          <h1>Welcome back</h1>
          <p>Sign in to your notebook</p>
        </div>

        <label className="field">
          <span>Username</span>
          <input type="text" autoComplete="username" autoCapitalize="none" autoCorrect="off"
            spellCheck={false} autoFocus value={login}
            onChange={(e) => setLogin(e.target.value)} required
            aria-invalid={!!error} placeholder="Username or email" />
        </label>

        <label className="field">
          <span>Password</span>
          <div className="input-affix">
            <input type={showPassword ? 'text' : 'password'} autoComplete="current-password"
              value={password} onChange={(e) => setPassword(e.target.value)} required
              aria-invalid={!!error} />
            <button type="button" className="affix-btn"
              onClick={() => setShowPassword((s) => !s)}
              aria-label={showPassword ? 'Hide password' : 'Show password'}>
              {showPassword ? <EyeOff size={16} /> : <Eye size={16} />}
            </button>
          </div>
        </label>

        {error && <p className="form-error" role="alert">{error}</p>}

        <button type="submit" className="btn btn-primary btn-block" disabled={busy}>
          {busy ? <><Loader2 size={15} className="spin" /> Signing in…</> : 'Sign in'}
        </button>

        <p className="login-foot">Accounts are created by the notebook’s owner. Ask them for access.</p>
      </form>
    </main>
  );
}

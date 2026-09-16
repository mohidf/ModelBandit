import { useState, type FormEvent } from 'react';
import { Navigate } from 'react-router-dom';
import { signIn, signUp } from '../lib/auth';
import { useAuth } from '../contexts/useAuth';

type Mode = 'signin' | 'signup';

export function LoginPage() {
  const { user } = useAuth();
  const [mode, setMode]         = useState<Mode>('signin');
  const [name, setName]         = useState('');
  const [email, setEmail]       = useState('');
  const [password, setPassword] = useState('');
  const [error, setError]       = useState<string | null>(null);
  const [loading, setLoading]   = useState(false);

  if (user) return <Navigate to="/" replace />;

  function switchMode(next: Mode) {
    setMode(next);
    setError(null);
  }

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setLoading(true);
    try {
      const result = mode === 'signup'
        ? await signUp.email({ name: name.trim() || email.split('@')[0], email, password })
        : await signIn.email({ email, password });
      if (result.error) setError(result.error.message ?? 'Something went wrong.');
    } catch {
      setError('Could not reach the server.');
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="auth-page">
      <div className="auth-card">
        <h1>ModelBandit</h1>
        <p className="muted" style={{ marginTop: 6 }}>
          Sends each prompt to the cheapest model that should handle it, and keeps score of how each one does.
        </p>

        <form onSubmit={handleSubmit}>
          {mode === 'signup' && (
            <div className="field">
              <label htmlFor="name">Name</label>
              <input id="name" type="text" value={name} onChange={e => setName(e.target.value)} autoComplete="name" />
            </div>
          )}
          <div className="field">
            <label htmlFor="email">Email</label>
            <input id="email" type="email" value={email} onChange={e => setEmail(e.target.value)} required autoComplete="email" />
          </div>
          <div className="field">
            <label htmlFor="password">Password</label>
            <input
              id="password"
              type="password"
              value={password}
              onChange={e => setPassword(e.target.value)}
              required
              minLength={8}
              autoComplete={mode === 'signup' ? 'new-password' : 'current-password'}
            />
          </div>

          {error && <div className="error" role="alert">{error}</div>}

          <button type="submit" className="btn btn-primary" disabled={loading}>
            {loading ? 'Working…' : mode === 'signin' ? 'Sign in' : 'Create account'}
          </button>
        </form>

        <p className="muted" style={{ marginTop: 16 }}>
          {mode === 'signin' ? (
            <>No account? <button type="button" onClick={() => switchMode('signup')} style={{ color: 'var(--link)' }}>Create one</button></>
          ) : (
            <>Already have an account? <button type="button" onClick={() => switchMode('signin')} style={{ color: 'var(--link)' }}>Sign in</button></>
          )}
        </p>
      </div>
    </div>
  );
}

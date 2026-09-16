import { useNavigate } from 'react-router-dom';
import { useAuth } from '../contexts/useAuth';

/** Shown once after the first sign-in. */
export function OnboardingPage() {
  const navigate = useNavigate();
  const { clearNewUser } = useAuth();

  function finish(destination: '/settings' | '/') {
    clearNewUser();
    navigate(destination, { replace: true });
  }

  return (
    <div className="auth-page">
      <div className="auth-card">
        <h1>You're in</h1>
        <p className="muted" style={{ marginTop: 8 }}>
          Every model is called through OpenRouter. Add your own OpenRouter key so requests are billed to
          you, or skip this and use the server's key.
        </p>
        <div style={{ display: 'flex', gap: 8, marginTop: 20 }}>
          <button className="btn btn-primary" onClick={() => finish('/settings')}>Add API keys</button>
          <button className="btn" onClick={() => finish('/')}>Skip for now</button>
        </div>
      </div>
    </div>
  );
}

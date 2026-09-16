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
          Without any API keys, prompts go to a single free model on Groq. Add your own OpenAI, Anthropic or
          Together AI key and the router will choose between them per request.
        </p>
        <div style={{ display: 'flex', gap: 8, marginTop: 20 }}>
          <button className="btn btn-primary" onClick={() => finish('/settings')}>Add API keys</button>
          <button className="btn" onClick={() => finish('/')}>Skip for now</button>
        </div>
      </div>
    </div>
  );
}

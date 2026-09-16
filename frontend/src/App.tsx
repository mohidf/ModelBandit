import { useState, useEffect, useCallback } from 'react';
import { BrowserRouter, Routes, Route, Link, NavLink, useNavigate } from 'react-router-dom';
import PromptCard from './components/PromptCard';
import ResponsePanel from './components/ResponsePanel';
import MetricsPanel from './components/MetricsPanel';
import HistoryPanel from './components/HistoryPanel';
import InsightsPanel from './components/InsightsPanel';
import { AuthGuard } from './components/AuthGuard';
import { AuthProvider } from './contexts/AuthContext';
import { useAuth } from './contexts/useAuth';
import { LoginPage } from './pages/LoginPage';
import { OnboardingPage } from './pages/OnboardingPage';
import { SettingsPage } from './pages/SettingsPage';
import { api } from './lib/api';
import type { RouteResponse, HistoryEntry, OptimizationMode } from './types';

type Theme = 'light' | 'dark';

interface HistoryRow { id: string; prompt: string; result: RouteResponse; created_at: string; }

function toEntry(row: HistoryRow): HistoryEntry {
  return { id: row.id, prompt: row.prompt, result: row.result, timestamp: new Date(row.created_at) };
}

function useTheme(): [Theme, () => void] {
  const [theme, setTheme] = useState<Theme>(() => (localStorage.getItem('mr-theme') as Theme | null) ?? 'light');
  useEffect(() => {
    document.documentElement.setAttribute('data-theme', theme);
    localStorage.setItem('mr-theme', theme);
  }, [theme]);
  return [theme, () => setTheme(t => (t === 'dark' ? 'light' : 'dark'))];
}

// Shell ----------------------------------------------------------------------

function TopBar({ historyCount }: { historyCount: number }) {
  const [theme, toggleTheme] = useTheme();
  return (
    <header className="topbar">
      <div className="topbar-inner">
        <Link to="/" className="wordmark">ModelBandit</Link>
        <nav className="topnav" aria-label="Main">
          <NavLink to="/" end>Prompt</NavLink>
          <NavLink to="/history">History{historyCount > 0 ? ` (${historyCount})` : ''}</NavLink>
          <NavLink to="/performance">Performance</NavLink>
          <NavLink to="/metrics">Metrics</NavLink>
        </nav>
        <div className="topbar-right">
          <Link to="/settings" className="icon-btn" aria-label="Settings" title="Settings">
            <svg width="16" height="16" fill="none" stroke="currentColor" strokeWidth="1.8" viewBox="0 0 24 24" aria-hidden="true">
              <circle cx="12" cy="12" r="3" />
              <path strokeLinecap="round" d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3h.1a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8v.1a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z" />
            </svg>
          </Link>
          <button className="icon-btn" onClick={toggleTheme} aria-label={theme === 'dark' ? 'Use light theme' : 'Use dark theme'} title="Toggle theme">
            {theme === 'dark' ? (
              <svg width="16" height="16" fill="none" stroke="currentColor" strokeWidth="1.8" viewBox="0 0 24 24" aria-hidden="true">
                <circle cx="12" cy="12" r="4" />
                <path strokeLinecap="round" d="M12 2v2m0 16v2M4.9 4.9l1.4 1.4m11.4 11.4l1.4 1.4M2 12h2m16 0h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4" />
              </svg>
            ) : (
              <svg width="16" height="16" fill="none" stroke="currentColor" strokeWidth="1.8" viewBox="0 0 24 24" aria-hidden="true">
                <path strokeLinecap="round" strokeLinejoin="round" d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8z" />
              </svg>
            )}
          </button>
        </div>
      </div>
    </header>
  );
}

// Prompt page ----------------------------------------------------------------

interface PromptPageProps {
  onRouted: (entry: HistoryEntry) => void;
}

function PromptPage({ onRouted }: PromptPageProps) {
  const [result,  setResult]  = useState<RouteResponse | null>(null);
  const [error,   setError]   = useState<string | null>(null);
  const [noKeys,  setNoKeys]  = useState(false);
  const [loading, setLoading] = useState(false);

  async function handleSubmit(prompt: string, options: { maxTokens?: number; optimizationMode: OptimizationMode }) {
    setLoading(true);
    setError(null);
    setNoKeys(false);
    try {
      const res  = await api('/route', { method: 'POST', body: JSON.stringify({ prompt, ...options }) });
      const body = await res.json();

      if (!res.ok) {
        if (body.error === 'NO_KEYS') setNoKeys(true);
        else setError(body.message ?? body.error ?? `Request failed (${res.status}).`);
        setResult(null);
        return;
      }

      const routed = body as RouteResponse;
      setResult(routed);

      // Save to history; a failure here is not worth interrupting the user for.
      try {
        const saved = await api('/history', { method: 'POST', body: JSON.stringify({ prompt, result: routed }) });
        if (saved.ok) {
          const { entry } = await saved.json() as { entry: HistoryRow };
          onRouted(toEntry(entry));
        }
      } catch { /* ignore */ }
    } catch {
      setError('Could not reach the backend. Is it running?');
      setResult(null);
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="page stack">
      <PromptCard onSubmit={handleSubmit} loading={loading} />

      {result?.freeTier && (
        <p className="note">
          You have no API keys saved, so this ran on Groq's free tier with a single fixed model.
          <Link to="/settings"> Add a key</Link> to get routing across OpenRouter, OpenAI and Anthropic.
        </p>
      )}

      {noKeys && (
        <p className="note">
          No API keys are saved for your account and the server has no free-tier key configured.
          <Link to="/settings"> Add a key in Settings</Link> to start routing.
        </p>
      )}

      <ResponsePanel result={result} error={error} loading={loading} />
    </div>
  );
}

// Main app -------------------------------------------------------------------

function MainApp() {
  const { isNewUser } = useAuth();
  const navigate = useNavigate();
  const [history, setHistory] = useState<HistoryEntry[]>([]);

  useEffect(() => {
    if (isNewUser) navigate('/onboarding', { replace: true });
  }, [isNewUser, navigate]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await api('/history');
        if (!res.ok) return;
        const body = await res.json() as { history: HistoryRow[] };
        if (!cancelled) setHistory(body.history.map(toEntry));
      } catch { /* history is optional */ }
    })();
    return () => { cancelled = true; };
  }, []);

  const addEntry = useCallback((entry: HistoryEntry) => {
    setHistory(prev => [entry, ...prev].slice(0, 20));
  }, []);

  return (
    <>
      <TopBar historyCount={history.length} />
      <main>
        <Routes>
          <Route path="/"            element={<PromptPage onRouted={addEntry} />} />
          <Route path="/history"     element={<div className="page"><HistoryPanel history={history} /></div>} />
          <Route path="/performance" element={<div className="page"><InsightsPanel /></div>} />
          <Route path="/metrics"     element={<div className="page"><MetricsPanel /></div>} />
        </Routes>
      </main>
    </>
  );
}

export default function App() {
  return (
    <BrowserRouter>
      <AuthProvider>
        <Routes>
          <Route path="/login"      element={<LoginPage />} />
          <Route path="/onboarding" element={<AuthGuard><OnboardingPage /></AuthGuard>} />
          <Route path="/settings"   element={<AuthGuard><SettingsPage /></AuthGuard>} />
          <Route path="/*"          element={<AuthGuard><MainApp /></AuthGuard>} />
        </Routes>
      </AuthProvider>
    </BrowserRouter>
  );
}

import { useState, useEffect, useCallback } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../lib/api';
import { useAuth } from '../contexts/useAuth';

interface StoredKey { provider: string; maskedKey: string; updatedAt: string; }

interface RowState { value: string; busy: boolean; message: string | null; failed: boolean; }

const PROVIDERS: { id: string; label: string; note: string }[] = [
  { id: 'openrouter', label: 'OpenRouter', note: 'One key for every model the router can pick: Llama, Qwen, DeepSeek, GPT-4o and Claude.' },
];

const EMPTY: RowState = { value: '', busy: false, message: null, failed: false };

function KeyRow({ id, label, note, saved, onChange }: {
  id: string; label: string; note: string; saved: StoredKey | undefined; onChange: () => void;
}) {
  const [state, setState] = useState<RowState>(EMPTY);

  async function save() {
    if (!state.value.trim()) return;
    setState(s => ({ ...s, busy: true, message: null, failed: false }));
    try {
      const res  = await api('/keys', { method: 'POST', body: JSON.stringify({ provider: id, apiKey: state.value.trim() }) });
      const body = await res.json();
      if (!res.ok) { setState(s => ({ ...s, busy: false, failed: true, message: body.error ?? 'Could not save.' })); return; }
      setState({ value: '', busy: false, failed: false, message: 'Saved.' });
      onChange();
    } catch {
      setState(s => ({ ...s, busy: false, failed: true, message: 'Could not reach the server.' }));
    }
  }

  async function remove() {
    setState(s => ({ ...s, busy: true, message: null, failed: false }));
    try {
      const res = await api(`/keys/${id}`, { method: 'DELETE' });
      if (!res.ok) { setState(s => ({ ...s, busy: false, failed: true, message: 'Could not remove.' })); return; }
      setState({ value: '', busy: false, failed: false, message: 'Removed.' });
      onChange();
    } catch {
      setState(s => ({ ...s, busy: false, failed: true, message: 'Could not reach the server.' }));
    }
  }

  return (
    <div className="box-body" style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
      <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: 12 }}>
        <div>
          <h3>{label} {saved && <span className="ok" style={{ fontWeight: 400, fontSize: 12.5 }}>key saved</span>}</h3>
          <p className="muted" style={{ fontSize: 13 }}>{note}</p>
        </div>
      </div>
      <div style={{ display: 'flex', gap: 8 }}>
        <input
          type="password"
          value={state.value}
          onChange={e => setState(s => ({ ...s, value: e.target.value, message: null }))}
          placeholder={saved ? 'Paste a new key to replace the saved one' : 'Paste your API key'}
          aria-label={`${label} API key`}
          autoComplete="off"
          spellCheck={false}
          style={{ fontFamily: 'var(--mono)', fontSize: 13 }}
        />
        <button className="btn" onClick={save} disabled={state.busy || !state.value.trim()}>Save</button>
        {saved && <button className="btn btn-danger" onClick={remove} disabled={state.busy}>Remove</button>}
      </div>
      {state.message && (
        <p role={state.failed ? 'alert' : 'status'} className={state.failed ? 'error' : 'ok'} style={{ fontSize: 13, padding: state.failed ? undefined : 0, border: state.failed ? undefined : 'none' }}>
          {state.message}
        </p>
      )}
    </div>
  );
}

export function SettingsPage() {
  const { signOut, user } = useAuth();
  const [keys, setKeys]           = useState<StoredKey[]>([]);
  const [loadError, setLoadError] = useState<string | null>(null);

  const [version, setVersion]     = useState(0);

  // Re-fetch whenever a row saves or removes a key.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await api('/keys');
        if (cancelled) return;
        if (!res.ok) { setLoadError('Could not load your saved keys.'); return; }
        const body = await res.json() as { keys: StoredKey[] };
        if (cancelled) return;
        setKeys(body.keys);
        setLoadError(null);
      } catch {
        if (!cancelled) setLoadError('Could not reach the server.');
      }
    })();
    return () => { cancelled = true; };
  }, [version]);

  const refresh = useCallback(() => setVersion(v => v + 1), []);

  return (
    <div className="page page-narrow">
      <p style={{ marginBottom: 16 }}><Link to="/">← Back</Link></p>

      <div className="page-head">
        <h1>Settings</h1>
        <button
          className="btn btn-sm"
          onClick={() => signOut().catch(e => setLoadError(e instanceof Error ? e.message : 'Sign out failed.'))}
        >
          Sign out{user?.email ? ` (${user.email})` : ''}
        </button>
      </div>
      <p className="page-intro">
        Your key is stored against your account and only ever sent to OpenRouter. The server never returns
        it to the browser once saved. Without one, requests use the server's own key.
      </p>

      {loadError && <div className="error" role="alert" style={{ marginBottom: 16 }}>{loadError}</div>}

      <div className="box list">
        {PROVIDERS.map(p => (
          <KeyRow key={p.id} {...p} saved={keys.find(k => k.provider === p.id)} onChange={refresh} />
        ))}
      </div>
    </div>
  );
}

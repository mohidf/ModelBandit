import { useState, useEffect, useCallback } from 'react';
import type { MetricsSnapshot } from '../types';
import { modelDisplayName } from '../utils/modelDisplay';
import { ms, usd } from '../utils/labels';

function Stat({ k, v }: { k: string; v: string }) {
  return (
    <div className="stat">
      <div className="k">{k}</div>
      <div className="v">{v}</div>
    </div>
  );
}

export default function MetricsPanel() {
  const [data, setData]       = useState<MetricsSnapshot | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError]     = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch('/api/metrics');
      if (!res.ok) throw new Error(`Server returned ${res.status}`);
      setData(await res.json() as MetricsSnapshot);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not load metrics.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  const models = data ? Object.entries(data.perModel).sort((a, b) => b[1].calls - a[1].calls) : [];

  return (
    <div>
      <div className="page-head">
        <h1>Metrics</h1>
        <button className="btn btn-sm" onClick={() => void load()} disabled={loading}>
          {loading ? 'Loading…' : 'Refresh'}
        </button>
      </div>
      <p className="page-intro">
        Totals for every request since the backend last started. These live in memory, so a restart resets them.
      </p>

      {error && <div className="error" role="alert">{error}</div>}

      {data && (
        <div className="stack">
          <div className="stats">
            <Stat k="Requests"        v={data.totalRequests.toLocaleString()} />
            <Stat k="Escalated"       v={`${data.escalationRatePercent}%`} />
            <Stat k="Average time"    v={ms(data.averageLatencyMs)} />
            <Stat k="Tokens"          v={data.totalTokens.toLocaleString()} />
            <Stat k="Estimated cost"  v={usd(data.totalEstimatedCostUsd)} />
          </div>

          <div className="box">
            <div className="box-head"><h2>By model</h2></div>
            {models.length === 0 ? (
              <p className="muted box-body">No model calls yet.</p>
            ) : (
              <div className="table-wrap">
                <table className="data">
                  <thead>
                    <tr>
                      <th>Model</th>
                      <th className="r">Calls</th>
                      <th className="r">Average time</th>
                      <th className="r">Tokens</th>
                      <th className="r">Cost</th>
                    </tr>
                  </thead>
                  <tbody>
                    {models.map(([id, m]) => (
                      <tr key={id}>
                        <td className="name">{modelDisplayName(id)} <span className="faint" style={{ fontWeight: 400 }}>{id}</span></td>
                        <td className="r">{m.calls.toLocaleString()}</td>
                        <td className="r">{ms(m.averageLatencyMs)}</td>
                        <td className="r">{m.totalTokens.toLocaleString()}</td>
                        <td className="r">{usd(m.totalCostUsd)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

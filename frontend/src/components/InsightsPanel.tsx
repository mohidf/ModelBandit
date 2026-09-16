import { useState, useEffect, useCallback } from 'react';
import type { InsightsResponse, TaskInsight, TaskDomain } from '../types';
import { ALL_DOMAINS } from '../types';
import { modelDisplayName } from '../utils/modelDisplay';
import { DOMAIN_LABEL, TIER_LABEL, pct, ms, usd } from '../utils/labels';

function DomainTable({ domain, insight }: { domain: TaskDomain; insight: TaskInsight }) {
  const requests = insight.all.reduce((s, x) => s + x.totalRequests, 0);

  return (
    <div className="box">
      <div className="box-head">
        <h2>{DOMAIN_LABEL[domain]}</h2>
        <span className="muted" style={{ fontSize: 12.5 }}>
          {requests === 0 ? 'no requests yet' : `${requests} request${requests === 1 ? '' : 's'}`}
        </span>
      </div>
      {insight.all.length > 0 && (
        <div className="table-wrap">
          <table className="data">
            <thead>
              <tr>
                <th>Model</th>
                <th>Tier</th>
                <th className="r">Quality</th>
                <th className="r">Latency</th>
                <th className="r">Cost</th>
                <th className="r">Escalated</th>
                <th className="r">Requests</th>
                <th className="r">Score</th>
              </tr>
            </thead>
            <tbody>
              {insight.all.map((s, i) => (
                <tr key={s.modelId} className={i === 0 ? 'chosen' : undefined}>
                  <td className="name">{modelDisplayName(s.modelId)}</td>
                  <td>{TIER_LABEL[s.tier]}</td>
                  <td className="r">{pct(s.averageConfidence)}</td>
                  <td className="r">{ms(s.averageLatencyMs)}</td>
                  <td className="r">{usd(s.averageCostUsd)}</td>
                  <td className="r">{pct(s.escalationRate)}</td>
                  <td className="r">{s.totalRequests}</td>
                  <td className="r">{s.score.toFixed(2)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

export default function InsightsPanel() {
  const [insights, setInsights] = useState<InsightsResponse | null>(null);
  const [loading, setLoading]   = useState(true);
  const [error, setError]       = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res  = await fetch('/api/performance');
      const body = await res.json();
      if (!res.ok) setError(body.error ?? `Server returned ${res.status}`);
      else setInsights(body as InsightsResponse);
    } catch {
      setError('Could not reach the backend.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  const withData    = ALL_DOMAINS.filter(d => (insights?.byTaskType[d]?.all.length ?? 0) > 0);
  const withoutData = ALL_DOMAINS.filter(d => (insights?.byTaskType[d]?.all.length ?? 0) === 0);

  return (
    <div>
      <div className="page-head">
        <h1>Model performance</h1>
        <button className="btn btn-sm" onClick={() => void load()} disabled={loading}>
          {loading ? 'Loading…' : 'Refresh'}
        </button>
      </div>
      <p className="page-intro">
        What the router has learned about each model per task type. Numbers are running averages
        (exponential moving average) updated after every call, and the top row is what it would pick next.
        {insights && ` ${Math.round(insights.epsilon * 100)}% of requests ignore this and try a random model instead.`}
      </p>

      {error && <div className="error" role="alert">{error}</div>}

      {insights && (
        <div className="stack">
          {withData.map(d => (
            <DomainTable key={d} domain={d} insight={insights.byTaskType[d]} />
          ))}
          {withoutData.length > 0 && (
            <p className="muted">
              No data yet for: {withoutData.map(d => DOMAIN_LABEL[d]).join(', ')}.
            </p>
          )}
        </div>
      )}
    </div>
  );
}

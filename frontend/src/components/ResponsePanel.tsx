import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import rehypeHighlight from 'rehype-highlight';
import type { RouteResponse, EvaluatedOption } from '../types';
import { modelDisplayName } from '../utils/modelDisplay';
import { DOMAIN_LABEL, COMPLEXITY_LABEL, TIER_LABEL, providerLabel, pct, ms, usd } from '../utils/labels';

interface Props {
  result: RouteResponse | null;
  error: string | null;
  loading: boolean;
}

/** One or two sentences saying what the router did and why. */
function decisionSummary(r: RouteResponse): string {
  const { classification: c, initialModel: m, strategyMode } = r;
  const what = `Classified as ${DOMAIN_LABEL[c.domain].toLowerCase()}, ${COMPLEXITY_LABEL[c.complexity]} complexity, ${pct(c.confidence)} confident.`;

  const target = `${modelDisplayName(m.model)} (${TIER_LABEL[m.tier]} tier, via ${providerLabel(m.provider)})`;
  const why =
    strategyMode === 'exploitation' ? `It had the best score on past ${DOMAIN_LABEL[c.domain].toLowerCase()} requests.` :
    strategyMode === 'exploration'  ? `This was a random exploration pick, which happens on 10% of requests so the router keeps learning.` :
                                      `There was no performance history for this task type yet, so the static routing table was used.`;

  return `${what} Sent to ${target}. ${why}`;
}

function OptionsTable({ options, chosen }: { options: EvaluatedOption[]; chosen: string | null }) {
  return (
    <div className="box">
      <div className="box-head">
        <h2>Models considered</h2>
        <span className="muted" style={{ fontSize: 12.5 }}>
          Score = weighted quality minus cost, latency and escalation penalties. Higher is better.
        </span>
      </div>
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
            {options.map(o => (
              <tr key={o.modelId} className={o.modelId === chosen ? 'chosen' : undefined}>
                <td className="name">{modelDisplayName(o.modelId)}{o.modelId === chosen && <span className="muted"> (chosen)</span>}</td>
                <td>{TIER_LABEL[o.tier]}</td>
                <td className="r">{pct(o.averageConfidence)}</td>
                <td className="r">{ms(o.averageLatencyMs)}</td>
                <td className="r">{usd(o.averageCostUsd)}</td>
                <td className="r">{pct(o.escalationRate)}</td>
                <td className="r">{o.totalRequests}</td>
                <td className="r">{o.score.toFixed(2)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

export default function ResponsePanel({ result, error, loading }: Props) {
  if (loading) {
    return <p className="muted">Classifying the prompt and waiting on the model…</p>;
  }

  if (error) {
    return <div className="error" role="alert">{error}</div>;
  }

  if (!result) return null;

  const { finalModel, initialModel, escalated, evaluatedOptions, totalCostUsd, latencyMs, strategyMode } = result;
  const chosen = strategyMode === 'exploitation' ? initialModel.model : null;

  return (
    <div className="stack">
      <div className="box">
        <div className="box-body">
          <p>{decisionSummary(result)}</p>
          {escalated && (
            <p className="note" style={{ marginTop: 10 }}>
              Classifier confidence was below the threshold, so the request was run again on{' '}
              {modelDisplayName(finalModel.model)} ({providerLabel(finalModel.provider)}, {TIER_LABEL[finalModel.tier]} tier).
              Both calls are counted in the cost below.
            </p>
          )}
          <dl className="facts" style={{ marginTop: 12 }}>
            <dt>Answered by</dt><dd>{modelDisplayName(finalModel.model)} <span className="muted">({finalModel.model})</span></dd>
            <dt>Time</dt><dd className="num">{ms(latencyMs)}</dd>
            <dt>Cost</dt><dd className="num">{usd(totalCostUsd)}</dd>
          </dl>
        </div>
      </div>

      <div className="box">
        <div className="box-head"><h2>Response</h2></div>
        <div className="box-body prose">
          <ReactMarkdown remarkPlugins={[remarkGfm]} rehypePlugins={[rehypeHighlight]}>
            {result.response}
          </ReactMarkdown>
        </div>
      </div>

      {evaluatedOptions.length > 0 && <OptionsTable options={evaluatedOptions} chosen={chosen} />}
    </div>
  );
}

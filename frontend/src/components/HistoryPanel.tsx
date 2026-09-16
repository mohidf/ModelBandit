import { useState } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import rehypeHighlight from 'rehype-highlight';
import type { HistoryEntry } from '../types';
import { modelDisplayName } from '../utils/modelDisplay';
import { DOMAIN_LABEL, TIER_LABEL, providerLabel, pct, ms, usd } from '../utils/labels';

interface Props { history: HistoryEntry[]; }

function when(d: Date): string {
  return d.toLocaleString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
}

function Entry({ entry }: { entry: HistoryEntry }) {
  const [open, setOpen] = useState(false);
  const r = entry.result;

  return (
    <div>
      <button className="row-btn" onClick={() => setOpen(v => !v)} aria-expanded={open}>
        <span className="grow">{entry.prompt}</span>
        <span className="meta">{DOMAIN_LABEL[r.classification.domain]}</span>
        <span className="meta">{modelDisplayName(r.finalModel.model)}</span>
        <span className="meta num">{ms(r.latencyMs)}</span>
        <span className="meta faint">{when(entry.timestamp)}</span>
      </button>

      {open && (
        <div className="box-body" style={{ borderTop: '1px solid var(--border)', paddingTop: 12 }}>
          <dl className="facts">
            <dt>Task</dt><dd>{DOMAIN_LABEL[r.classification.domain]}, {r.classification.complexity} complexity, {pct(r.classification.confidence)} confident</dd>
            <dt>Sent to</dt><dd>{modelDisplayName(r.initialModel.model)} ({providerLabel(r.initialModel.provider)}, {TIER_LABEL[r.initialModel.tier]} tier)</dd>
            {r.escalated && (
              <><dt>Escalated to</dt><dd>{modelDisplayName(r.finalModel.model)} ({providerLabel(r.finalModel.provider)}, {TIER_LABEL[r.finalModel.tier]} tier)</dd></>
            )}
            <dt>Time</dt><dd className="num">{ms(r.latencyMs)}</dd>
            <dt>Cost</dt><dd className="num">{usd(r.totalCostUsd)}</dd>
          </dl>
          <div className="prose" style={{ marginTop: 14, maxHeight: 360, overflowY: 'auto' }}>
            <ReactMarkdown remarkPlugins={[remarkGfm]} rehypePlugins={[rehypeHighlight]}>
              {r.response}
            </ReactMarkdown>
          </div>
        </div>
      )}
    </div>
  );
}

export default function HistoryPanel({ history }: Props) {
  return (
    <div>
      <div className="page-head">
        <h1>History</h1>
        <span className="muted">{history.length === 0 ? 'Nothing yet' : `Last ${history.length} of up to 20`}</span>
      </div>
      <p className="page-intro">Your recent requests and where each one went. Click a row to see the answer.</p>

      {history.length === 0 ? (
        <p className="muted">Send a prompt and it will show up here.</p>
      ) : (
        <div className="box list">
          {history.map(e => <Entry key={e.id} entry={e} />)}
        </div>
      )}
    </div>
  );
}

// The demo imports the server's real decision code. Nothing here is a copy.
import { RuleBasedClassifier } from '../../backend/src/services/classifier';
import {
  DEFAULT_TASK_WEIGHTS, applyOverrides, scoreStats, compareScored,
  type OptimizationMode, type TaskWeights,
} from '../../backend/src/services/scoring';
import { ROUTING, COMPLEXITY_TO_TIER, PROVIDER_TIERS } from '../../backend/src/config/routing';
import { getModelById } from '../../backend/src/config/models';
import type { TaskDomain, ModelTier, TaskComplexity } from '../../backend/src/providers/types';
import snapshot from './snapshot.json';
import './style.css';

// Same default the server uses when only the rule-based classifier is active.
const CONFIDENCE_THRESHOLD = 0.6;
const EPSILON = 0.1;

interface Row {
  modelId: string; provider: string; tier: ModelTier; taskType: TaskDomain;
  totalRequests: number; averageLatencyMs: number; averageConfidence: number;
  escalationRate: number; averageCostUsd: number;
}
const HISTORY = snapshot as Row[];

const DOMAIN_LABEL: Record<TaskDomain, string> = {
  coding: 'code', coding_debug: 'debugging', math: 'math', math_reasoning: 'math reasoning',
  creative: 'creative writing', general: 'general', general_chat: 'chat', research: 'research',
  summarization: 'summarization', vision: 'vision', multilingual: 'multilingual',
};
const TIER_LABEL: Record<ModelTier, string> = { cheap: 'cheap', balanced: 'mid', premium: 'premium' };
const PROVIDER_LABEL: Record<string, string> = { openai: 'OpenAI', anthropic: 'Anthropic', together: 'Together AI' };

const EXAMPLES = [
  'Write a TypeScript function that debounces API calls with a configurable delay',
  'TypeError: cannot read properties of undefined (reading map) in my React component, why?',
  'Solve for x: 3x^2 - 12x + 9 = 0',
  'Write a short poem about a lighthouse keeper who is afraid of the dark',
  'Summarize the key points of the attached meeting notes in bullet points',
  'Compare the evidence for and against intermittent fasting, citing studies',
  'hey, quick question, what should I cook tonight?',
  'Translate "the meeting is postponed until Thursday" into French',
  'Can you help me fix the SQL query for my sales report? It returns the wrong totals',
  'Explain how quicksort works',
];

const classifier = new RuleBasedClassifier();

function modelName(id: string): string {
  return getModelById(id)?.displayName ?? id.split('/').pop() ?? id;
}
function pct(n: number): string { return `${Math.round(n * 100)}%`; }
function ms(n: number): string { return n >= 1000 ? `${(n / 1000).toFixed(1)} s` : `${Math.round(n)} ms`; }
function usd(n: number): string { return n < 0.001 ? `$${n.toFixed(6)}` : `$${n.toFixed(4)}`; }
function esc(s: string): string {
  return s.replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c] as string));
}
function nextTier(t: ModelTier): ModelTier { return t === 'cheap' ? 'balanced' : 'premium'; }

interface Pick { modelId: string; provider: string; tier: ModelTier; }

function escalationTarget(pick: Pick, domain: TaskDomain): Pick | null {
  const route = ROUTING[domain];
  if (pick.tier !== 'premium') {
    const tier = nextTier(pick.tier);
    return { provider: pick.provider, tier, modelId: PROVIDER_TIERS[pick.provider][tier] };
  }
  const fb = route.fallbackProviderName;
  if (fb && fb !== pick.provider) return { provider: fb, tier: 'premium', modelId: PROVIDER_TIERS[fb].premium };
  return null;
}

function weightsLine(w: TaskWeights): string {
  return `quality ${w.confidenceWeight}, cost ${w.costWeight}, latency ${w.latencyWeight}, escalation ${w.escalationWeight}`;
}

function renderClassification(prompt: string): { html: string; domain: TaskDomain; complexity: TaskComplexity; confidence: number } {
  const ex = classifier.explain(prompt);
  const { domain, complexity, confidence } = ex.result;

  let body: string;
  if (ex.explainIntent) {
    body = `<p>The prompt starts with "explain" and has no implementation words in it, so it is treated as a
      general question rather than sent to a specialist. Confidence is fixed at 50% for this case.</p>`;
  } else if (ex.domains.length === 0) {
    body = `<p class="muted">No task-type signal matched, so this falls through to general at 50% confidence.
      On the live server, this is where the embedding stage would take over.</p>`;
  } else {
    const total = ex.domains.reduce((s, d) => s + d.score, 0);
    body = `<div class="table-wrap"><table>
      <thead><tr><th>Task type</th><th class="r">Points</th><th class="r">Share</th><th>Patterns that matched</th></tr></thead>
      <tbody>${ex.domains.map(d => `
        <tr class="${d.domain === domain ? 'chosen' : ''}">
          <td class="name">${DOMAIN_LABEL[d.domain]}</td>
          <td class="r">${d.score}</td>
          <td class="r">${pct(d.score / total)}</td>
          <td class="signals">${d.matched.map(esc).join('<br>')}</td>
        </tr>`).join('')}
      </tbody></table></div>
      <p class="muted">Confidence is the winner's share of all points. The live server only trusts this
      stage outright at 80% or more; below that it also runs the embedding stage, which this page can't.</p>`;
  }

  const html = `<div class="box">
    <div class="box-head"><h2>Classification</h2>
      <span class="sub">${DOMAIN_LABEL[domain]}, ${complexity} complexity, ${pct(confidence)} confident</span></div>
    <div class="box-body">
      ${body}
      <p class="muted">Complexity: ${ex.wordCount} word${ex.wordCount === 1 ? '' : 's'} and ${ex.complexityPoints}
      complexity point${ex.complexityPoints === 1 ? '' : 's'} (3 or more is medium, 6 or more is high).</p>
    </div></div>`;
  return { html, domain, complexity, confidence };
}

function renderDecision(domain: TaskDomain, complexity: TaskComplexity, confidence: number, mode: OptimizationMode): string {
  const weights = applyOverrides(DEFAULT_TASK_WEIGHTS[domain], { optimizationMode: mode });
  const rows = HISTORY.filter(r => r.taskType === domain)
    .map(r => ({ ...r, score: scoreStats(r, weights) }))
    .sort(compareScored);

  let pick: Pick;
  let lead: string;
  let table = '';

  if (rows.length > 0) {
    const top = rows[0];
    pick = { modelId: top.modelId, provider: top.provider, tier: top.tier };
    lead = `There is history for ${DOMAIN_LABEL[domain]} prompts, so every model with a row is scored and
      <strong>${modelName(top.modelId)}</strong> (${PROVIDER_LABEL[top.provider] ?? top.provider},
      ${TIER_LABEL[top.tier]} tier) wins. On the live server, ${Math.round(EPSILON * 100)}% of requests
      skip this and try a random model instead, so it keeps learning.`;
    table = `<div class="table-wrap"><table>
      <thead><tr><th>Model</th><th>Tier</th><th class="r">Quality</th><th class="r">Latency</th>
      <th class="r">Cost</th><th class="r">Escalated</th><th class="r">Requests</th><th class="r">Score</th></tr></thead>
      <tbody>${rows.map((r, i) => `
        <tr class="${i === 0 ? 'chosen' : ''}">
          <td class="name">${esc(modelName(r.modelId))}</td>
          <td>${TIER_LABEL[r.tier]}</td>
          <td class="r">${pct(r.averageConfidence)}</td>
          <td class="r">${ms(r.averageLatencyMs)}</td>
          <td class="r">${usd(r.averageCostUsd)}</td>
          <td class="r">${pct(r.escalationRate)}</td>
          <td class="r">${r.totalRequests}</td>
          <td class="r">${r.score.toFixed(2)}</td>
        </tr>`).join('')}
      </tbody></table></div>
      <p class="muted">Score = quality × ${weights.confidenceWeight} − (cost ÷ $0.20) × ${weights.costWeight}
      − (latency ÷ 30 s) × ${weights.latencyWeight} − escalation rate × ${weights.escalationWeight}.
      Weights for ${DOMAIN_LABEL[domain]}${mode === 'balanced' ? '' : ` with "${mode === 'cost' ? 'cheapest that works' : 'best answer'}"`}:
      ${weightsLine(weights)}.</p>`;
  } else {
    const provider = ROUTING[domain].providerName;
    const tier = COMPLEXITY_TO_TIER[complexity];
    pick = { provider, tier, modelId: PROVIDER_TIERS[provider][tier] };
    lead = `There is no history for ${DOMAIN_LABEL[domain]} prompts yet, so the static table decides:
      ${DOMAIN_LABEL[domain]} goes to ${PROVIDER_LABEL[provider] ?? provider}, and ${complexity} complexity
      means the ${TIER_LABEL[tier]} tier. That is <strong>${modelName(pick.modelId)}</strong>.
      <span class="muted">(${esc(ROUTING[domain].reason)}.)</span>`;
  }

  let escalation = '';
  if (confidence < CONFIDENCE_THRESHOLD) {
    const target = escalationTarget(pick, domain);
    escalation = target
      ? `<p class="note">Confidence ${pct(confidence)} is under the ${pct(CONFIDENCE_THRESHOLD)} threshold, so after
         the first answer comes back the request would run again on ${modelName(target.modelId)}
         (${PROVIDER_LABEL[target.provider] ?? target.provider}, ${TIER_LABEL[target.tier]} tier), and both calls
         would be recorded.</p>`
      : `<p class="note">Confidence ${pct(confidence)} is under the ${pct(CONFIDENCE_THRESHOLD)} threshold, but this is
         already the top tier with no fallback provider, so there is nowhere to escalate to.</p>`;
  }

  return `<div class="box">
    <div class="box-head"><h2>Decision</h2>
      <span class="sub">${esc(modelName(pick.modelId))}</span></div>
    <div class="box-body"><p>${lead}</p>${escalation}${table}</div></div>`;
}

// Wiring ---------------------------------------------------------------------

const promptEl = document.getElementById('prompt') as HTMLTextAreaElement;
const modeEl   = document.getElementById('mode') as HTMLSelectElement;
const outEl    = document.getElementById('out') as HTMLElement;
const exEl     = document.getElementById('examples') as HTMLElement;

function run(): void {
  const prompt = promptEl.value.trim();
  if (!prompt) { outEl.innerHTML = ''; return; }
  const c = renderClassification(prompt);
  outEl.innerHTML = c.html + renderDecision(c.domain, c.complexity, c.confidence, modeEl.value as OptimizationMode);
}

promptEl.addEventListener('input', run);
modeEl.addEventListener('change', run);

for (const example of EXAMPLES) {
  const b = document.createElement('button');
  b.type = 'button';
  b.textContent = example.length > 34 ? example.slice(0, 32) + '…' : example;
  b.title = example;
  b.addEventListener('click', () => { promptEl.value = example; run(); promptEl.focus(); });
  exEl.appendChild(b);
}

if (new URLSearchParams(location.search).has('embed')) {
  document.documentElement.classList.add('embed');
}

promptEl.value = EXAMPLES[0];
run();

import { useState, type FormEvent, type KeyboardEvent } from 'react';
import type { OptimizationMode } from '../types';

interface Props {
  onSubmit: (prompt: string, options: { maxTokens?: number; optimizationMode: OptimizationMode }) => void;
  loading: boolean;
}

const MODES: { value: OptimizationMode; label: string }[] = [
  { value: 'balanced', label: 'Balanced' },
  { value: 'cost',     label: 'Cheapest that works' },
  { value: 'quality',  label: 'Best answer' },
];

export default function PromptCard({ onSubmit, loading }: Props) {
  const [prompt, setPrompt]       = useState('');
  const [maxTokens, setMaxTokens] = useState('');
  const [mode, setMode]           = useState<OptimizationMode>('balanced');

  const canSubmit = prompt.trim().length > 0 && !loading;

  function submit() {
    if (!canSubmit) return;
    const parsed = parseInt(maxTokens, 10);
    onSubmit(prompt, {
      optimizationMode: mode,
      maxTokens: Number.isFinite(parsed) && parsed > 0 ? parsed : undefined,
    });
  }

  function handleSubmit(e: FormEvent) {
    e.preventDefault();
    submit();
  }

  function handleKey(e: KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
      e.preventDefault();
      submit();
    }
  }

  return (
    <form onSubmit={handleSubmit} className="prompt-form">
      <textarea
        value={prompt}
        onChange={e => setPrompt(e.target.value)}
        onKeyDown={handleKey}
        placeholder="Type a prompt. The router will classify it and pick a model."
        aria-label="Prompt"
        rows={4}
      />

      <div className="prompt-controls">
        <label className="inline-field">
          Prefer
          <select value={mode} onChange={e => setMode(e.target.value as OptimizationMode)} aria-label="Routing preference">
            {MODES.map(m => <option key={m.value} value={m.value}>{m.label}</option>)}
          </select>
        </label>

        <label className="inline-field">
          Max tokens
          <input
            type="number"
            value={maxTokens}
            onChange={e => setMaxTokens(e.target.value)}
            placeholder="1024"
            min={1}
            max={32000}
          />
        </label>

        <span className="hint">Ctrl+Enter to send</span>

        <button type="submit" className="btn btn-primary submit" disabled={!canSubmit}>
          {loading ? <><span className="spinner" aria-hidden="true" /> Routing</> : 'Send'}
        </button>
      </div>
    </form>
  );
}

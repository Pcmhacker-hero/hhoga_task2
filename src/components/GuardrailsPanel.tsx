// GuardrailsPanel — Shows pass/fail status for each guardrail check

import type { GuardrailResult } from '../lib/guardrails';

interface GuardrailsPanelProps {
  inputResults: GuardrailResult[];
  outputResults: GuardrailResult[];
}

export function GuardrailsPanel({ inputResults, outputResults }: GuardrailsPanelProps) {
  const allResults = [...inputResults, ...outputResults];

  if (allResults.length === 0) {
    return null;
  }

  return (
    <div className="guardrails-panel" id="guardrails-panel">
      {allResults.map((result, i) => {
        const statusClass = result.passed ? 'pass' : 'fail';
        const icon = result.passed ? '✓' : '✗';

        return (
          <span
            key={`${result.name}-${i}`}
            className={`guardrail-badge ${statusClass}`}
            title={result.details}
            id={`guardrail-${result.name.toLowerCase().replace(/\s+/g, '-')}`}
          >
            <span className="guardrail-icon">{icon}</span>
            {result.name}
            <span style={{
              fontSize: '0.65rem',
              color: 'var(--text-muted)',
              marginLeft: '0.15rem',
            }}>
              {result.durationMs}ms
            </span>
          </span>
        );
      })}
    </div>
  );
}

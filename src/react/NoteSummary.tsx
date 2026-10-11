import { showOverflowTitle } from './tooltips';
import type { IterationNote } from '../core/index';

/** Pinned references and saved defaults use the same compact tag. */
function SummaryTag({ label }: { label: string }) {
  return <span className="iso-iter-chip"><span onPointerOver={showOverflowTitle}>{label}</span></span>;
}

/** Keep machine-directed requests readable without changing the agent's original text. */
export function NoteSummary({ note }: { note: IterationNote }) {
  if (!note.feedback.startsWith('[set-defaults]')) {
    const elements = note.elements ?? (note.element ? [note.element] : []);
    const references = [
      ...(note.variant ? [{
        key: `variant:${note.variant.axisId}`,
        label: `${note.variant.label}${note.variant.optionLabel ? ` / ${note.variant.optionLabel}` : ''}`,
      }] : []),
      ...elements.map(element => ({ key: element.selector, label: element.text || element.tag })),
    ];
    return <>
      <p>{note.feedback}</p>
      {references.length > 0 && <span className="iso-iter-meta">
        {references.map(reference => <SummaryTag key={reference.key} label={reference.label} />)}
      </span>}
    </>;
  }
  const payload = note.payload && typeof note.payload === 'object' ? note.payload as Record<string, unknown> : {};
  const playground = payload.playground;
  const tags: { name: string; value: string }[] = [];
  if (playground && typeof playground === 'object' && !Array.isArray(playground)) {
    for (const [name, value] of Object.entries(playground)) {
      if (typeof value === 'string' || typeof value === 'number') tags.push({ name, value: String(value) });
    }
  } else {
    if (typeof payload.variants === 'string') for (const value of payload.variants.split(',').map(s => s.trim()).filter(Boolean)) tags.push({ name: 'variant', value });
    if (typeof payload.knobs === 'string') for (const pair of payload.knobs.split(',')) {
      const at = pair.indexOf(':');
      if (at > 0) tags.push({ name: pair.slice(0, at).trim(), value: pair.slice(at + 1).trim() });
    }
  }
  return <>
    <span className="iso-iter-request-heading"><span className="iso-iter-request-kind">Defaults</span><code>{note.route}</code></span>
    <span className="iso-iter-meta">
      {tags.length ? <>{tags.slice(0, 3).map(tag => <SummaryTag key={`${tag.name}-${tag.value}`} label={`${tag.name} ${tag.value}`} />)}{tags.length > 3 && <span className="iso-iter-request-more">+{tags.length - 3}</span>}</> : <code className="iso-iter-request-fallback">{note.feedback.replace(/^\[set-defaults\]\s*/, '')}</code>}
    </span>
  </>;
}

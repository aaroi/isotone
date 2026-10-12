import { showOverflowTitle } from './tooltips';
import type { IterationNote } from '../core/index';

/** Pinned references and saved defaults use the same compact tag. */
function SummaryTag({ label }: { label: string }) {
  return <span className="isotone-chip"><span onPointerOver={showOverflowTitle}>{label}</span></span>;
}

/** Keep machine-directed requests readable without changing the agent's original text. */
export function NoteSummary({ note, page }: { note: IterationNote; page?: string }) {
  if (!note.feedback.startsWith('[set-defaults]')) {
    const elements = note.elements ?? (note.element ? [note.element] : []);
    const references = [
      ...(page ? [{ key: `page:${page}`, label: page }] : []),
      ...(note.variant ? [{
        key: `variant:${note.variant.axisId}`,
        label: `${note.variant.label}${note.variant.optionLabel ? ` / ${note.variant.optionLabel}` : ''}`,
      }] : []),
      ...elements.map(element => ({ key: element.selector, label: element.text || element.tag })),
    ];
    return <>
      <p>{note.feedback}</p>
      {references.length > 0 && <span className="isotone-meta">
        {references.map(reference => <SummaryTag key={reference.key} label={reference.label} />)}
      </span>}
    </>;
  }
  const payload = note.payload && typeof note.payload === 'object' ? note.payload as Record<string, unknown> : {};
  const playground = payload.playground;
  const tags: { name: string; value: string }[] = [];
  const addAll = (values: unknown) => {
    if (!values || typeof values !== 'object' || Array.isArray(values)) return;
    for (const [name, value] of Object.entries(values)) {
      if (typeof value === 'string' || typeof value === 'number') tags.push({ name, value: String(value) });
    }
  };
  addAll(playground);
  if (!tags.length) {
    // Hosts file picks as an object, or as the comma lists the overlay writes.
    addAll(payload.variants);
    if (typeof payload.variants === 'string') for (const value of payload.variants.split(',').map(s => s.trim()).filter(Boolean)) tags.push({ name: 'variant', value });
    if (typeof payload.knobs === 'string') for (const pair of payload.knobs.split(',')) {
      const at = pair.indexOf(':');
      if (at > 0) tags.push({ name: pair.slice(0, at).trim(), value: pair.slice(at + 1).trim() });
    }
  }
  // Same row as every other note: the text, then compact tags for the picks.
  return <>
    <p>{note.feedback}</p>
    {(page || tags.length > 0) && <span className="isotone-meta">
      {page && <SummaryTag label={page} />}
      {tags.slice(0, 3).map(tag => <SummaryTag key={`${tag.name}-${tag.value}`} label={`${tag.name} ${tag.value}`} />)}
      {tags.length > 3 && <span className="isotone-request-more">+{tags.length - 3}</span>}
    </span>}
  </>;
}

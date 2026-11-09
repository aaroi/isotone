import {
  type ComponentProps,
  type FocusEvent,
  type KeyboardEvent,
  type MouseEvent,
  type ReactNode,
  type RefObject,
  useEffect,
  useRef,
} from 'react';
import { Icon } from '../icons';
import { ringPulse } from '../motion';

const RAIL_KEYS = ['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Home', 'End'];

/** Arrow keys, Home and End move between the rail's buttons. */
function moveRailFocus(event: KeyboardEvent<HTMLFieldSetElement>) {
  const target = event.target as HTMLElement;
  if (!target.classList.contains('isotone-rail-button') || !RAIL_KEYS.includes(event.key)) return;
  event.preventDefault();
  const buttons = Array.from(event.currentTarget.querySelectorAll<HTMLButtonElement>('.isotone-rail-button'));
  const at = buttons.indexOf(target as HTMLButtonElement);
  const step = ['ArrowUp', 'ArrowLeft'].includes(event.key) ? -1 : 1;
  const next = event.key === 'Home' ? 0 : event.key === 'End' ? buttons.length - 1 : (at + step + buttons.length) % buttons.length;
  buttons[next]?.focus();
}

/**
 * The launcher pill and, once it unfolds, a button per tool with its panel.
 * The tools stay mounted while folded, inert and hidden from assistive technology.
 */
export function Rail({
  expanded,
  instant,
  tools,
  railFocus,
  launcher,
  children,
}: {
  expanded: boolean;
  /** The last input was a key: unfolding from the launcher moves focus onto the first tool. */
  instant: boolean;
  tools: number;
  railFocus: { onFocus: () => void; onBlur: (e: FocusEvent<HTMLElement>) => void };
  launcher: ReactNode;
  children: ReactNode;
}) {
  const ref = useRef<HTMLFieldSetElement>(null);
  useEffect(() => {
    const rail = ref.current;
    if (!expanded || !instant || !rail) return;
    const active = (rail.getRootNode() as Document | ShadowRoot).activeElement;
    if (active?.classList.contains('isotone-fab')) rail.querySelector<HTMLButtonElement>('.isotone-rail-button')?.focus();
  }, [expanded, instant]);
  return (
    <fieldset
      ref={ref}
      aria-label="Isotone tools"
      onKeyDown={moveRailFocus}
      className="isotone-rail"
      data-expanded={expanded}
      data-tools={tools}
      {...railFocus}
    >
      <div
        className="isotone-rail-tools"
        aria-hidden={!expanded}
        ref={(node) => {
          node?.toggleAttribute('inert', !expanded);
        }}
      >
        {children}
      </div>
      {launcher}
    </fieldset>
  );
}

const plural = (count: number, word: string) => `${count} ${word}${count === 1 ? '' : 's'}`;

/** A tool's button on the rail; it opens and closes the panel it controls. A count names its open notes. */
export function RailButton({
  icon,
  label,
  count,
  detail,
  controls,
  open,
  onClick,
}: {
  icon: ComponentProps<typeof Icon>['name'];
  label: string;
  count?: number;
  /** A short addition to the name, such as "2 to check". */
  detail?: string;
  controls: string;
  open: boolean;
  onClick: (event: MouseEvent<HTMLButtonElement>) => void;
}) {
  return (
    <button
      type="button"
      className="isotone-rail-button"
      aria-label={[label, count && plural(count, 'note'), detail].filter(Boolean).join(', ')}
      title={detail ? `${label} · ${detail}` : label}
      aria-controls={controls}
      aria-expanded={open}
      onClick={onClick}
    >
      <Icon name={icon} />
      <span className="isotone-tool-label">
        {label}
        {count !== undefined && (
          <>
            {' '}
            <span className="isotone-count">{count || ''}</span>
          </>
        )}
      </span>
    </button>
  );
}

/** The folded dock: a pill with the open-note count and a ring while an agent works. */
export function Launcher({
  fabRef,
  hidden,
  variantsOnly,
  count,
  toCheck = 0,
  working,
  shortcutLabel,
  onClick,
}: {
  fabRef: RefObject<HTMLButtonElement | null>;
  /** The rail is unfolded and takes the launcher's place. */
  hidden: boolean;
  /** Without a notes endpoint, the launcher opens Variants. */
  variantsOnly: boolean;
  count: number;
  /** Closed notes the reviewer has yet to check; counted on the pill only while none are open. */
  toCheck?: number;
  /** How many notes an agent is working on. */
  working: number;
  shortcutLabel: string;
  onClick: (event: MouseEvent<HTMLButtonElement>) => void;
}) {
  const label = [
    variantsOnly ? 'Variants' : 'Isotone',
    count && plural(count, 'note'),
    toCheck && `${toCheck} to check`,
    working && `${working} in progress`,
  ];
  return (
    <button
      type="button"
      ref={fabRef}
      className="isotone-fab"
      aria-hidden={hidden}
      tabIndex={hidden ? -1 : 0}
      aria-label={label.filter(Boolean).join(', ')}
      title={`Isotone${working ? ` · ${working} in progress` : ''}${shortcutLabel ? ` · ${shortcutLabel}` : ''}`}
      aria-expanded={hidden}
      onClick={onClick}
    >
      {working > 0 && <span className="isotone-ring" ref={ringPulse} />}
      <Icon name="iterate" />
      {count > 0 ? (
        <span className="isotone-badge" aria-hidden="true">
          {count}
        </span>
      ) : (
        toCheck > 0 && (
          <span className="isotone-badge" data-quiet="" aria-hidden="true">
            {toCheck}
          </span>
        )
      )}
    </button>
  );
}

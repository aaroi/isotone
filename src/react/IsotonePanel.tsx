import { FEEDBACK_STORAGE_KEY } from '../core/browser-storage';
import type { ExperimentFlags } from '../core/experiments';
import type { IsotoneStoreConfig } from '../core/types';
import { isRouteVisible, normalizeRoute, type RouteGateOptions } from '../core/routes';
import type { IsotoneShortcut, IsotoneTheme } from '../core/types';
import type { VariantsSource } from '../core/variants';
import { type ReactElement, useEffect, useId, useRef } from 'react';
import { AdjustPanel } from './adjust/AdjustPanel';
import { useAdjust } from './adjust/useAdjust';
import type { StyleEdit } from '../core/style-edits';
import { Composer } from './notes/Composer';
import { AwayButton, NotesPanel } from './notes/NotesPanel';
import { PickOverlay, useSelectMode } from './dock/picking';
import { Launcher, Rail, RailButton } from './dock/Rail';
import { useDockTheme } from './styles/theme';
import { UpdateNotice } from './dock/UpdateNotice';
import { DEFAULT_SHORTCUT, shortcutText, useDockEvents } from './dock/useDockEvents';
import { type Surface, useDockFocus } from './dock/useDockFocus';
import { CLOSED, useDockMode } from './dock/useDockMode';
import { useDockMotion } from './dock/useDockMotion';
import { useDockSize } from './dock/useDockSize';
import { useNoteActions } from './notes/useNoteActions';
import { useNotes } from './notes/useNotes';
import { useNoteView } from './notes/useNoteView';
import { refreshSource, useVariantsSnapshot, VariantsPanel } from './variants/VariantsView';
import { useKeyboardInset } from './dock/viewport';

export interface IsotonePanelProps {
  /** Auto follows the page at the dock. System follows the OS preference. */
  theme?: IsotoneTheme;
  /** Local adapter endpoint for an optional, nonblocking update notice. */
  updateEndpoint?: string;
  route: string;
  store: IsotoneStoreConfig;
  rule?: RouteGateOptions;
  getPayload?: () => unknown;
  variants?: VariantsSource;
  /** What the Variants list says on a page without selectors. */
  variantsEmptyText?: string;
  /** Initial surface. Kept for compatibility; surfaces can now open together. */
  defaultTab?: 'variants' | 'notes';
  /** Default: Cmd/Ctrl+Shift+Period. false disables the shortcut. */
  shortcut?: IsotoneShortcut | false;
  /** Experiments to turn on: off by default, and free to change or go away in any release. */
  experimental?: ExperimentFlags;
}

/**
 * The dock: the launcher, the rail of tools, and the variants and feedback
 * panels. Each concern lives in its own hook; this composes them and holds the
 * rules that join them: what opens what, and where focus goes.
 */
export function IsotonePanel({
  route: pageRoute,
  theme: themePreference = 'auto',
  updateEndpoint,
  store: storeCfg,
  rule,
  getPayload,
  variants,
  variantsEmptyText,
  defaultTab = 'notes',
  shortcut = DEFAULT_SHORTCUT,
  experimental,
}: IsotonePanelProps): ReactElement | null {
  // One page, however the URL spells it: `/about/` and `/about?tab=2` are `/about`, as for the CLI.
  const route = normalizeRoute(pageRoute);
  const nsKey = storeCfg.key ?? FEEDBACK_STORAGE_KEY;
  const [mode, update] = useDockMode();
  const { notesOpen, variantsOpen, expanded, picking, pickingWithPanel, anchor } = mode;
  const floating = anchor !== null;
  const open = notesOpen || variantsOpen;
  const rootRef = useRef<HTMLDivElement>(null);
  const fieldRef = useRef<HTMLTextAreaElement>(null);
  const floatRef = useRef<HTMLDivElement>(null);
  const fabRef = useRef<HTMLButtonElement>(null);
  const id = useId();

  const notesAvailable = Boolean(storeCfg.endpoint);
  const variantsAvailable = useVariantsSnapshot(variants).shown.length > 0;
  const visible = isRouteVisible(route, rule) && (notesAvailable || variantsAvailable || variantsOpen);
  const { store, notes, setNotes, clock, load: loadNotes, write } = useNotes(storeCfg, visible);
  const { view, updateRequested, pendingActions } = useNoteView(notes, route, clock);
  useDockMotion(rootRef, visible);
  useKeyboardInset(rootRef, visible);
  const theme = useDockTheme(rootRef, visible, themePreference);
  const dockSize = useDockSize(rootRef, `${nsKey}::dock`, { variants: variantsOpen, notes: notesOpen });
  const focus = useDockFocus(rootRef, fieldRef, fabRef, id);
  // The style editor's edits, read when a note is sent; the editor itself needs select mode, set up below.
  const styleEdits = useRef<StyleEdit[]>([]);
  const restoreEdits = useRef<(edits: readonly StyleEdit[]) => void>(() => {});
  const actions = useNoteActions({
    route,
    draftKey: `${nsKey}::draft::${route}`,
    store,
    write,
    setNotes,
    getPayload,
    getStyleEdits: () => styleEdits.current,
    restoreStyleEdits: (edits) => restoreEdits.current(edits),
    update,
    focusComposer: focus.composer,
  });
  const { draft, setTargets } = actions;
  const shortcutLabel = shortcutText(shortcut);

  // The handlers below go to plain elements or through refs, so they need no memoizing.
  /** The pointer and the shortcut start selecting; Enter or Space on a focused button goes to the field. */
  const startFeedback = (select: boolean) => {
    update((m) => ({ notesOpen: true, ...(select ? { picking: true, pickingWithPanel: !m.notesOpen } : {}) }));
    if (select) focus.cancel();
    else focus.composer();
  };
  /** Close one panel. Focus inside it goes to its rail button, or the launcher once the rail folds away. */
  const closePanel = (panel: Surface) => {
    const inDock = focus.inDock();
    update(panel === 'notes' ? { notesOpen: false, picking: false, expanded: false } : { variantsOpen: false, expanded: false });
    if (inDock) focus.launcher(panel);
  };
  /** Put the composer back in the dock, keeping what was written and pinned. */
  const dockComposer = () => {
    update({ anchor: null, picking: false });
    focus.composer();
  };

  // Page events read the current render when they arrive.
  const latest = useRef({ mode, notesAvailable, editing: draft.editing });
  latest.current = { mode, notesAvailable, editing: draft.editing };
  const events = useDockEvents({
    rootRef,
    visible,
    shortcut,
    onLeave: () => update({ expanded: false }),
    onShortcut: () => {
      const { mode, notesAvailable } = latest.current;
      if (!notesAvailable) update((m) => ({ variantsOpen: !m.variantsOpen }));
      else if (mode.picking) select.done();
      else {
        if (!mode.notesOpen && !mode.variantsOpen) focus.remember();
        update({ expanded: true });
        startFeedback(true);
      }
    },
    onEscape: () => {
      const { mode, editing } = latest.current;
      if (!(mode.notesOpen || mode.variantsOpen) || mode.picking) return;
      if (mode.anchor) dockComposer();
      else if (editing) actions.cancelEdit();
      else closeAll();
    },
  });
  const { instant, touch } = events;
  /** Close everything. Focus in the dock goes back to the host control it came from, else the launcher. */
  function closeAll() {
    const inDock = focus.inDock();
    focus.cancel();
    update(CLOSED);
    events.setHovered(false);
    if (inDock) focus.restore();
  }
  const railOpen = expanded || events.hovered || (events.focused && instant) || open || picking;

  const select = useSelectMode({ mode, update, focus, rootRef, fieldRef, floatRef, targets: draft.targets, setTargets, touch });

  const adjust = useAdjust(experimental?.styleEditor === true && notesAvailable, draft.targets, select.locate, notesOpen);
  styleEdits.current = adjust.edits;
  restoreEdits.current = adjust.restore;
  /** The editor sits above the docked composer, so opening it brings the composer home and ends selecting. */
  const toggleAdjust = () => {
    if (!adjust.open) update({ picking: false, anchor: null, notesOpen: true });
    adjust.toggle();
  };

  // Opening a surface or changing route loads at once; the poll in useNotes keeps it current.
  // biome-ignore lint/correctness/useExhaustiveDependencies: open-time refresh.
  useEffect(() => {
    loadNotes();
  }, [notesOpen, variantsOpen, route, loadNotes]);
  // The Variants view refreshes its source as it opens. Feedback refreshes it too, for the selectors its notes
  // name, and so does a mount while it is empty: a network-backed source starts that way.
  // biome-ignore lint/correctness/useExhaustiveDependencies: these moments only.
  useEffect(() => {
    if (variants && (notesOpen || !variantsAvailable)) refreshSource(variants);
  }, [variants, notesOpen]);

  if (!visible) return null;
  const composer = (
    <Composer
      draft={draft}
      fieldRef={fieldRef}
      active={notesOpen}
      picking={picking}
      pickingWithPanel={pickingWithPanel}
      floating={floating}
      touch={touch}
      shortcutLabel={shortcutLabel}
      adjust={
        adjust.available ? { open: adjust.open, count: adjust.count, onToggle: toggleAdjust, onReset: () => adjust.reset() } : undefined
      }
      {...actions.composer}
      {...select.controls}
    />
  );
  const count = view.notes.length;
  const working = view.working.size;
  const tools = Number(Boolean(variants)) + Number(notesAvailable);
  return (
    <div
      ref={rootRef}
      data-isotone
      data-theme={theme}
      data-expanded={railOpen}
      data-tools={tools}
      data-instant={instant}
      data-notes-open={notesOpen}
      data-selecting={picking || floating}
      data-working={working > 0}
      data-open={open}
      className="isotone-root"
      {...dockSize.root}
    >
      {open && <div {...dockSize.handle('width')} />}
      <div className="isotone-rail-track" aria-hidden="true" />
      {/* While adjusting, the outlines say which elements the values belong to. */}
      {(picking || floating || adjust.open) && <PickOverlay picking={picking} targets={draft.targets} locate={select.locate} />}
      {floating && notesOpen && (
        <div ref={floatRef} className="isotone-float" role="dialog" aria-label="Feedback on the selection">
          {composer}
        </div>
      )}
      <div className="isotone-notices">
        <UpdateNotice
          endpoint={updateEndpoint}
          active={open}
          route={route}
          requested={updateRequested}
          onRequested={notesAvailable ? loadNotes : undefined}
        />
      </div>
      <Rail
        expanded={railOpen}
        instant={instant}
        tools={tools}
        railFocus={events.railFocus}
        launcher={
          <Launcher
            fabRef={fabRef}
            hidden={railOpen}
            variantsOnly={!notesAvailable}
            count={count}
            working={working}
            shortcutLabel={shortcutLabel}
            onClick={(event) => {
              if (open) closeAll();
              else if (expanded) update({ expanded: false });
              else {
                focus.remember();
                update({ expanded: true });
                if ((defaultTab === 'variants' || !notesAvailable) && variantsAvailable) update({ variantsOpen: true });
                else startFeedback(event.detail > 0);
              }
            }}
          />
        }
      >
        {variants && (
          <RailButton
            icon="sliders"
            label="Variants"
            controls={`${id}-variants`}
            open={variantsOpen}
            onClick={() => (variantsOpen ? closePanel('variants') : update({ variantsOpen: true, expanded: false }))}
          />
        )}
        {variants && (
          <VariantsPanel
            id={`${id}-variants`}
            resizeHandle={dockSize.handle('variants')}
            onClose={() => closePanel('variants')}
            source={variants}
            active={variantsOpen}
            onFeedback={notesAvailable ? actions.referVariant : undefined}
            onSaved={loadNotes}
            onManage={notesAvailable ? actions.queueRemoval : undefined}
            pendingActions={pendingActions}
            emptyText={variantsEmptyText}
          />
        )}
        {notesAvailable && (
          <NotesPanel
            id={`${id}-notes`}
            open={notesOpen}
            route={route}
            view={view}
            editingId={draft.editing?.id}
            resizeHandle={dockSize.handle('notes')}
            onClose={() => closePanel('notes')}
            onEdit={actions.beginEdit}
            onRemove={actions.removeNote}
            compose={
              <>
                {adjust.open && <AdjustPanel adjust={adjust} />}
                {floating ? (
                  <AwayButton targets={draft.targets} anchor={anchor} slot={select.slotHeight} onReturn={dockComposer} />
                ) : (
                  composer
                )}
              </>
            }
          />
        )}
        {notesAvailable && (
          <RailButton
            icon="message"
            label="Feedback"
            count={count}
            controls={`${id}-notes`}
            open={notesOpen}
            onClick={(event) => {
              if (notesOpen) closePanel('notes');
              else {
                update({ expanded: false });
                startFeedback(event.detail > 0);
              }
            }}
          />
        )}
      </Rail>
    </div>
  );
}

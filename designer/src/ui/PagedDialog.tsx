// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * PagedDialog, the shared "setup" dialog shell.
 *
 * Counterpart: `common/widgets/paged_dialog.cpp` (PAGED_DIALOG), the base class
 * KiCad reuses for Schematic Setup, Board Setup and Preferences. It provides:
 *   - a top info bar (read-only / warning messages),
 *   - a treebook on the left: expandable section nodes with indented sub-pages,
 *     up/down keyboard navigation, and last-visited-page memory keyed by title,
 *   - a bottom button row: an optional "Reset to Defaults" (label becomes
 *     "Reset <Page> to Defaults" and is enabled only for resettable pages), an
 *     optional auxiliary action (e.g. "Import Settings from Another Project..."),
 *     a stretch spacer, then Cancel / OK,
 *   - an initial size and a resize border (min clamp 600x500).
 *
 * Each concrete dialog (DialogSchematicSetup, DialogBoardSetup) supplies its own
 * page tree and panel renderers; this component owns the chrome and selection.
 */

import { useEffect, useRef, useState, type JSX } from 'react';
import { useModalEscape } from './useModalEscape.js';
import { usePagedDialogSize } from './paged_dialog_size.js';
import { PagedDialogTree } from './PagedDialogTree.js';

export interface PagedDialogPage {
  /** Stable page id (also the selection key). */
  id: string;
  /** Tree label, matches KiCad's page title. */
  label: string;
  /** Greyed / not selectable: engine data not modelled yet. */
  disabled?: boolean;
  /** Whether this page can be reset to defaults (drives the Reset button). */
  resettable?: boolean;
  /** ResetPanel(): restore this page's slice to defaults (onResetButton). */
  onReset?: () => void;
  /** Resolves the panel shown on the right (KiCad's AddLazySubPage). */
  render: () => JSX.Element;
}

export interface PagedDialogSection {
  /** Section header label, an expandable parent node (empty page upstream). */
  label: string;
  pages: PagedDialogPage[];
}

interface Props {
  /** Window title; also the key under which the last page is remembered. */
  title: string;
  sections: PagedDialogSection[];
  /** Page to open on (ShowSchematicSetupDialog's aInitialPage). */
  initialPage?: string;
  /** Show the "Reset to Defaults" button (aShowReset). */
  showReset?: boolean;
  /** onAuxiliaryAction (Import Settings from Another Project…). */
  onAuxiliaryAction?: () => void;
  /** Auxiliary action label, e.g. "Import Settings from Another Project..."; omitted = no button. */
  auxiliaryAction?: string;
  /** Message shown in the top info bar (e.g. project read-only). */
  infoBar?: string;
  /**
   * `PAGED_DIALOG`'s `aInitialSize`, which every subclass states as a literal
   * at its own call site — `wxSize( 980, 600 )` in `dialog_board_setup.cpp:63`,
   * `wxSize( 920, 460 )` in `dialog_schematic_setup.cpp:47`. It is DATA, and it
   * is the size the dialog has for its whole life: see `paged_dialog_size.ts`
   * for why one stated size is the port of `newSize.IncTo( minSize )` here.
   */
  initialSize: { width: number; height: number };
  /**
   * OK. Returning a PagedDialogError vetoes the close, the way a page's
   * `TransferDataFromWindow` returning false does upstream: `PAGED_DIALOG::
   * SetError` (`common/widgets/paged_dialog.cpp:292-302`) puts the message in
   * the info bar for 10 s with a warning icon, then focuses the offending
   * control and selects all of its text. Returning nothing accepts.
   */
  onOk: () => PagedDialogError | void;
  onCancel: () => void;
}

/** What `SetError( aMessage, aPage, aCtrl )` needs to say. */
export interface PagedDialogError {
  message: string;
  /** Page id to bring forward — `SetError`'s `aPage`. */
  page: string;
  /**
   * `document.getElementById` of the control to focus and select — `aCtrl`.
   * Omitted when the offending value has no single control.
   */
  focusId?: string;
}

/** `m_infoBar->ShowMessageFor( aMessage, 10000, … )` (`paged_dialog.cpp:295`). */
const INFOBAR_MS = 10_000;

// Last-selected page per dialog title, so re-opening lands where you left off
// (PAGED_DIALOG's g_lastPage). Module-scoped to survive dialog unmount.
const g_lastPage: Record<string, string> = {};

/** Enabled pages in tree order, the set up/down navigation walks. */
function enabledOrder(sections: PagedDialogSection[]): string[] {
  return sections.flatMap((s) => s.pages.filter((p) => !p.disabled).map((p) => p.id));
}

export function PagedDialog({
  title,
  sections,
  initialPage,
  showReset,
  auxiliaryAction,
  onAuxiliaryAction,
  infoBar,
  initialSize,
  onOk,
  onCancel,
}: Props): JSX.Element {
  // wxDialog maps Esc to wxID_CANCEL for free; ours has to ask. See
  // ui/modal_escape.ts.
  useModalEscape(onCancel);

  const order = enabledOrder(sections);
  const firstEnabled = order[0] ?? '';

  const [page, setPageState] = useState<string>(() => {
    const remembered = g_lastPage[title];
    const wanted = initialPage ?? remembered ?? firstEnabled;
    return order.includes(wanted) ? wanted : firstEnabled;
  });
  // Collapsed section labels (all expanded by default, like ExpandNode on every node).
  const [collapsed, setCollapsed] = useState<Set<string>>(() => new Set());
  // The transient message `SetError` puts in the info bar. It replaces the
  // caller's standing `infoBar` for as long as it shows, which is what a
  // wxInfoBar does — there is only ever one of it.
  const [error, setError] = useState<string | null>(null);

  const handleOk = (): void => {
    const err = onOk();
    if (!err) return;

    setError(err.message);
    window.setTimeout(() => setError(null), INFOBAR_MS);
    setPage(err.page);

    if (err.focusId !== undefined) {
      const id = err.focusId;
      // After the page swap has rendered the control we are focusing.
      window.setTimeout(() => {
        const ctl = document.getElementById(id);
        if (ctl instanceof HTMLInputElement || ctl instanceof HTMLTextAreaElement) {
          ctl.focus();
          ctl.select(); // `textCtrl->SetSelection( -1, -1 )`.
        } else ctl?.focus();
      }, 0);
    }
  };

  const setPage = (id: string): void => {
    g_lastPage[title] = id;
    setPageState(id);
  };

  const allPages = sections.flatMap((s) => s.pages);
  const active = allPages.find((p) => p.id === page);

  // Up/Down move between enabled pages (PAGED_DIALOG::onCharHook), unless focus is
  // in a text field / grid where the arrows mean something else.
  const treeRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = treeRef.current;
    if (!el) return;
    const onKey = (e: KeyboardEvent): void => {
      if (e.key !== 'ArrowUp' && e.key !== 'ArrowDown') return;
      const tag = (e.target as HTMLElement).tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;
      const i = order.indexOf(page);
      if (i === -1) return;
      const next = e.key === 'ArrowDown' ? Math.min(i + 1, order.length - 1) : Math.max(i - 1, 0);
      const target = order[next];
      if (target && target !== page) {
        e.preventDefault();
        setPage(target);
      }
    };
    el.addEventListener('keydown', onKey);
    return () => el.removeEventListener('keydown', onKey);
  });

  const toggleSection = (label: string): void =>
    setCollapsed((prev) => {
      const next = new Set(prev);
      if (next.has(label)) next.delete(label);
      else next.add(label);
      return next;
    });

  // The floor, which only ever rises — `newSize.IncTo( minSize )`. It is the
  // second half of the size rule; `initialSize` below is the first.
  const dlgRef = usePagedDialogSize(page, initialSize, title);

  const resetLabel =
    active?.resettable && active.label ? `Reset ${active.label} to Defaults` : 'Reset to Defaults';

  return (
    <div className="ze-modal-backdrop" onMouseDown={onCancel}>
      {/* ONE size, for every page.

          `DIALOG_SHIM` is constructed with `aInitialSize` and
          `onPageChanged` only ever grows it — `newSize.IncTo( minSize )`
          (paged_dialog.cpp:446-450) is a componentwise MAXIMUM, so a smaller
          page never shrinks the window back. A wx dialog therefore sits at
          one size while the user walks the tree.

          A CSS dialog does the opposite by default: `.ze-modal` is
          `width/height: max-content`, which tracks whichever page is mounted,
          and Board Setup visibly re-sized itself on every row of the tree —
          tall and narrow on Board Editor Layers, short and wide on
          Constraints. `usePagedDialogSize`'s floor could not stop that,
          because a floor does not stop `max-content` from going ABOVE it.

          So the size is stated, from the subclass's own `aInitialSize`, and
          the page area scrolls when a page wants more — the same answer
          `.ze-prefs-dialog` already reached, and for the same reason. */}
      <div
        className="ze-modal ze-paged-dialog"
        ref={dlgRef}
        onMouseDown={(e) => e.stopPropagation()}
      >
        <div className="ze-modal-header">
          {title}
          <span className="x" title="Cancel" onClick={onCancel}>
            ✕
          </span>
        </div>

        {/* One wxInfoBar: SetError's message takes it over while it shows. */}
        {(error ?? infoBar) && (
          <div className="ze-paged-infobar" role={error ? 'alert' : undefined}>
            {error ?? infoBar}
          </div>
        )}

        <div className="ze-modal-body">
          <PagedDialogTree
            sections={sections}
            page={page}
            collapsed={collapsed}
            onToggleSection={toggleSection}
            onSelect={setPage}
            treeRef={treeRef}
          />

          <div className="ze-paged-panel">
            {active && !active.disabled ? (
              active.render()
            ) : (
              // A greyed page. `--ze-muted` is not a token this stylesheet
              // declares, so the `#888` fallback was what actually painted, at
              // a font size nothing upstream states either.
              <div className="ze-paged-unimplemented">This setup page is not implemented yet.</div>
            )}
          </div>
        </div>

        <div className="ze-modal-footer ze-paged-footer">
          {showReset && (
            // onResetButton: enabled only for resettable pages, exactly like
            // KiCad; ResetPanel() restores the active page's slice to defaults.
            <button
              className="ze-btn"
              disabled={!(active?.resettable && active.onReset)}
              title="Reset this page to defaults"
              onClick={() => active?.onReset?.()}
            >
              {resetLabel}
            </button>
          )}
          {auxiliaryAction && (
            <button className="ze-btn" disabled={!onAuxiliaryAction} onClick={onAuxiliaryAction}>
              {auxiliaryAction}
            </button>
          )}
          <div className="ze-paged-footer-spacer" />
          <button className="ze-btn" onClick={onCancel}>
            Cancel
          </button>
          <button className="ze-btn primary" onClick={handleOk}>
            OK
          </button>
        </div>
      </div>
    </div>
  );
}

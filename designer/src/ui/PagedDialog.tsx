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
  onOk: () => void;
  onCancel: () => void;
}

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

  // Was `const size = initialSize ?? { width: 920, height: 460 }` - computed
  // and never read, while the two callers passed 920x600 and 1150x620 into it.
  // Three picked sizes, none of which reached the DOM. The real rule is the
  // shared one below.
  const dlgSize = usePagedDialogSize(page);

  const resetLabel =
    active?.resettable && active.label ? `Reset ${active.label} to Defaults` : 'Reset to Defaults';

  return (
    <div className="ze-modal-backdrop" onMouseDown={onCancel}>
      {/* `newSize.IncTo( minSize )` (paged_dialog.cpp:446-450): the dialog
          grows to fit a page and never shrinks back, so changing page does not
          resize it under the user. Board Setup, Schematic Setup and Preferences
          all take it from `usePagedDialogSize`, because upstream states it once
          in PAGED_DIALOG and all three derive from that. */}
      <div
        className="ze-modal ze-paged-dialog"
        ref={dlgSize.ref}
        style={dlgSize.style}
        onMouseDown={(e) => e.stopPropagation()}
      >
        <div className="ze-modal-header">
          {title}
          <span className="x" title="Cancel" onClick={onCancel}>
            ✕
          </span>
        </div>

        {infoBar && <div className="ze-paged-infobar">{infoBar}</div>}

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
              <div style={{ padding: 16, color: 'var(--ze-muted, #888)', fontSize: 12 }}>
                This setup page is not implemented yet.
              </div>
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
          <button className="ze-btn primary" onClick={onOk}>
            OK
          </button>
        </div>
      </div>
    </div>
  );
}

// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * `pcbnew/dialogs/dialog_drc_base.cpp` (DIALOG_DRC_BASE): the window of the
 * DRC dialog, rendered from `DIALOG_DRC` (dialog_drc_model.ts), which is the
 * dialog's own code. The widgets and their order are the generated base's:
 * the two option boxes and the config button, the running/results simplebook,
 * the four-page notebook (Violations, Unconnected Items, Schematic Parity,
 * Ignored Tests) over RC_TREE_MODEL trees, the "Show:" severity row with its
 * badges and Save..., the Delete Marker / Delete All Markers / Run DRC /
 * Close row, and the two-field status bar DIALOG_DRC adds below.
 *
 * Modeless like upstream: it floats over the canvas, dragged by its title
 * bar and resized from its corner. The chrome is the ERC dialog's - the two
 * are the same wx widgets on the same DIALOG_SHIM.
 */
import { useEffect, useMemo, useRef, useState, type JSX } from 'react';
import { rcTreeRowStyle, rcTreeTextColour } from '../../../ui/rc_tree_style.js';
import type {
  RC_TREE_MODEL,
  RC_TREE_NODE,
  RC_TREE_VIEW_STATE,
} from '@ziroeda/common/src/rc_item.js';
import { RC_TREE_NODE_TYPE } from '@ziroeda/common/src/rc_item.js';
import { ContextMenu, type MenuItem } from '../../../ui/MenuBar.js';
import { bitmapUrl } from '../../../ui/toolbarIcons.js';
import { useModalEscape } from '../../../ui/useModalEscape.js';
import type { DIALOG_DRC, DrcMenuRow, IgnoredRow } from './dialog_drc_model.js';

/** What a NUMBER_BADGE paints for one count, or null when it paints nothing. */
interface Badge {
  text: string;
  kind: 'err' | 'warn' | 'excl' | 'zero';
}

/**
 * `NUMBER_BADGE::UpdateNumber` (number_badge.cpp:43-92) + the "+" cap of its
 * paint (:177-180): a negative number hides the badge; zero is green for an
 * error or warning severity and hidden otherwise; past the maximum it reads
 * "max+".
 */
function numberBadge(
  aNumber: number,
  aMax: number,
  aSeverity: 'error' | 'warning' | 'exclusion',
): Badge | null {
  if (aNumber < 0) return null;

  if (aNumber === 0) {
    if (aSeverity === 'exclusion') return null;

    return { text: '0', kind: 'zero' };
  }

  const text = aNumber > aMax ? `${aMax}+` : `${aNumber}`;

  return { text, kind: aSeverity === 'error' ? 'err' : aSeverity === 'warning' ? 'warn' : 'excl' };
}

const toMenuItems = (rows: DrcMenuRow[]): MenuItem[] =>
  rows.map((r) =>
    r.sep
      ? { sep: true }
      : {
          label: r.label,
          checked: r.checked,
          action: () => {
            void r.action?.();
          },
        },
  );

interface Props {
  dialog: DIALOG_DRC;
  /** `Kiface().IsSingle()`: hides the parity box. */
  isSingle: boolean;
  /** Whether a ZONE_FILLER_TOOL is registered: without one the refill box has nothing to run. */
  canRefillZones: boolean;
  /** The dialog root, the frame's findDialogRects reads its rect. */
  rootRef: { current: HTMLDivElement | null };
}

/** One RC_TREE_MODEL as a wxDataViewCtrl: the marker rows and their item children. */
function MarkerTree({
  dialog,
  model,
  view,
  onContextMenu,
}: {
  dialog: DIALOG_DRC;
  model: RC_TREE_MODEL;
  view: RC_TREE_VIEW_STATE;
  onContextMenu: (e: React.MouseEvent, node: RC_TREE_NODE) => void;
}): JSX.Element {
  const selectedRowRef = useRef<HTMLDivElement>(null);
  const selection = view.GetSelection();

  // `EnsureVisible( ToItem( candidate ) )`: the selected row scrolls into view.
  // biome-ignore lint/correctness/useExhaustiveDependencies: the selection is the trigger; the ref is read
  useEffect(() => {
    selectedRowRef.current?.scrollIntoView({ block: 'nearest' });
  }, [selection]);

  const textColour = useMemo(rcTreeTextColour, []);

  const rowStyle = (node: RC_TREE_NODE): React.CSSProperties =>
    rcTreeRowStyle(model.GetAttr(node, textColour), textColour);

  return (
    <div className="ze-erc-list" data-testid="drc-violation-list">
      {model.GetTree().map((node, i) => (
        <div key={i} className="ze-erc-item">
          <div
            ref={selection === node ? selectedRowRef : undefined}
            className={`ze-erc-row${selection === node ? ' selected' : ''}`}
            style={rowStyle(node)}
            onClick={() => view.Select(node)}
            onDoubleClick={() => dialog.OnDRCItemDClick(node)}
            onContextMenu={(e) => {
              e.preventDefault();
              view.Select(node);
              onContextMenu(e, node);
            }}
          >
            {/* the expander of a container row; every marker row is expanded (ExpandAll) */}
            <span className="twisty expandable open" />
            <span className="msg">{model.GetValue(node)}</span>
          </div>
          {node.m_Children.map((child, k) => (
            <div
              key={k}
              className={`ze-erc-subrow${selection === child ? ' selected' : ''}${
                child.m_Type === RC_TREE_NODE_TYPE.COMMENT ? ' comment' : ''
              }`}
              style={rowStyle(child)}
              onClick={() => view.Select(child)}
              onDoubleClick={() => dialog.OnDRCItemDClick(child)}
              onContextMenu={(e) => {
                e.preventDefault();
                view.Select(child);
                onContextMenu(e, child);
              }}
            >
              {model.GetValue(child)}
            </div>
          ))}
        </div>
      ))}
    </div>
  );
}

export function DialogDrc({ dialog, isSingle, canRefillZones, rootRef }: Props): JSX.Element {
  // The dialog's state lives in DIALOG_DRC; every change re-renders.
  const [, force] = useState(0);
  useEffect(() => dialog.subscribe(() => force((n) => n + 1)), [dialog]);

  const [menu, setMenu] = useState<{ x: number; y: number; items: MenuItem[] } | null>(null);

  // ----- movable / resizable panel (a DIALOG_SHIM is a real window) ---------
  const panelRef = rootRef;
  const dragStart = (down: React.PointerEvent): void => {
    const panel = panelRef.current;
    if (!panel || (down.target as HTMLElement).closest('.x')) return;
    const box = panel.getBoundingClientRect();
    down.preventDefault();
    const dx = down.clientX - box.left;
    const dy = down.clientY - box.top;
    panel.style.right = 'auto';
    panel.style.bottom = 'auto';
    const move = (e: PointerEvent): void => {
      panel.style.left = `${Math.max(0, Math.min(window.innerWidth - 80, e.clientX - dx))}px`;
      panel.style.top = `${Math.max(0, Math.min(window.innerHeight - 40, e.clientY - dy))}px`;
    };
    const up = (): void => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
  };

  // Escape is the dialog's Close (OnCancelClick: a running DRC is cancelled instead).
  useModalEscape(() => dialog.OnCancelClick());

  const openMenu = (e: React.MouseEvent, rows: DrcMenuRow[]): void => {
    setMenu({ x: e.clientX, y: e.clientY, items: toMenuItems(rows) });
  };

  const treeMenu =
    (model: RC_TREE_MODEL) =>
    (e: React.MouseEvent, node: RC_TREE_NODE): void =>
      openMenu(e, dialog.OnDRCItemRClick(model, node));

  const page = dialog.m_notebookSelection;
  const running = dialog.m_runningResultsBook === 0;

  const errorsBadge = numberBadge(dialog.m_errorsBadge.number, dialog.m_errorsBadge.max, 'error');
  const warningsBadge = numberBadge(
    dialog.m_warningsBadge.number,
    dialog.m_warningsBadge.max,
    'warning',
  );
  const exclusionsBadge = numberBadge(
    dialog.m_exclusionsBadge.number,
    dialog.m_exclusionsBadge.max,
    'exclusion',
  );

  return (
    <div
      className="ze-erc-panel ze-drc-panel"
      ref={panelRef}
      onMouseDown={(e) => e.stopPropagation()}
    >
      <div className="ze-modal-header ze-drag-handle" onPointerDown={dragStart}>
        DRC Control
        <span className="x" onClick={() => dialog.OnCancelClick()}>
          ✕
        </span>
      </div>

      {/* gbSizerOptions: the two option boxes, the config menu button at the right */}
      <div className="ze-drc-options">
        <label className="chk">
          <input
            type="checkbox"
            checked={dialog.m_cbRefillZones && canRefillZones}
            disabled={!canRefillZones}
            onChange={(e) => {
              dialog.m_cbRefillZones = e.target.checked;
              force((n) => n + 1);
            }}
          />
          Refill all zones before performing DRC
        </label>
        {!isSingle && (
          <label className="chk">
            <input
              type="checkbox"
              checked={dialog.m_cbTestFootprints}
              onChange={(e) => {
                dialog.m_cbTestFootprints = e.target.checked;
                force((n) => n + 1);
              }}
            />
            Test for parity between PCB and schematic
          </label>
        )}
        <span className="grow" />
        <button
          type="button"
          className="ze-erc-menu-btn"
          onClick={(e) => {
            const r = (e.currentTarget as HTMLElement).getBoundingClientRect();
            setMenu({ x: r.left, y: r.bottom, items: toMenuItems(dialog.OnMenu()) });
          }}
        >
          {/* m_bMenu->SetBitmap( KiBitmapBundle( BITMAPS::config ) ) */}
          {bitmapUrl('config') ? <img src={bitmapUrl('config')} alt="" /> : '⚙'}
        </button>
      </div>

      {running ? (
        <>
          {/* m_runningNotebook: the one "Tests Running..." page */}
          <div className="ze-erc-tabs">
            <div className="tab active">Tests Running...</div>
          </div>
          <div className="ze-erc-list" data-testid="drc-running">
            {/* m_messages, a WX_HTML_REPORT_BOX: the report lines are html */}
            {dialog.m_messages.map((line, i) => (
              <div
                key={i}
                className="ze-erc-progress-line"
                // biome-ignore lint/security/noDangerouslySetInnerHtml: the lines are the dialog's own html (Report())
                dangerouslySetInnerHTML={{ __html: line }}
                onClick={(e) => {
                  // OnErrorLinkClicked: the '$CUSTOM_RULES' link opens Board Setup > Custom Rules
                  if ((e.target as HTMLElement).tagName === 'A') {
                    e.preventDefault();
                    dialog.OnErrorLinkClicked();
                  }
                }}
              />
            ))}
            <div className="ze-erc-gauge">
              <div className="bar" style={{ width: `${dialog.m_gauge / 10}%` }} />
            </div>
          </div>
        </>
      ) : (
        <>
          <div className="ze-erc-tabs">
            {dialog.m_pageTitles.map((title, i) => (
              <div
                key={i}
                className={`tab${page === i ? ' active' : ''}`}
                onClick={() => dialog.OnChangingNotebookPage(i)}
              >
                {title}
              </div>
            ))}
          </div>
          {page === 0 && (
            <MarkerTree
              dialog={dialog}
              model={dialog.m_markersTreeModel}
              view={dialog.m_markerDataView}
              onContextMenu={treeMenu(dialog.m_markersTreeModel)}
            />
          )}
          {page === 1 && (
            <MarkerTree
              dialog={dialog}
              model={dialog.m_unconnectedTreeModel}
              view={dialog.m_unconnectedDataView}
              onContextMenu={treeMenu(dialog.m_unconnectedTreeModel)}
            />
          )}
          {page === 2 && (
            <MarkerTree
              dialog={dialog}
              model={dialog.m_fpWarningsTreeModel}
              view={dialog.m_footprintsDataView}
              onContextMenu={treeMenu(dialog.m_fpWarningsTreeModel)}
            />
          )}
          {page === 3 && (
            <div className="ze-erc-list">
              {dialog.m_ignoredList.map((row: IgnoredRow, i) => (
                <div
                  key={i}
                  className="ze-erc-row"
                  onContextMenu={(e) => {
                    e.preventDefault();
                    openMenu(e, dialog.OnIgnoredItemRClick(row));
                  }}
                >
                  <span className="msg" style={{ fontWeight: 400 }}>
                    {row.text}
                  </span>
                </div>
              ))}
              <a className="ze-erc-link" onClick={() => dialog.OnEditViolationSeverities()}>
                Edit ignored tests
              </a>
            </div>
          )}
        </>
      )}

      {/* bSeveritySizer */}
      <div className="ze-erc-footer">
        <span className="show-label">Show:</span>
        <label className="chk">
          <input
            type="checkbox"
            checked={dialog.m_showAll}
            onChange={(e) => dialog.OnSeverity('all', e.target.checked)}
          />
          All
        </label>
        <span className="gap-35" />
        <label className="chk">
          <input
            type="checkbox"
            checked={dialog.m_showErrors}
            onChange={(e) => dialog.OnSeverity('errors', e.target.checked)}
          />
          Errors
        </label>
        {errorsBadge && <span className={`badge ${errorsBadge.kind}`}>{errorsBadge.text}</span>}
        <span className="gap-25" />
        <label className="chk">
          <input
            type="checkbox"
            checked={dialog.m_showWarnings}
            onChange={(e) => dialog.OnSeverity('warnings', e.target.checked)}
          />
          Warnings
        </label>
        {warningsBadge && (
          <span className={`badge ${warningsBadge.kind}`}>{warningsBadge.text}</span>
        )}
        <span className="gap-25" />
        <label className="chk">
          <input
            type="checkbox"
            checked={dialog.m_showExclusions}
            onChange={(e) => dialog.OnSeverity('exclusions', e.target.checked)}
          />
          Exclusions
        </label>
        {exclusionsBadge && (
          <span className={`badge ${exclusionsBadge.kind}`}>{exclusionsBadge.text}</span>
        )}
        <span className="grow" />
        <button
          type="button"
          className="ze-btn"
          disabled={!dialog.m_saveEnabled}
          onClick={() => void dialog.OnSaveReport()}
        >
          Save...
        </button>
      </div>

      {/* m_sizerButtons */}
      <div className="ze-erc-buttons">
        <button
          type="button"
          className="ze-btn"
          disabled={!dialog.m_deleteEnabled}
          onClick={() => dialog.OnDeleteOneClick()}
        >
          Delete Marker
        </button>
        <button
          type="button"
          className="ze-btn"
          disabled={!dialog.m_deleteEnabled}
          onClick={() => void dialog.OnDeleteAllClick()}
        >
          Delete All Markers
        </button>
        <span className="grow" />
        <button type="button" className="ze-btn" onClick={() => dialog.OnCancelClick()}>
          {dialog.m_cancelLabel}
        </button>
        <button
          type="button"
          className="ze-btn primary"
          disabled={!dialog.m_okEnabled}
          onClick={() => dialog.OnRunDRCClick()}
        >
          Run DRC
        </button>
      </div>

      {/* m_drcStatusBar: two fields, 12 px and the rest */}
      <div className="ze-drc-statusbar">
        <span className="field0" />
        <span className="field1">{dialog.m_statusText}</span>
      </div>

      {menu && (
        <ContextMenu x={menu.x} y={menu.y} items={menu.items} onClose={() => setMenu(null)} />
      )}
    </div>
  );
}

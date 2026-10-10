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
import { Button, CheckBox } from '@ziroeda/common/wx/controls.js';
import { useEffect, useMemo, useRef, useState, type JSX } from 'react';
import { RcTreeView } from '@ziroeda/common/widgets/rc_tree_view.js';
import type { RC_TREE_MODEL, RC_TREE_NODE, RC_TREE_VIEW_STATE } from '@ziroeda/common/rc_item.js';
import { RC_TREE_NODE_TYPE } from '@ziroeda/common/rc_item.js';
import { ContextMenu, type MenuItem } from '@ziroeda/common/tool/action_menu_bar.js';
import { KiBitmapBundle } from '@ziroeda/common/bitmap.js';
import { BITMAPS } from '@ziroeda/common/bitmaps/bitmaps_list.js';
import { useModalEscape } from '@ziroeda/common/dialog_shim.js';
import { NumberBadge } from '@ziroeda/common/widgets/number_badge.js';
import {
  RPT_SEVERITY_ERROR,
  RPT_SEVERITY_EXCLUSION,
  RPT_SEVERITY_WARNING,
} from '@ziroeda/common/reporter.js';
import type { DIALOG_DRC, DrcMenuRow, IgnoredRow } from './dialog_drc_model.js';

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
        <CheckBox
          label="Refill all zones before performing DRC"
          checked={dialog.m_cbRefillZones && canRefillZones}
          disabled={!canRefillZones}
          className="chk"
          onChange={(aChecked) => {
            dialog.m_cbRefillZones = aChecked;
            force((n) => n + 1);
          }}
        />
        {!isSingle && (
          <CheckBox
            label="Test for parity between PCB and schematic"
            checked={dialog.m_cbTestFootprints}
            className="chk"
            onChange={(aChecked) => {
              dialog.m_cbTestFootprints = aChecked;
              force((n) => n + 1);
            }}
          />
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
          <img src={KiBitmapBundle(BITMAPS.config)} alt="" />
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
            <RcTreeView
              onDoubleClick={(node) => dialog.OnDRCItemDClick(node)}
              testId="drc-violation-list"
              model={dialog.m_markersTreeModel}
              view={dialog.m_markerDataView}
              onContextMenu={treeMenu(dialog.m_markersTreeModel)}
            />
          )}
          {page === 1 && (
            <RcTreeView
              onDoubleClick={(node) => dialog.OnDRCItemDClick(node)}
              testId="drc-violation-list"
              model={dialog.m_unconnectedTreeModel}
              view={dialog.m_unconnectedDataView}
              onContextMenu={treeMenu(dialog.m_unconnectedTreeModel)}
            />
          )}
          {page === 2 && (
            <RcTreeView
              onDoubleClick={(node) => dialog.OnDRCItemDClick(node)}
              testId="drc-violation-list"
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
        <CheckBox
          label="All"
          checked={dialog.m_showAll}
          className="chk"
          onChange={(aChecked) => dialog.OnSeverity('all', aChecked)}
        />
        <span className="gap-35" />
        <CheckBox
          label="Errors"
          checked={dialog.m_showErrors}
          className="chk"
          onChange={(aChecked) => dialog.OnSeverity('errors', aChecked)}
        />
        <NumberBadge
          number={dialog.m_errorsBadge.number}
          max={dialog.m_errorsBadge.max}
          severity={RPT_SEVERITY_ERROR}
        />
        <span className="gap-25" />
        <CheckBox
          label="Warnings"
          checked={dialog.m_showWarnings}
          className="chk"
          onChange={(aChecked) => dialog.OnSeverity('warnings', aChecked)}
        />
        <NumberBadge
          number={dialog.m_warningsBadge.number}
          max={dialog.m_warningsBadge.max}
          severity={RPT_SEVERITY_WARNING}
        />
        <span className="gap-25" />
        <CheckBox
          label="Exclusions"
          checked={dialog.m_showExclusions}
          className="chk"
          onChange={(aChecked) => dialog.OnSeverity('exclusions', aChecked)}
        />
        <NumberBadge
          number={dialog.m_exclusionsBadge.number}
          max={dialog.m_exclusionsBadge.max}
          severity={RPT_SEVERITY_EXCLUSION}
        />
        <span className="grow" />
        <Button
          label="Save..."
          disabled={!dialog.m_saveEnabled}
          onClick={() => void dialog.OnSaveReport()}
        />
      </div>

      {/* m_sizerButtons */}
      <div className="ze-erc-buttons">
        <Button
          label="Delete Marker"
          disabled={!dialog.m_deleteEnabled}
          onClick={() => dialog.OnDeleteOneClick()}
        />
        <Button
          label="Delete All Markers"
          disabled={!dialog.m_deleteEnabled}
          onClick={() => void dialog.OnDeleteAllClick()}
        />
        <span className="grow" />
        <Button label={dialog.m_cancelLabel} onClick={() => dialog.OnCancelClick()} />
        <Button
          label="Run DRC"
          isDefault
          disabled={!dialog.m_okEnabled}
          onClick={() => dialog.OnRunDRCClick()}
        />
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

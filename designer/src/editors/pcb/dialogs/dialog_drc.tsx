// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * DRC dialog, second slice. Counterpart: `pcbnew/dialogs/dialog_drc.cpp`
 * (DIALOG_DRC), a MODELESS dialog like upstream: Run DRC over the board with
 * the Board Setup constraints, netclass clearances and violation severities.
 * The violations live in the editor (they are the board's PCB_MARKERs, drawn
 * on the canvas in the theme's DRC colors) and survive closing the dialog.
 *
 * Click-to-locate mirrors OnDRCItemSelected: clicking a violation row focuses
 * the marker (FocusOnLocation, centre only when off-view / edge / behind the
 * dialog) and brightens it (the LAYER_DRC_HIGHLIGHTED repaint + collision X);
 * clicking an offending-item child row focuses that item instead. A
 * double-click hides the dialog, turning control over to the frame
 * (OnDRCItemDClick). Footer: Delete Marker / Delete All Markers, Run DRC,
 * Close. (Exclusions and the unconnected-items/footprints tabs follow in
 * later slices.)
 */
import { useState, type JSX, type Ref } from 'react';
import type { DrcViolation } from '@ziroeda/pcbnew';
import type { DrcSeverities } from '../board_settings.js';

interface Props {
  /** Run the engine and store the results in the editor. */
  run: () => void;
  results: DrcViolation[] | null;
  severities: DrcSeverities;
  /** Index (into results) of the active violation, or null. */
  selected: number | null;
  /** Row clicked: brighten marker `index` and focus `pos`. */
  onSelect: (index: number, pos: { x: number; y: number }) => void;
  onDeleteMarker: (index: number) => void;
  onDeleteAll: () => void;
  onClose: () => void;
  /** The dialog root, the editor's FocusOnLocation avoids this rect. */
  rootRef?: Ref<HTMLDivElement>;
}

export function DialogDrc({
  run,
  results,
  severities,
  selected,
  onSelect,
  onDeleteMarker,
  onDeleteAll,
  onClose,
  rootRef,
}: Props): JSX.Element {
  const [running, setRunning] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const doRun = (): void => {
    setRunning(true);
    setError(null);
    // Yield a tick so the button state paints before the (sync) run. NOTE:
    // setTimeout, not requestAnimationFrame, rAF never fires in a hidden
    // tab, which would leave the dialog stuck on "Running…".
    setTimeout(() => {
      try {
        run();
      } catch (e) {
        setError(e instanceof Error ? (e.stack ?? e.message) : String(e));
      } finally {
        setRunning(false);
      }
    });
  };

  const severityOf = (code: string): 'error' | 'warning' =>
    severities[code] === 'warning' ? 'warning' : 'error';
  const errorCount = results?.filter((v) => severityOf(v.code) === 'error').length ?? 0;
  const warningCount = (results?.length ?? 0) - errorCount;

  const row = (v: DrcViolation, i: number): JSX.Element => (
    <div
      key={i}
      style={{
        borderBottom: '1px solid var(--chrome-border)',
        fontSize: 12,
        background: selected === i ? 'var(--chrome-active, rgba(90,140,255,0.18))' : undefined,
        cursor: 'pointer',
      }}
      onClick={() => onSelect(i, v.pos)}
      onDoubleClick={onClose}
    >
      <div style={{ display: 'flex', gap: 8, alignItems: 'center', padding: '4px 8px' }}>
        <span
          style={{
            fontSize: 10.5,
            padding: '0 6px',
            borderRadius: 3,
            background: severityOf(v.code) === 'error' ? '#d75b6b' : '#c9a132',
            color: '#111',
            fontWeight: 600,
          }}
        >
          {severityOf(v.code) === 'error' ? 'Error' : 'Warning'}
        </span>
        <span>{v.message}</span>
      </div>
      {v.items.map((it, k) => (
        <div
          key={k}
          className="ze-muted"
          style={{ padding: '0 8px 2px 28px', fontSize: 11.5 }}
          onClick={(e) => {
            e.stopPropagation();
            onSelect(i, it.pos);
          }}
          onDoubleClick={onClose}
        >
          {it.desc} @ ({(it.pos.x / 1e4).toFixed(3)}, {(it.pos.y / 1e4).toFixed(3)}) mm
        </div>
      ))}
    </div>
  );

  return (
    <div
      ref={rootRef}
      className="ze-find-dialog ze-drc-dialog"
      onMouseDown={(e) => e.stopPropagation()}
    >
      <div className="ze-modal-header">
        DRC Control
        <span className="x" title="Close" onClick={onClose}>
          ✕
        </span>
      </div>
      <div style={{ display: 'block', padding: '10px 12px' }}>
        {error !== null && (
          <div style={{ color: '#d75b6b', fontSize: 12, whiteSpace: 'pre-wrap', marginBottom: 8 }}>
            DRC failed: {error}
          </div>
        )}
        {results === null ? (
          <div className="ze-muted" style={{ fontSize: 12.5, padding: '12px 0' }}>
            Click "Run DRC" to check the board against the Board Setup constraints, netclass
            clearances and custom severities.
          </div>
        ) : (
          <>
            <div style={{ fontSize: 12.5, marginBottom: 6 }}>
              {errorCount} error{errorCount === 1 ? '' : 's'}, {warningCount} warning
              {warningCount === 1 ? '' : 's'}
            </div>
            <div className="ze-grid-pane" style={{ maxHeight: 340, overflow: 'auto', padding: 0 }}>
              {results.length === 0 ? (
                <div className="ze-muted" style={{ padding: 12, fontSize: 12.5 }}>
                  No violations found.
                </div>
              ) : (
                results.map(row)
              )}
            </div>
          </>
        )}
      </div>
      <div className="ze-modal-footer" style={{ display: 'flex', gap: 6 }}>
        <button
          className="ze-btn"
          disabled={selected === null}
          onClick={() => selected !== null && onDeleteMarker(selected)}
        >
          Delete Marker
        </button>
        <button className="ze-btn" disabled={results === null} onClick={onDeleteAll}>
          Delete All Markers
        </button>
        <span style={{ flex: 1 }} />
        <button className="ze-btn" onClick={onClose}>
          Close
        </button>
        <button className="ze-btn primary" disabled={running} onClick={doRun}>
          {running ? 'Running…' : 'Run DRC'}
        </button>
      </div>
    </div>
  );
}

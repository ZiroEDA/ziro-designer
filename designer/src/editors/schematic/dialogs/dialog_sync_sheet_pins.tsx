// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * Sync Sheet Pins. Counterpart: `DIALOG_SYNC_SHEET_PINS` over
 * `PANEL_SYNC_SHEET_PINS` — a page per sheet, each showing the three lists the
 * engine sorts out.
 *
 * The two halves of a hierarchical connection live in different files: the pin
 * belongs to the sheet symbol in the *parent*, the label to the sheet's own
 * document. So each button writes to a different file, and the dialog says
 * which — a "sync" that silently edited a file you were not looking at would be
 * the wrong kind of helpful.
 *
 * Upstream's two "add" buttons are absent, and the panel says so rather than
 * showing something that cannot work: `PlaceSheetPin` / `PlaceHieraLable` hand
 * off to the interactive placement tool, so where a new item lands is a
 * question the user answers with the mouse. That is a design decision rather
 * than a port.
 *
 * A sheet with nothing unmatched still gets its page, with its counts, exactly
 * as the notebook keeps every tab: a page that vanished when it agreed would
 * make "in sync" indistinguishable from "not listed".
 */

import { useMemo, useState, type JSX } from 'react';
import {
  hasUnmatched,
  syncSheetPinBuckets,
  type SyncBuckets,
  type SyncLabel,
  type SyncPin,
} from '@ziroeda/eeschema';
import type { Schematic } from '@ziroeda/eeschema';

/** One sheet in the dialog: the parent's sheet symbol and the sheet's document. */
export interface SyncSheetEntry {
  /** The sheet symbol's index in the parent document. */
  sheetIndex: number;
  /** Display name (the Sheetname field). */
  name: string;
  /** The sub-sheet's file, which is where a label edit lands. */
  file: string;
  sub: Schematic;
}

interface Props {
  parent: Schematic;
  /** The parent's own file, which is where a pin edit lands. */
  parentFile: string;
  sheets: readonly SyncSheetEntry[];
  /** Give the pin the label's name and shape (writes the parent). */
  onUsePinTemplate: (entry: SyncSheetEntry, pin: SyncPin, label: SyncLabel) => void;
  /** Give the labels the pin's name and shape (writes the sub-sheet). */
  onUseLabelTemplate: (entry: SyncSheetEntry, label: SyncLabel, pin: SyncPin) => void;
  onClose: () => void;
}

function List<T extends { id: string; text: string; shape: string }>({
  title,
  items,
  selected,
  onSelect,
}: {
  title: string;
  items: readonly T[];
  selected: string | null;
  onSelect: (id: string) => void;
}): JSX.Element {
  return (
    <div style={{ flex: 1, minWidth: 0 }}>
      <div className="ze-panel-header">
        {title} ({items.length})
      </div>
      <div className="ze-props-grid-wrap" style={{ height: 200, overflow: 'auto' }}>
        <table className="ze-props-grid">
          <thead>
            <tr>
              <th>Name</th>
              <th>Shape</th>
            </tr>
          </thead>
          <tbody>
            {items.map((it) => (
              <tr
                key={it.id}
                className={selected === it.id ? 'sel' : ''}
                onClick={() => onSelect(it.id)}
                style={{ cursor: 'pointer' }}
              >
                <td>{it.text}</td>
                <td>{it.shape}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

export function DialogSyncSheetPins({
  parent,
  parentFile,
  sheets,
  onUsePinTemplate,
  onUseLabelTemplate,
  onClose,
}: Props): JSX.Element {
  const [page, setPage] = useState(0);
  const [labelSel, setLabelSel] = useState<string | null>(null);
  const [pinSel, setPinSel] = useState<string | null>(null);

  const entry = sheets[page];
  const buckets: SyncBuckets | null = useMemo(
    () =>
      entry
        ? syncSheetPinBuckets(parent.sheets[entry.sheetIndex]!, entry.sheetIndex, entry.sub)
        : null,
    [parent, entry],
  );

  const label = buckets?.labels.find((l) => l.id === labelSel) ?? null;
  const pin = buckets?.pins.find((p) => p.id === pinSel) ?? null;
  // GenericSync needs one of each: the buttons decide which of two disagreeing
  // items is right, so with only one selected there is nothing to decide.
  const canSync = !!label && !!pin;

  return (
    <div className="ze-modal-backdrop" onMouseDown={onClose}>
      <div
        className="ze-modal"
        style={{ width: 760, maxWidth: '96vw' }}
        onMouseDown={(e) => e.stopPropagation()}
      >
        <div className="ze-modal-header">
          Sync Sheet Pins
          <span className="x" title="Cancel" onClick={onClose}>
            ✕
          </span>
        </div>
        <div
          className="ze-label-dialog-body"
          style={{ display: 'flex', flexDirection: 'column', gap: 8 }}
        >
          {sheets.length > 1 && (
            <div className="ze-erc-tabs">
              {sheets.map((s, i) => {
                const b = syncSheetPinBuckets(parent.sheets[s.sheetIndex]!, s.sheetIndex, s.sub);
                return (
                  <div
                    key={s.file + s.sheetIndex}
                    className={`tab${i === page ? ' active' : ''}`}
                    onClick={() => {
                      setPage(i);
                      setLabelSel(null);
                      setPinSel(null);
                    }}
                    title={s.file}
                  >
                    {s.name || s.file} {hasUnmatched(b) ? '⚠' : '✓'}
                  </div>
                );
              })}
            </div>
          )}

          {!entry || !buckets ? (
            <div className="ze-muted" style={{ padding: 8 }}>
              This schematic has no sub-sheets.
            </div>
          ) : (
            <>
              <div style={{ display: 'flex', gap: 8 }}>
                <List
                  title="Labels in the sheet"
                  items={buckets.labels}
                  selected={labelSel}
                  onSelect={setLabelSel}
                />
                <List
                  title="Pins on the sheet symbol"
                  items={buckets.pins}
                  selected={pinSel}
                  onSelect={setPinSel}
                />
                <List
                  title="Already matched"
                  items={buckets.associated.map((a) => ({
                    id: a.label.id,
                    text: a.label.text,
                    shape: a.label.shape,
                  }))}
                  selected={null}
                  onSelect={() => undefined}
                />
              </div>

              <div className="row" style={{ gap: 8, alignItems: 'center' }}>
                {/* Each button writes a different file, and says which. */}
                <button
                  type="button"
                  className="ze-btn"
                  disabled={!canSync}
                  onClick={() => label && pin && onUsePinTemplate(entry, pin, label)}
                  title={`Renames the pin in ${parentFile}`}
                >
                  Use label as template →
                </button>
                <button
                  type="button"
                  className="ze-btn"
                  disabled={!canSync}
                  onClick={() => label && pin && onUseLabelTemplate(entry, label, pin)}
                  title={`Renames the labels in ${entry.file}`}
                >
                  ← Use pin as template
                </button>
                <span className="ze-muted">
                  {canSync
                    ? `'${label.text}' (${label.shape}) vs '${pin.text}' (${pin.shape})`
                    : 'Select one label and one pin to reconcile them.'}
                </span>
              </div>

              <div className="ze-muted">
                Adding a missing pin or label is not offered here: upstream places the new item with
                the mouse, and guessing a position would be worse than leaving it out.
              </div>
            </>
          )}
        </div>
        <div className="ze-modal-footer">
          <button type="button" className="ze-btn primary" onClick={onClose}>
            Close
          </button>
        </div>
      </div>
    </div>
  );
}

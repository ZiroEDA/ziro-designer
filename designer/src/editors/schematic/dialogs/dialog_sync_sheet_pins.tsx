// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * Sync Sheet Pins. Counterpart: `DIALOG_SYNC_SHEET_PINS` over
 * `PANEL_SYNC_SHEET_PINS` — a page per sheet, each showing the three lists the
 * engine sorts out and the six buttons that act on them.
 *
 * The two halves of a hierarchical connection live in different files: the pin
 * belongs to the sheet symbol in the *parent*, the label to the sheet's own
 * document. So each button writes to a different file, and the dialog says
 * which — a "sync" that silently edited a file you were not looking at would be
 * the wrong kind of helpful. That is also why the columns are headed the way
 * upstream heads them:
 *
 *     m_labelSymName->SetLabel( aSheet->GetShownName( true ) );   // the pins
 *     m_labelSheetName->SetLabel( aSheet->GetFileName() );        // the labels
 *
 * Both lists are multi-select (`wxDV_MULTIPLE`), because four of the buttons act
 * on a *set* of rows; the two template buttons take one row from each list.
 *
 * The two "Add" buttons do not drop the new item somewhere chosen for you.
 * Upstream hides the panel, arms the matching placement tool with the selected
 * rows as templates, and lets you click each one into place — so they close this
 * dialog and hand the queue back to the editor, which reopens it when the last
 * one lands.
 *
 * A sheet with nothing unmatched still gets its page, with its counts, exactly
 * as the notebook keeps every tab: a page that vanished when it agreed would
 * make "in sync" indistinguishable from "not listed".
 */

import { useMemo, useState, type JSX } from 'react';
import {
  hasUnmatched,
  reassociate,
  splitAssociated,
  syncSheetPinBuckets,
  type SyncBuckets,
  type SyncLabel,
  type SyncPin,
  type SyncTemplate,
} from '@ziroeda/eeschema';
import type { Schematic } from '@ziroeda/eeschema';
import { useModalEscape } from '../../../ui/useModalEscape.js';

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
  /** Which page to open on, if a sheet was selected when the tool ran. */
  initialPage?: number;
  /** Give the pin the label's name and shape (writes the parent). */
  onUsePinTemplate: (entry: SyncSheetEntry, pin: SyncPin, label: SyncLabel) => void;
  /** Give the labels the pin's name and shape (writes the sub-sheet). */
  onUseLabelTemplate: (entry: SyncSheetEntry, label: SyncLabel, pin: SyncPin) => void;
  /** Place a sheet pin per selected label, on the sheet symbol in the parent. */
  onAddSheetPins: (entry: SyncSheetEntry, templates: readonly SyncTemplate[]) => void;
  /** Place a hierarchical label per selected pin, inside the sub-sheet. */
  onAddHierLabels: (entry: SyncSheetEntry, templates: readonly SyncTemplate[]) => void;
  /** Delete the selected pins from the sheet symbol (writes the parent). */
  onDeletePins: (entry: SyncSheetEntry, pinIndices: readonly number[]) => void;
  /** Delete the selected labels from the sub-sheet (writes the sub-sheet). */
  onDeleteLabels: (entry: SyncSheetEntry, texts: readonly string[]) => void;
  onClose: () => void;
}

interface Row {
  id: string;
  text: string;
  shape: string;
}

/**
 * One of the three `wxDataViewCtrl`s. Multi-select the usual way: a plain click
 * replaces the selection, ctrl/cmd toggles a row, shift extends from the last
 * one clicked.
 */
function List({
  title,
  subtitle,
  rows,
  selected,
  onSelect,
  children,
}: {
  title: string;
  subtitle?: string;
  rows: readonly Row[];
  selected: ReadonlySet<string>;
  onSelect: (next: Set<string>, anchor: string) => void;
  children?: JSX.Element | JSX.Element[];
}): JSX.Element {
  const [anchor, setAnchor] = useState<string | null>(null);

  const click = (e: React.MouseEvent, id: string) => {
    const next = new Set(selected);
    if (e.shiftKey && anchor) {
      const from = rows.findIndex((r) => r.id === anchor);
      const to = rows.findIndex((r) => r.id === id);
      if (from >= 0 && to >= 0) {
        next.clear();
        for (let i = Math.min(from, to); i <= Math.max(from, to); i++) next.add(rows[i]!.id);
        onSelect(next, anchor);
        return;
      }
    }
    if (e.ctrlKey || e.metaKey) {
      if (next.has(id)) next.delete(id);
      else next.add(id);
    } else {
      next.clear();
      next.add(id);
    }
    setAnchor(id);
    onSelect(next, id);
  };

  return (
    <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column' }}>
      <div className="ze-panel-header">
        {title} ({rows.length})
      </div>
      {subtitle && (
        <div
          className="ze-muted"
          style={{ padding: '2px 4px', overflow: 'hidden' }}
          title={subtitle}
        >
          {subtitle}
        </div>
      )}
      <div className="ze-props-grid-wrap" style={{ height: 220, overflow: 'auto' }}>
        <table className="ze-props-grid">
          <thead>
            <tr>
              <th>Name</th>
              <th>Shape</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr
                key={r.id}
                className={selected.has(r.id) ? 'sel' : ''}
                onClick={(e) => click(e, r.id)}
                style={{ cursor: 'default' }}
              >
                <td>{r.text}</td>
                <td>{r.shape}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {children}
    </div>
  );
}

export function DialogSyncSheetPins({
  parent,
  parentFile,
  sheets,
  initialPage = 0,
  onUsePinTemplate,
  onUseLabelTemplate,
  onAddSheetPins,
  onAddHierLabels,
  onDeletePins,
  onDeleteLabels,
  onClose,
}: Props): JSX.Element {
  // wxDialog maps Esc to wxID_CANCEL for free; ours has to ask. See
  // ui/modal_escape.ts.
  useModalEscape(onClose);

  const [page, setPage] = useState(initialPage);
  const [labelSel, setLabelSel] = useState<ReadonlySet<string>>(new Set());
  const [pinSel, setPinSel] = useState<ReadonlySet<string>>(new Set());
  const [matchedSel, setMatchedSel] = useState<ReadonlySet<string>>(new Set());
  // Pairs the Undo button pulled apart. Upstream can move rows because its
  // lists are a mutable model; ours are derived from the document every render,
  // so what was broken apart has to be remembered here.
  const [broken, setBroken] = useState<ReadonlySet<string>>(new Set());

  const entry = sheets[page];
  const buckets: SyncBuckets | null = useMemo(
    () =>
      entry
        ? splitAssociated(
            syncSheetPinBuckets(parent.sheets[entry.sheetIndex]!, entry.sheetIndex, entry.sub),
            broken,
          )
        : null,
    [parent, entry, broken],
  );

  const clearSel = () => {
    setLabelSel(new Set());
    setPinSel(new Set());
    setMatchedSel(new Set());
  };

  const selectedLabels = (buckets?.labels ?? []).filter((l) => labelSel.has(l.id));
  const selectedPins = (buckets?.pins ?? []).filter((p) => pinSel.has(p.id));
  // The template buttons take one row from each list — `GetSelection()`, not
  // `GetSelections()` — so with several selected the first stands in.
  const label = selectedLabels[0] ?? null;
  const pin = selectedPins[0] ?? null;
  const canSync = !!label && !!pin;

  const templates = (items: readonly { text: string; shape: string }[]): SyncTemplate[] =>
    items.map((i) => ({ text: i.text, shape: i.shape as SyncTemplate['shape'] }));

  return (
    <div className="ze-modal-backdrop" onMouseDown={onClose}>
      <div className="ze-modal" onMouseDown={(e) => e.stopPropagation()}>
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
                      clearSel();
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
              <div style={{ display: 'flex', gap: 8, alignItems: 'stretch' }}>
                {/* Pins: the parent's half. Headed by the sheet symbol's name. */}
                <List
                  title="Sheet pins"
                  subtitle={entry.name}
                  rows={buckets.pins}
                  selected={pinSel}
                  onSelect={setPinSel}
                >
                  <button
                    type="button"
                    className="ze-btn"
                    disabled={selectedPins.length === 0}
                    onClick={() => onAddHierLabels(entry, templates(selectedPins))}
                    title={`Places a hierarchical label per selected pin in ${entry.file}`}
                  >
                    Add Hierarchical Labels
                  </button>
                  <button
                    type="button"
                    className="ze-btn"
                    disabled={selectedPins.length === 0}
                    onClick={() => {
                      onDeletePins(
                        entry,
                        selectedPins.map((p) => p.index),
                      );
                      clearSel();
                    }}
                    title={`Deletes them from the sheet symbol in ${parentFile}`}
                  >
                    Delete Sheet Pins
                  </button>
                </List>

                {/* The three bitmap buttons upstream stacks between the lists. */}
                <div
                  style={{
                    display: 'flex',
                    flexDirection: 'column',
                    justifyContent: 'center',
                    gap: 6,
                  }}
                >
                  <button
                    type="button"
                    className="ze-btn"
                    disabled={!canSync}
                    onClick={() => {
                      if (!label || !pin) return;
                      onUsePinTemplate(entry, pin, label);
                      setBroken((b) => reassociate(b, label.id));
                      clearSel();
                    }}
                    title={`Associate them using the label name — renames the pin in ${parentFile}`}
                  >
                    ← Use label
                  </button>
                  <button
                    type="button"
                    className="ze-btn"
                    disabled={!canSync}
                    onClick={() => {
                      if (!label || !pin) return;
                      onUseLabelTemplate(entry, label, pin);
                      setBroken((b) => reassociate(b, label.id));
                      clearSel();
                    }}
                    title={`Associate them using the pin name — renames the labels in ${entry.file}`}
                  >
                    Use pin →
                  </button>
                  <button
                    type="button"
                    className="ze-btn"
                    disabled={matchedSel.size === 0}
                    onClick={() => {
                      setBroken((b) => new Set([...b, ...matchedSel]));
                      clearSel();
                    }}
                    title="Break sheet pin and hierarchical label association(s)"
                  >
                    ⤺ Break
                  </button>
                </div>

                {/* Labels: the sub-sheet's half. Headed by its file name. */}
                <List
                  title="Hierarchical labels"
                  subtitle={entry.file}
                  rows={buckets.labels}
                  selected={labelSel}
                  onSelect={setLabelSel}
                >
                  <button
                    type="button"
                    className="ze-btn"
                    disabled={selectedLabels.length === 0}
                    onClick={() => onAddSheetPins(entry, templates(selectedLabels))}
                    title={`Places a pin per selected label on the sheet symbol in ${parentFile}`}
                  >
                    Add Sheet Pins
                  </button>
                  <button
                    type="button"
                    className="ze-btn"
                    disabled={selectedLabels.length === 0}
                    onClick={() => {
                      onDeleteLabels(
                        entry,
                        selectedLabels.map((l) => l.text),
                      );
                      clearSel();
                    }}
                    title={`Deletes them from ${entry.file}`}
                  >
                    Delete Hierarchical Labels
                  </button>
                </List>

                <List
                  title="Associated"
                  rows={buckets.associated.map((a) => ({
                    id: a.label.id,
                    text: a.label.text,
                    shape: a.label.shape,
                  }))}
                  selected={matchedSel}
                  onSelect={setMatchedSel}
                />
              </div>

              <div className="ze-muted">
                {canSync
                  ? `'${label.text}' (${label.shape}) vs '${pin.text}' (${pin.shape})`
                  : 'Select rows to act on. Ctrl-click adds to the selection, shift-click extends it.'}
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

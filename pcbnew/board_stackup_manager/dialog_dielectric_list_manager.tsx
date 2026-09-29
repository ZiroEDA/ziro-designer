// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * `DIALOG_DIELECTRIC_MATERIAL`. Counterparts:
 * `dialog_dielectric_list_manager_base.h`/`.cpp` (the wxFormBuilder sizer
 * tree — `DIALOG_DIELECTRIC_MATERIAL_BASE`: Material / Epsilon R / Loss Tan
 * fields over a two-column-plus-name `wxListCtrl`, OK/Cancel) and
 * `dialog_dielectric_list_manager.h`/`.cpp` (`DIALOG_DIELECTRIC_MATERIAL`,
 * the behaviour on top of it). Extracted 2026-09-29 from `panel_board_stackup.tsx`,
 * where the whole dialog had been inlined — a moves-only extraction (the
 * router file-structure parity pass): same state shape, same handlers, same
 * validation, now behind a props boundary matching upstream's constructor
 * argument (`DIELECTRIC_SUBSTRATE_LIST& aMaterialList`) and its two return
 * paths (`ShowModal() == wxID_OK` then `GetSelectedSubstrate()`, or Cancel).
 *
 * ## The reference argument, preserved
 *
 * Upstream takes the material list *by reference* and mutates it in place —
 * `onListKeyDown`'s Delete removes straight from the caller's
 * `DIELECTRIC_SUBSTRATE_LIST`, which is the panel's own long-lived list for
 * that row's type (`m_delectricMatList`/`m_solderMaskMatList`/
 * `m_silkscreenMatList`), not a copy. `materialList` here is the same object
 * reference the caller holds; `deleteMaterial` mutates it directly, the same
 * way. `AppendSubstrate` — ensuring the list already contains every material
 * the stackup uses — happens in the *caller*, before this dialog opens
 * (`onMaterialChange`, `panel_board_stackup.cpp:1417-1436`); this component
 * only reads the list to build its rows.
 *
 * ## The three return shapes, as one callback
 *
 * Upstream's `ShowModal()` returns `wxID_OK` or `wxID_CANCEL`, and on OK the
 * caller separately checks `GetSelectedSubstrate().m_Name.IsEmpty()`
 * ("No substrate specified") before applying anything. Folded into one
 * `onSubmit(substrate | null)` here: Cancel, the "✕", and OK-with-an-empty
 * name all call it with `null` (nothing to apply, close); OK with a name
 * calls it with the substrate. The caller (`panel_board_stackup.tsx`) is the
 * one place that knows what "apply" means for a given row, so it stays the
 * one place that decides; this component only ever closes.
 */
import { useState, type JSX } from 'react';
import { useModalEscape } from '@ziroeda/common/dialog_shim.js';
import type { DIELECTRIC_SUBSTRATE_LIST } from './dielectric_material.js';

/** One row of the material list, as the `wxListCtrl` shows it, and the draft fields. */
export interface Substrate {
  name: string;
  epsilonR: string;
  lossTan: string;
}

/** `initMaterialList`: the list's rows, `FormatEpsilonR` / `FormatLossTangent` as the text. */
export function substrateRows(list: DIELECTRIC_SUBSTRATE_LIST): Substrate[] {
  const out: Substrate[] = [];
  for (let i = 0; i < list.GetCount(); i++) {
    const m = list.GetSubstrateAt(i)!;
    out.push({ name: m.m_Name, epsilonR: m.FormatEpsilonR(), lossTan: m.FormatLossTangent() });
  }
  return out;
}

export interface DialogDielectricMaterialProps {
  /** `DIELECTRIC_SUBSTRATE_LIST& aMaterialList` — the same reference, mutated in place. */
  materialList: DIELECTRIC_SUBSTRATE_LIST;
  /** `ShowModal() == wxID_OK && !GetSelectedSubstrate().m_Name.IsEmpty()`, or `null` to close with nothing. */
  onSubmit: (substrate: Substrate | null) => void;
}

/** `DIALOG_DIELECTRIC_MATERIAL`. Always mounted only while shown, like a wxDialog. */
export function DialogDielectricMaterial({
  materialList,
  onSubmit,
}: DialogDielectricMaterialProps): JSX.Element {
  // TransferDataToWindow: Material empty, Epsilon R / Loss Tan default to a
  // dummy DIELECTRIC_SUBSTRATE's 1.0 / 0.0.
  const [draft, setDraft] = useState<Substrate>({ name: '', epsilonR: '1', lossTan: '0' });
  const [rows, setRows] = useState<Substrate[]>(() => substrateRows(materialList));
  const [sel, setSel] = useState(-1);

  useModalEscape(() => onSubmit(null), true);

  // `onListItemSelected`: the row's values into the three text controls.
  const selectMaterial = (idx: number): void => {
    const row = rows[idx];
    if (!row) return;
    setSel(idx);
    setDraft({ ...row });
  };

  // `onListKeyDown( WXK_DELETE )`: drop the row from the caller's list and
  // select the next (or last). `DeleteSubstrate` keeps index 0.
  const deleteMaterial = (): void => {
    if (sel < 0) return;
    materialList.DeleteSubstrate(sel);
    const nextRows = substrateRows(materialList);
    setRows(nextRows);
    const next = sel < materialList.GetCount() ? sel : sel - 1;
    setSel(next);
    const nextRow = nextRows[next];
    if (nextRow) setDraft({ ...nextRow });
  };

  // TransferDataFromWindow's two wxMessageBoxes, then GetSelectedSubstrate,
  // then the caller's "No substrate specified" early return.
  const commit = (): void => {
    const eps = draft.epsilonR.trim() === '' ? Number.NaN : Number(draft.epsilonR);
    if (!Number.isFinite(eps) || eps < 0.0) {
      window.alert('Incorrect value for Epsilon R');
      return;
    }
    const tan = draft.lossTan.trim() === '' ? Number.NaN : Number(draft.lossTan);
    if (!Number.isFinite(tan) || tan < 0.0) {
      window.alert('Incorrect value for Loss Tangent');
      return;
    }
    if (draft.name === '') {
      onSubmit(null);
      return;
    }
    onSubmit({ name: draft.name, epsilonR: String(eps), lossTan: String(tan) });
  };

  return (
    <div className="ze-modal-backdrop" onMouseDown={() => onSubmit(null)} style={{ zIndex: 60 }}>
      <div className="ze-modal" onMouseDown={(e) => e.stopPropagation()}>
        <div className="ze-modal-header">
          Dielectric Material Characteristics
          <span className="x" title="Close" onClick={() => onSubmit(null)}>
            ✕
          </span>
        </div>
        <div className="ze-modal-body ze-dielmat-body">
          <div className="ze-dielmat-grid">
            <span>Material:</span>
            <input
              className="ze-search"
              value={draft.name}
              onChange={(e) => setDraft({ ...draft, name: e.target.value })}
            />
            <span>Epsilon R:</span>
            <input
              className="ze-search"
              value={draft.epsilonR}
              onChange={(e) => setDraft({ ...draft, epsilonR: e.target.value })}
            />
            <span>Loss Tan:</span>
            <input
              className="ze-search"
              value={draft.lossTan}
              onChange={(e) => setDraft({ ...draft, lossTan: e.target.value })}
            />
          </div>
          <div
            className="ze-grid-pane ze-dielmat-list"
            tabIndex={0}
            onKeyDown={(e) => {
              if (e.key === 'Delete') {
                e.preventDefault();
                deleteMaterial();
              }
            }}
          >
            <table className="ze-grid">
              <thead>
                <tr>
                  <th>Material</th>
                  <th>Epsilon R</th>
                  <th>Loss Tan</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((m, idx) => (
                  <tr
                    key={`${idx}:${m.name}`}
                    className={idx === sel ? 'selected' : undefined}
                    onClick={() => selectMaterial(idx)}
                  >
                    <td>{m.name}</td>
                    <td>{m.epsilonR}</td>
                    <td>{m.lossTan}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
        <div className="ze-modal-footer">
          <button type="button" className="ze-btn" onClick={() => onSubmit(null)}>
            Cancel
          </button>
          <button type="button" className="ze-btn primary" onClick={commit}>
            OK
          </button>
        </div>
      </div>
    </div>
  );
}

// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * Page Preview Settings, the web counterpart of the page-settings dialog
 * `pl_editor` opens for its preview data (PL_EDITOR_CONTROL::PageSetup →
 * DIALOG_PAGES_SETTINGS): the preview paper size and orientation plus the
 * title-block fields (issue date, revision, title, company, comments) that
 * the `${…}` text variables resolve against. In the standalone sheet editor
 * these are preview data only, they are not stored in the `.kicad_wks`.
 */

import { useState, type JSX } from 'react';
import { Combo, type ComboOption } from '../../ui/Combo.js';
import { useModalEscape } from '../../ui/useModalEscape.js';

/** PAGE_SETUP's orientation choice (dialog_page_settings_base.cpp). */
const ORIENTATION_CHOICES: readonly ComboOption[] = [
  { value: 'landscape', label: 'Landscape' },
  { value: 'portrait', label: 'Portrait' },
];

/**
 * `PAGE_INFO::standardPageSizes` (common/page_info.cpp:46-68), in its own order.
 *
 * `DIALOG_PAGES_SETTINGS::TransferDataToWindow` (:112-133) appends the WHOLE
 * list to the combo, in this order, with each row's client data set to its
 * PAGE_SIZE_TYPE — so the combo IS this table and nothing sorts or filters it.
 *
 * Sizes are millimetres, landscape W×H, exactly as the C++ declares them
 * ("All MUST be defined as landscape"); the imperial ones are its mils
 * converted. Ours had A5 as 148.5 mm tall where upstream says 148.
 */
export const PAPER_MM: Record<string, [number, number]> = {
  A5: [210, 148],
  A4: [297, 210],
  A3: [420, 297],
  A2: [594, 420],
  A1: [841, 594],
  A0: [1189, 841],
  A: [279.4, 215.9],
  B: [431.8, 279.4],
  C: [558.8, 431.8],
  D: [863.6, 558.8],
  E: [1117.6, 863.6],
  /** VECTOR2D( 32000, 32000 ) mils. */
  GERBER: [812.8, 812.8],
  User: [431.8, 279.4],
  USLetter: [279.4, 215.9],
  USLegal: [355.6, 215.9],
  USLedger: [431.8, 279.4],
};

/**
 * The combo, row for row.
 *
 * Three things the audit found wrong and all three are in the C++ verbatim:
 * the descriptions have SPACES around the `x` ("A5 148 x 210mm"), the US sizes
 * are two words ("US Letter"), and `User (Custom)` is the 13th row rather than
 * the last — because the table's order is the combo's order and the US sizes
 * come after it.
 *
 * The blank row at 12 is not a mistake either: `PAGE_SIZE_TYPE::GERBER` is
 * declared with `wxPAPER_NONE` and NO `_HKI` description (page_info.cpp:62), so
 * `Append( wxGetTranslation( "" ) )` puts an empty row in the list. It selects
 * a real 32000 x 32000 mil page. Reproduced rather than tidied away: the bar is
 * that a user cannot tell which app they are in.
 */
export const PAPER_CHOICES: { id: string; label: string }[] = [
  { id: 'A5', label: 'A5 148 x 210mm' },
  { id: 'A4', label: 'A4 210 x 297mm' },
  { id: 'A3', label: 'A3 297 x 420mm' },
  { id: 'A2', label: 'A2 420 x 594mm' },
  { id: 'A1', label: 'A1 594 x 841mm' },
  { id: 'A0', label: 'A0 841 x 1189mm' },
  { id: 'A', label: 'A 8.5 x 11in' },
  { id: 'B', label: 'B 11 x 17in' },
  { id: 'C', label: 'C 17 x 22in' },
  { id: 'D', label: 'D 22 x 34in' },
  { id: 'E', label: 'E 34 x 44in' },
  { id: 'GERBER', label: '' },
  { id: 'User', label: 'User (Custom)' },
  { id: 'USLetter', label: 'US Letter 8.5 x 11in' },
  { id: 'USLegal', label: 'US Legal 8.5 x 14in' },
  { id: 'USLedger', label: 'US Ledger 11 x 17in' },
];

/** The preview page + title block data the resolver consumes. */
export interface PreviewSettings {
  paper: string;
  portrait: boolean;
  customWidthMM: number;
  customHeightMM: number;
  date: string;
  rev: string;
  title: string;
  company: string;
  comments: string[]; // 9 entries
}

export function defaultPreviewSettings(): PreviewSettings {
  return {
    paper: 'A4',
    portrait: false,
    customWidthMM: 431.8,
    customHeightMM: 279.4,
    date: '',
    rev: '',
    title: '',
    company: '',
    comments: ['', '', '', '', '', '', '', '', ''],
  };
}

/** Resolved page size in mm for the current settings (orientation applied). */
export function previewPageMM(s: PreviewSettings): [number, number] {
  const base: [number, number] =
    s.paper === 'User' ? [s.customWidthMM, s.customHeightMM] : (PAPER_MM[s.paper] ?? PAPER_MM.A4!);
  // Custom sizes are stored as entered; standard sizes swap for portrait.
  if (s.paper === 'User') return base;
  return s.portrait ? [base[1], base[0]] : base;
}

/** Human description of the page (design-inspector root row / status bar). */
export function paperDescription(s: PreviewSettings): string {
  const [w, h] = previewPageMM(s);
  return `${s.paper} ${w}x${h}mm ${s.paper === 'User' ? '' : s.portrait ? 'portrait' : 'landscape'}`.trim();
}

export function PageSettingsDialog({
  value,
  onOk,
  onCancel,
}: {
  value: PreviewSettings;
  onOk: (next: PreviewSettings) => void;
  onCancel: () => void;
}): JSX.Element {
  // wxDialog maps Esc to wxID_CANCEL for free; ours has to ask. See
  // ui/modal_escape.ts.
  useModalEscape(onCancel);

  const [s, setS] = useState<PreviewSettings>({ ...value, comments: [...value.comments] });
  const set = (patch: Partial<PreviewSettings>): void => setS((cur) => ({ ...cur, ...patch }));

  const row: React.CSSProperties = {
    display: 'flex',
    alignItems: 'center',
    gap: 8,
    margin: '4px 0',
  };
  const lab: React.CSSProperties = { width: 92, fontSize: 12, flex: '0 0 auto' };

  return (
    <div className="ze-modal-backdrop" onMouseDown={onCancel}>
      <div
        className="ze-modal"
        style={{ width: 560, maxWidth: '94vw' }}
        onMouseDown={(e) => e.stopPropagation()}
      >
        <div className="ze-modal-header">
          {/* DIALOG_PAGES_SETTINGS::DIALOG_PAGES_SETTINGS
              (common/dialogs/dialog_page_settings.cpp:82-93) re-labels three
              strings when its parent is PL_EDITOR_FRAME_NAME, because in this
              frame the page and the title block are PREVIEW data and are not
              saved anywhere. Ours used the other frames' wording. */}
          Preview Settings
          <span className="x" onClick={onCancel}>
            ✕
          </span>
        </div>
        <div style={{ display: 'flex', gap: 18, padding: '10px 14px' }}>
          <div style={{ flex: 1 }}>
            <div style={{ fontWeight: 600, fontSize: 12, marginBottom: 6 }}>Preview Paper</div>
            <div style={row}>
              <span style={lab}>Size:</span>
              <Combo
                style={{ flex: 1 }}
                value={s.paper}
                options={PAPER_CHOICES.map((p) => ({ value: p.id, label: p.label }))}
                onChange={(v) => set({ paper: v })}
                autoFocus
              />
            </div>
            <div style={row}>
              <span style={lab}>Orientation:</span>
              <Combo
                style={{ flex: 1 }}
                value={s.portrait ? 'portrait' : 'landscape'}
                options={ORIENTATION_CHOICES}
                onChange={(v) => set({ portrait: v === 'portrait' })}
              />
            </div>
            {s.paper === 'User' && (
              <>
                <div style={row}>
                  <span style={lab}>Custom width:</span>
                  <input
                    className="ze-search"
                    type="number"
                    style={{ width: 90 }}
                    value={s.customWidthMM}
                    onChange={(e) => set({ customWidthMM: Number(e.target.value) || 0 })}
                  />
                  <span className="ze-muted" style={{ fontSize: 11 }}>
                    mm
                  </span>
                </div>
                <div style={row}>
                  <span style={lab}>Custom height:</span>
                  <input
                    className="ze-search"
                    type="number"
                    style={{ width: 90 }}
                    value={s.customHeightMM}
                    onChange={(e) => set({ customHeightMM: Number(e.target.value) || 0 })}
                  />
                  <span className="ze-muted" style={{ fontSize: 11 }}>
                    mm
                  </span>
                </div>
              </>
            )}
          </div>
          <div style={{ flex: 1.2 }}>
            <div style={{ fontWeight: 600, fontSize: 12, marginBottom: 6 }}>
              Preview Title Block Data
            </div>
            <div style={row}>
              <span style={lab}>Issue Date:</span>
              <input
                className="ze-search"
                style={{ flex: 1 }}
                value={s.date}
                onChange={(e) => set({ date: e.target.value })}
              />
              <button
                className="ze-btn"
                title="Set to today"
                onClick={() => set({ date: new Date().toISOString().slice(0, 10) })}
              >
                ◀
              </button>
            </div>
            <div style={row}>
              <span style={lab}>Revision:</span>
              <input
                className="ze-search"
                style={{ flex: 1 }}
                value={s.rev}
                onChange={(e) => set({ rev: e.target.value })}
              />
            </div>
            <div style={row}>
              <span style={lab}>Title:</span>
              <input
                className="ze-search"
                style={{ flex: 1 }}
                value={s.title}
                onChange={(e) => set({ title: e.target.value })}
              />
            </div>
            <div style={row}>
              <span style={lab}>Company:</span>
              <input
                className="ze-search"
                style={{ flex: 1 }}
                value={s.company}
                onChange={(e) => set({ company: e.target.value })}
              />
            </div>
            {s.comments.map((c, i) => (
              <div style={row} key={i}>
                <span style={lab}>Comment{i + 1}:</span>
                <input
                  className="ze-search"
                  style={{ flex: 1 }}
                  value={c}
                  onChange={(e) => {
                    const comments = [...s.comments];
                    comments[i] = e.target.value;
                    set({ comments });
                  }}
                />
              </div>
            ))}
          </div>
        </div>
        <div className="ze-modal-footer">
          <button className="ze-btn" onClick={onCancel}>
            Cancel
          </button>
          <button className="ze-btn primary" onClick={() => onOk(s)}>
            OK
          </button>
        </div>
      </div>
    </div>
  );
}

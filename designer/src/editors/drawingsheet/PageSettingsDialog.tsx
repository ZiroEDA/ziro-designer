// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * `DIALOG_PAGES_SETTINGS` — `common/dialogs/dialog_page_settings.cpp` and its
 * wxFormBuilder layout `dialog_page_settings_base.cpp`.
 *
 * Upstream this is ONE dialog in `common/`, opened by eeschema, pcbnew and
 * `pl_editor` alike; the only thing that differs is three labels and which
 * controls are switched off. `pl_editor` opens it at
 * `pagelayout_editor/tools/pl_editor_control.cpp:88-108`:
 *
 *     m_frame->SaveCopyInUndoList();
 *     DIALOG_PAGES_SETTINGS dlg( m_frame, nullptr, drawSheetIUScale.IU_PER_MILS,
 *                                VECTOR2I( MAX_PAGE_SIZE_EESCHEMA_MILS,
 *                                          MAX_PAGE_SIZE_EESCHEMA_MILS ) );
 *     dlg.SetWksFileName( m_frame->GetCurrentFileName() );
 *     dlg.EnableWksFileNamePicker( false );
 *
 * so the drawing-sheet File row is SHOWN, filled with the current file name and
 * disabled — not omitted, which is what ours did.
 *
 * The shape, top to bottom, is `dialog_page_settings_base.cpp:18-140` on the
 * left and `:141-395` on the right. Both columns are a stack of centred section
 * headers, each with a `wxStaticLine` rule directly beneath it; ours drew them
 * left-aligned and bold with no rule, which is why the two did not read as the
 * same dialog.
 */

import {
  Fragment,
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type JSX,
} from 'react';
import {
  PAPER_CHOICES,
  PAPER_MM,
  layoutDrawingSheet,
  type WksResolveContext,
  type WksSheet,
} from '@ziroeda/common';
import {
  CUSTOM_PAGE_RANGE_MM,
  customSizeEnabled,
  defaultPreviewSettings,
  formatIsoDate,
  orientationEnabled,
  orientationFromCustomSize,
  paperDescription,
  previewPageMM,
  previewThumbSize,
  type PreviewSettings,
} from './preview_settings.js';
import { Combo, type ComboOption } from '../../ui/Combo.js';
import { UnitField } from '../../ui/UnitField.js';
import type { EdaUnits } from '../../ui/unit_binder.js';
import { useModalEscape } from '../../ui/useModalEscape.js';
import { MessageDialogError } from '../../ui/dialog_message.js';
import { drawDrawingSheetItems, DS_ITEM_COLOR } from './wksRender.js';

/** `m_orientationComboBoxChoices` (dialog_page_settings_base.cpp:54). */
const ORIENTATION_CHOICES: readonly ComboOption[] = [
  { value: 'landscape', label: 'Landscape' },
  { value: 'portrait', label: 'Portrait' },
];

/**
 * Re-exported so the importers that already had these keep working. The table
 * itself is `common/src/page_info.ts` — `common/page_info.cpp` upstream.
 */
export { PAPER_CHOICES, PAPER_MM };
export { defaultPreviewSettings, paperDescription, previewPageMM, type PreviewSettings };

/**
 * A centred section heading with a rule under it — the pattern repeated four
 * times in this dialog (`dialog_page_settings_base.cpp:27-30`, `:126-129`,
 * `:152-155`, `:191-194`): a `wxStaticText` added `wxALIGN_CENTER_HORIZONTAL`
 * followed by a `wxStaticLine( wxLI_HORIZONTAL )` added `wxEXPAND|wxTOP, 1`.
 */
function SectionHeader({ children }: { children: string }): JSX.Element {
  return (
    <>
      <div className="ze-pgs-head">{children}</div>
      <div className="ze-pgs-rule" />
    </>
  );
}

/** A wx spacer, in multiples of the `wxALL, 5` border every dialog is built on. */
function Spacer({ px }: { px: number }): JSX.Element {
  return <div style={{ height: px }} />;
}

export function PageSettingsDialog({
  value,
  units,
  wksFileName,
  sheet,
  onOk,
  onCancel,
}: {
  value: PreviewSettings;
  /**
   * The frame's unit. `m_customSizeX/Y` are `UNIT_BINDER`s over the parent
   * frame (dialog_page_settings.cpp:65-66), so the custom size reads in
   * whatever unit `pl_editor` is in — "mils" on a default start. Ours printed a
   * hardcoded "mm" beside a `type="number"`.
   */
  units: EdaUnits;
  /** `SetWksFileName( m_frame->GetCurrentFileName() )`. */
  wksFileName: string;
  /** Drawn into the Preview thumbnail, as `UpdateDrawingSheetExample` does. */
  sheet: WksSheet;
  onOk: (next: PreviewSettings) => void;
  onCancel: () => void;
}): JSX.Element {
  // wxDialog maps Esc to wxID_CANCEL for free; ours has to ask. See
  // ui/modal_escape.ts.
  useModalEscape(onCancel);

  const [s, setS] = useState<PreviewSettings>({ ...value, comments: [...value.comments] });
  const set = (patch: Partial<PreviewSettings>): void => setS((cur) => ({ ...cur, ...patch }));

  /**
   * `m_PickDate->SetValue( wxDateTime::Now() )` (dialog_page_settings.cpp:81).
   * The picker is a control in its own right — the `<<<` button copies ITS
   * value into the text field, so it has to hold state the field does not.
   */
  const [pick, setPick] = useState<string>(() => formatIsoDate(new Date()));

  /** `DisplayErrorMessage` from the two custom-size `Validate` calls. */
  const [error, setError] = useState<string | null>(null);

  const customOn = customSizeEnabled(s.paper);
  const orientOn = orientationEnabled(s.paper);

  /*
   * `GetPageLayoutInfoFromDialog` (:641-651): with a `User` page the
   * orientation is derived from the custom size rather than chosen.
   */
  const derived = customOn ? orientationFromCustomSize(s.customWidthMM, s.customHeightMM) : null;
  const portrait = derived ?? s.portrait;

  const [pageW, pageH] = useMemo(() => previewPageMM({ ...s, portrait }), [s, portrait]);
  const thumb = useMemo(() => previewThumbSize(pageW, pageH), [pageW, pageH]);

  /*
   * `UpdateDrawingSheetExample` (:528-628). The example is redrawn on EVERY
   * change — each `OnXxxTextUpdated` handler calls it — so the thumbnail
   * follows the title block as it is typed. It is drawn with the dialog's
   * working title block (`m_tb`) and with the sheet name, path and file name
   * passed as EMPTY strings (:620-622).
   */
  const canvasRef = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const cv = canvasRef.current;
    if (!cv) return;
    const dpr = window.devicePixelRatio || 1;
    cv.width = Math.round(thumb.width * dpr);
    cv.height = Math.round(thumb.height * dpr);
    const ctx = cv.getContext('2d');
    if (!ctx) return;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    // GRFilledRect( &memDC, (0,0), m_layout_size, 0, bgColor, bgColor ) — the
    // frame's draw background, which for a printed-style preview is the paper.
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, thumb.width, thumb.height);

    const ctxData: WksResolveContext = {
      pageNumber: 1,
      sheetCount: 1,
      title: s.title,
      rev: s.rev,
      date: s.date,
      company: s.company,
      comments: s.comments,
      paper: s.paper,
      fileName: '',
      sheetPath: '',
      appVersion: 'ZiroEDA',
      rawText: false,
    };
    const draws = layoutDrawingSheet(sheet, { widthMM: pageW, heightMM: pageH }, ctxData);
    // memDC.SetUserScale( scale, scale ) with scale = min(w/pageW, h/pageH).
    const scale = Math.min(thumb.width / pageW, thumb.height / pageH);
    ctx.save();
    ctx.scale(scale, scale);
    // renderSettings.SetDefaultPenWidth( 1 ) — one device pixel at this scale.
    drawDrawingSheetItems(ctx, draws, new Set(), {
      color: DS_ITEM_COLOR,
      minWidth: 1 / scale,
    });
    ctx.restore();
  }, [sheet, s, pageW, pageH, thumb]);

  const labelStyle: CSSProperties = { fontSize: 'var(--ui-font-size)' };

  const titleRow = (label: string, key: keyof PreviewSettings): JSX.Element => (
    <>
      <span className="ze-pgs-tblabel">{label}</span>
      <input
        className="ze-search"
        value={String(s[key] ?? '')}
        onChange={(e) => set({ [key]: e.target.value } as Partial<PreviewSettings>)}
      />
    </>
  );

  return (
    <div className="ze-modal-backdrop" onMouseDown={onCancel}>
      <div className="ze-modal ze-pgs" onMouseDown={(e) => e.stopPropagation()}>
        <div className="ze-modal-header">
          {/* DIALOG_PAGES_SETTINGS::DIALOG_PAGES_SETTINGS
              (dialog_page_settings.cpp:83-88) re-labels three strings when its
              parent is PL_EDITOR_FRAME_NAME, because in this frame the page and
              the title block are PREVIEW data and are not saved anywhere. */}
          Preview Settings
          <span className="x" onClick={onCancel}>
            ✕
          </span>
        </div>

        <div className="ze-pgs-body">
          {/* ---- bleftSizer (dialog_page_settings_base.cpp:24-140) ---- */}
          <div className="ze-pgs-left">
            <SectionHeader>Preview Paper</SectionHeader>
            <Spacer px={10} />
            {/* The label sits ABOVE its combo: both are added to a VERTICAL
                bleftSizer (:36-58), not to a row. */}
            <span style={labelStyle}>Size:</span>
            <Combo
              value={s.paper}
              options={PAPER_CHOICES.map((p) => ({ value: p.id, label: p.label }))}
              onChange={(v) => set({ paper: v })}
              autoFocus
            />
            <Spacer px={3} />
            <span style={{ ...labelStyle, opacity: orientOn ? 1 : 0.5 }}>Orientation:</span>
            <Combo
              value={portrait ? 'portrait' : 'landscape'}
              options={ORIENTATION_CHOICES}
              onChange={(v) => set({ portrait: v === 'portrait' })}
              disabled={!orientOn}
            />
            {/* Always present, ENABLED or DISABLED by OnPaperSizeChoice
                (:230-259) — never shown and hidden. Height comes before Width,
                which is the order of fgSizer1 (:69-114). */}
            <span style={{ ...labelStyle, opacity: customOn ? 1 : 0.5 }}>Custom paper size:</span>
            <Spacer px={2} />
            <div className="ze-pgs-custom">
              <span style={{ ...labelStyle, opacity: customOn ? 1 : 0.5 }}>Height:</span>
              <UnitField
                label="Height:"
                units={units}
                range={CUSTOM_PAGE_RANGE_MM}
                value={s.customHeightMM}
                onCommit={(mm) => set({ customHeightMM: mm })}
                onError={setError}
                title="Custom paper height."
                disabled={!customOn}
              />
              <span style={{ ...labelStyle, opacity: customOn ? 1 : 0.5 }}>Width:</span>
              <UnitField
                label="Width:"
                units={units}
                range={CUSTOM_PAGE_RANGE_MM}
                value={s.customWidthMM}
                onCommit={(mm) => set({ customWidthMM: mm })}
                onError={setError}
                title="Custom paper width."
                disabled={!customOn}
              />
            </div>
            {/* m_PaperExport is Show(false) for this dialog (:171). */}
            <Spacer px={20} />
            <SectionHeader>Preview</SectionHeader>
            <Spacer px={12} />
            {/* m_PageLayoutExampleBitmap: wxBORDER_SIMPLE on wxSYS_COLOUR_WINDOW
                (:136-138), added wxALL|wxEXPAND, 5. */}
            <div className="ze-pgs-preview">
              <canvas
                ref={canvasRef}
                style={{ width: thumb.width, height: thumb.height, display: 'block' }}
              />
            </div>
          </div>

          {/* bUpperSizerH->Add( 15, 0, … ) (:142) */}
          <div style={{ width: 15, flex: '0 0 auto' }} />

          {/* ---- bSizerRight (dialog_page_settings_base.cpp:144-395) ---- */}
          <div className="ze-pgs-right">
            <SectionHeader>Drawing Sheet</SectionHeader>
            <Spacer px={10} />
            <div className="ze-pgs-filerow">
              <span style={labelStyle}>File:</span>
              {/* EnableWksFileNamePicker( false ) (dialog_page_settings.h:56-60)
                  disables the entry AND the browse button; neither is hidden. */}
              <input className="ze-search" value={wksFileName} disabled readOnly />
              <button className="ze-btn" disabled title="Browse">
                {/* STD_BITMAP_BUTTON with BITMAPS::small_folder
                    (dialog_page_settings.cpp:69). */}
                <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true">
                  <path
                    d="M1.5 3.5h4l1.2 1.6h7.8v7.4H1.5z"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="1.2"
                  />
                </svg>
              </button>
            </div>
            <Spacer px={10} />
            <SectionHeader>Preview Title Block Data</SectionHeader>
            <Spacer px={10} />
            {/* m_TextSheetCount / m_TextSheetNumber are Show(false) (:169-170). */}
            <div className="ze-pgs-tb">
              <span className="ze-pgs-tblabel">Issue Date:</span>
              {/* bSizerDate (:219-233): the entry at proportion 3, the "<<<"
                  button wxBU_EXACTFIT, then the wxDatePickerCtrl at 2. */}
              <div className="ze-pgs-daterow">
                <input
                  className="ze-search"
                  style={{ flex: 3, minWidth: 100 }}
                  value={s.date}
                  onChange={(e) => set({ date: e.target.value })}
                />
                <button className="ze-btn" onClick={() => set({ date: pick })}>
                  {/* The label really is three less-than signs (:227). */}
                  &lt;&lt;&lt;
                </button>
                <input
                  className="ze-search"
                  type="date"
                  style={{ flex: 2, minWidth: 0 }}
                  value={pick}
                  onChange={(e) => setPick(e.target.value)}
                />
              </div>
              {titleRow('Revision:', 'rev')}
              {titleRow('Title:', 'title')}
              {titleRow('Company:', 'company')}
              {s.comments.map((c, i) => (
                <Fragment key={i}>
                  <span className="ze-pgs-tblabel">Comment{i + 1}:</span>
                  <input
                    className="ze-search"
                    value={c}
                    onChange={(e) => {
                      const comments = [...s.comments];
                      comments[i] = e.target.value;
                      set({ comments });
                    }}
                  />
                </Fragment>
              ))}
            </div>
          </div>
        </div>

        {error && <MessageDialogError message={error} onClose={() => setError(null)} />}

        <div className="ze-modal-footer">
          <button className="ze-btn" onClick={onCancel}>
            Cancel
          </button>
          <button className="ze-btn primary" onClick={() => onOk({ ...s, portrait })}>
            OK
          </button>
        </div>
      </div>
    </div>
  );
}

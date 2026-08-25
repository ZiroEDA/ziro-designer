// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * `DIALOG_PAGES_SETTINGS` — `common/dialogs/dialog_page_settings.cpp` over the
 * wxFormBuilder layout `common/dialogs/dialog_page_settings_base.cpp`.
 *
 * ONE component, because upstream is one class. `pl_editor`, `pcbnew` and
 * eeschema all construct `DIALOG_PAGES_SETTINGS`:
 *
 *     pagelayout_editor/tools/pl_editor_control.cpp:94-98
 *     pcbnew/tools/board_editor_control.cpp:530-532
 *     eeschema/tools/sch_editor_control.cpp:511-513   (via its one subclass)
 *
 * We had shipped two of them — this file for the schematic and the board, and
 * `editors/drawingsheet/PageSettingsDialog.tsx` for the drawing sheet — so two
 * parity audits of the second one left the first exactly where it was, which is
 * the per-editor-copy habit CLAUDE.md names. The drawing-sheet copy is gone and
 * its work is here.
 *
 * Everything that genuinely varies by caller is a prop, and every one of them
 * is a line of C++:
 *
 *   frame              `m_parent->GetName() == PL_EDITOR_FRAME_NAME` (:83)
 *                      picks the three "Preview" strings, and the three
 *                      constructor call sites pick the max page size.
 *   sheetCount/Number  `m_screen->GetPageCount()` / `GetPageNumber()` (:619);
 *                      only eeschema shows them (:170-171 vs the subclass's
 *                      :87-88).
 *   units              `m_customSizeX( aParent, … )` (:65-66) — a UNIT_BINDER
 *                      over the FRAME, so the two custom-size fields read in
 *                      the frame's own unit. That is why real eeschema shows
 *                      mils there and ours showed a hardcoded "mm".
 *   wksFileName        `SetWksFileName( … )`, and `EnableWksFileNamePicker`
 *                      (dialog_page_settings.h:56-60), which pl_editor calls
 *                      with false.
 *
 * The rules themselves are in `page_settings_model.ts`, a `.ts` so the test
 * suite can run them rather than grep the source of a `.tsx`.
 */

import { Fragment, useEffect, useMemo, useRef, useState, type JSX } from 'react';
import {
  PAPER_CHOICES,
  defaultDrawingSheet,
  drawDrawingSheetItems,
  layoutDrawingSheet,
  mmToIU,
  parseDrawingSheet,
  DS_BG_COLOR_LIGHT,
  DS_ITEM_COLOR,
  type WksResolveContext,
  type WksSheet,
} from '@ziroeda/common';
import {
  COMMENT_COUNT,
  customPageRangeMM,
  customSizeEnabled,
  formatIsoDate,
  noPageExports,
  orientationEnabled,
  orientationFromCustomSize,
  pageSettingsLabels,
  pageSizeMM,
  previewThumbSize,
  showsExportCheckboxes,
  showsSheetTallies,
  TITLE_BLOCK_ROWS,
  wksPickerEnabled,
  type PageExportFlags,
  type PageSettingsFrame,
  type PageSettingsValue,
} from './page_settings_model.js';
import { Combo, type ComboOption } from '../ui/Combo.js';
import { UnitField } from '../ui/UnitField.js';
import type { EdaUnits } from '../ui/unit_binder.js';
import { useModalEscape } from '../ui/useModalEscape.js';
import { MessageDialogError } from '../ui/dialog_message.js';
import { OpenFileDialog } from '../fs/OpenFileDialog.js';
import { drawingSheetWildcard } from '../fs/wildcards.js';

export type { PageExportFlags, PageSettingsValue } from './page_settings_model.js';

/** `m_orientationComboBoxChoices` (dialog_page_settings_base.cpp:54). */
const ORIENTATION_CHOICES: readonly ComboOption[] = [
  { value: 'landscape', label: 'Landscape' },
  { value: 'portrait', label: 'Portrait' },
];

/** No preview item is ever selected. */
const NO_PREVIEW_SELECTION: ReadonlySet<number> = new Set();

/**
 * A centred section heading with a rule under it — the pattern repeated four
 * times in this dialog (`dialog_page_settings_base.cpp:27-32`, `:123-128`,
 * `:148-153`, `:183-188`): a `wxStaticText` added `wxALIGN_CENTER_HORIZONTAL`
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

export interface PageSettingsDialogProps {
  value: PageSettingsValue;
  /** Which frame opened it — see {@link PageSettingsFrame}. */
  frame: PageSettingsFrame;
  /**
   * The frame's display unit. `m_customSizeX`/`Y` are `UNIT_BINDER`s over the
   * parent frame (dialog_page_settings.cpp:65-66).
   */
  units: EdaUnits;
  /** `m_screen->GetPageCount()` / `GetPageNumber()` (:619). */
  sheetCount?: number;
  sheetNumber?: number;
  /** `BASE_SCREEN::m_DrawingSheetFileName`, as `SetWksFileName` receives it. */
  wksFileName?: string;
  /** The drawing sheet the preview paints; `null` = the built-in stationery. */
  sheet?: WksSheet | null;
  /** The project's folder, so Browse opens where `wxFileDialog` would. */
  projectDir?: string | null;
  /**
   * The "Export to other sheets" ticks as they were last left.
   *
   * They are a PREFERENCE, not one-shot dialog state:
   * `DIALOG_EESCHEMA_PAGE_SETTINGS`'s destructor writes them into
   * `EESCHEMA_SETTINGS::m_PageSettings` and `onTransferDataToWindow` reads them
   * back (dialog_eeschema_page_settings.cpp:39-81, :108-124). Seed with
   * `pageExportsFromSettings`, which applies the empty-field guard.
   */
  exports?: PageExportFlags;
  onOk: (
    next: PageSettingsValue,
    exports: PageExportFlags,
    drawingSheet: WksSheet | null,
    drawingSheetName: string,
  ) => void;
  onCancel: () => void;
}

export function DialogPageSettings({
  value,
  frame,
  units,
  sheetCount = 1,
  sheetNumber = 1,
  wksFileName = '',
  sheet = null,
  projectDir = null,
  exports: initialExports,
  onOk,
  onCancel,
}: PageSettingsDialogProps): JSX.Element {
  // wxDialog maps Esc to wxID_CANCEL for free; ours has to ask. See
  // ui/modal_escape.ts.
  useModalEscape(onCancel);

  const labels = pageSettingsLabels(frame);
  const pickerOn = wksPickerEnabled(frame);
  const exportsOn = showsExportCheckboxes(frame);
  const talliesOn = showsSheetTallies(frame);
  const range = customPageRangeMM(frame);

  const [s, setS] = useState<PageSettingsValue>(() => ({
    ...value,
    comments: Array.from({ length: COMMENT_COUNT }, (_, i) => value.comments[i] ?? ''),
  }));
  const set = (patch: Partial<PageSettingsValue>): void => setS((cur) => ({ ...cur, ...patch }));

  const [exports, setExports] = useState<PageExportFlags>(() => initialExports ?? noPageExports());

  /**
   * `m_PickDate->SetValue( wxDateTime::Now() )` (dialog_page_settings.cpp:81).
   * The picker is a control in its own right — the `<<<` button copies ITS
   * value into the text field, so it holds state the field does not.
   */
  const [pick, setPick] = useState<string>(() => formatIsoDate(new Date()));
  const pickRef = useRef<HTMLInputElement>(null);

  /** `DisplayErrorMessage`, from `Validate` and from `LoadDrawingSheet`. */
  const [error, setError] = useState<string | null>(null);

  /*
   * `m_textCtrlFilePicker` + `m_browseButton` (dialog_page_settings_base.cpp:
   * 164-172). The entry is the model — `GetWksFileName()` reads it back
   * (dialog_page_settings.h:46-49) — and `OnWksFileSelection` (:686-777) is the
   * button: open a file dialog, load the sheet, and put the shortened name back
   * in the entry. The chosen sheet replaces `m_drawingSheet`, the alternate
   * instance the preview is painted from.
   */
  const [wksName, setWksName] = useState(wksFileName);
  const [wksSheet, setWksSheet] = useState<WksSheet | null>(sheet);
  const [browsing, setBrowsing] = useState(false);

  const customOn = customSizeEnabled(s.paper);
  const orientOn = orientationEnabled(s.paper);

  /*
   * `GetPageLayoutInfoFromDialog` (:641-651): with a `User` page the
   * orientation is derived from the custom size rather than chosen.
   */
  const derived = customOn ? orientationFromCustomSize(s.customWidthMM, s.customHeightMM) : null;
  const portrait = derived ?? s.portrait;

  const [pageW, pageH] = useMemo(() => pageSizeMM({ ...s, portrait }), [s, portrait]);
  const thumb = useMemo(() => previewThumbSize(pageW, pageH, frame), [pageW, pageH, frame]);

  /*
   * `UpdateDrawingSheetExample` (:528-632). The example is redrawn on EVERY
   * change — each `OnXxxTextUpdated` handler calls it — so the thumbnail
   * follows the title block as it is typed. It is drawn with the dialog's
   * working title block (`m_tb`) and with the sheet name, path and file name
   * passed as EMPTY strings (:618-620).
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
    // GRFilledRect( &memDC, (0,0), m_layout_size, 0, bgColor, bgColor ) with
    // bgColor = m_parent->GetDrawBgColor() (dialog_page_settings.cpp:598, 616).
    ctx.fillStyle = DS_BG_COLOR_LIGHT;
    ctx.fillRect(0, 0, thumb.width, thumb.height);

    const ctxData: WksResolveContext = {
      pageNumber: sheetNumber,
      sheetCount,
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
    const draws = layoutDrawingSheet(
      wksSheet ?? defaultDrawingSheet(),
      { widthMM: pageW, heightMM: pageH },
      ctxData,
    );
    // memDC.SetUserScale( scale, scale ) with scale = min(w/pageW, h/pageH),
    // against the page in **IU**, not millimetres: `layoutDrawingSheet`
    // resolves every item into internal units.
    const scale = Math.min(thumb.width / mmToIU(pageW), thumb.height / mmToIU(pageH));
    ctx.save();
    ctx.scale(scale, scale);
    // renderSettings.SetDefaultPenWidth( 1 ) — one device pixel at this scale.
    drawDrawingSheetItems(ctx, draws, NO_PREVIEW_SELECTION, {
      color: DS_ITEM_COLOR,
      minWidth: 1 / scale,
    });
    ctx.restore();
  }, [wksSheet, s, pageW, pageH, thumb, sheetCount, sheetNumber]);

  /*
   * `UNIT_BINDER::Enable( false )` / `m_staticTextOrient->Enable( false )` grey
   * a label the way GTK does — `label:disabled { color: #929292 }` — never with
   * an opacity fade, which would wash out a control's face and border too.
   */
  const dim = (on: boolean): string => (on ? 'ze-pgs-label' : 'ze-pgs-label disabled-label');

  /** One of the thirteen `fgSizer2` rows' third cell (:237-382). */
  const exportChk = (checked: boolean, onSet: (v: boolean) => void): JSX.Element | null =>
    exportsOn ? (
      <label className="ze-pgs-export">
        <input type="checkbox" checked={checked} onChange={(e) => onSet(e.target.checked)} />
        Export to other sheets
      </label>
    ) : null;

  const rowValue = (row: (typeof TITLE_BLOCK_ROWS)[number]): string =>
    row.comment === null
      ? String(s[row.field as 'date' | 'rev' | 'title' | 'company'])
      : (s.comments[row.comment] ?? '');

  const setRowValue = (row: (typeof TITLE_BLOCK_ROWS)[number], text: string): void => {
    if (row.comment === null) {
      set({ [row.field]: text } as Partial<PageSettingsValue>);
      return;
    }
    const comments = [...s.comments];
    comments[row.comment] = text;
    set({ comments });
  };

  const rowExport = (row: (typeof TITLE_BLOCK_ROWS)[number]): JSX.Element | null => {
    if (row.comment !== null) {
      const i = row.comment;
      return exportChk(exports.comments[i] ?? false, (v) => {
        const comments = [...exports.comments];
        comments[i] = v;
        setExports({ ...exports, comments });
      });
    }
    const key = row.field as 'date' | 'rev' | 'title' | 'company';
    return exportChk(exports[key], (v) => setExports({ ...exports, [key]: v }));
  };

  return (
    <div className="ze-modal-backdrop" onMouseDown={onCancel}>
      <div className="ze-modal ze-pgs" onMouseDown={(e) => e.stopPropagation()}>
        <div className="ze-modal-header">
          {labels.title}
          <span className="x" onClick={onCancel}>
            ✕
          </span>
        </div>

        <div className="ze-pgs-body">
          {/* ---- bleftSizer (dialog_page_settings_base.cpp:24-140) ---- */}
          <div className="ze-pgs-left">
            <SectionHeader>{labels.paper}</SectionHeader>
            <Spacer px={10} />
            {/* The label sits ABOVE its combo: both are added to a VERTICAL
                bleftSizer (:37-58), not to a row. */}
            <span className="ze-pgs-label">Size:</span>
            <Combo
              value={s.paper}
              options={PAPER_CHOICES.map((p) => ({ value: p.id, label: p.label }))}
              onChange={(v) => set({ paper: v })}
              autoFocus
            />
            <Spacer px={3} />
            <span className={dim(orientOn)}>Orientation:</span>
            <Combo
              value={portrait ? 'portrait' : 'landscape'}
              options={ORIENTATION_CHOICES}
              onChange={(v) => set({ portrait: v === 'portrait' })}
              disabled={!orientOn}
            />
            {/* Always present, ENABLED or DISABLED by OnPaperSizeChoice
                (:230-259) — never shown and hidden. Height comes before Width,
                which is the order of fgSizer1 (:67-115). */}
            <span className={dim(customOn)}>Custom paper size:</span>
            <Spacer px={2} />
            <div className="ze-pgs-custom">
              <span className={dim(customOn)}>Height:</span>
              <UnitField
                label="Height:"
                units={units}
                range={range}
                size={1}
                value={s.customHeightMM}
                onCommit={(mm) => set({ customHeightMM: mm })}
                onError={setError}
                title="Custom paper height."
                disabled={!customOn}
              />
              <span className={dim(customOn)}>Width:</span>
              <UnitField
                label="Width:"
                units={units}
                range={range}
                size={1}
                value={s.customWidthMM}
                onCommit={(mm) => set({ customWidthMM: mm })}
                onError={setError}
                title="Custom paper width."
                disabled={!customOn}
              />
            </div>
            {/* m_PaperExport (:117-118) — the fourteenth checkbox, and the only
                one NOT in fgSizer2: it is added to bleftSizer under the custom
                size. Show(false) for every frame but eeschema (:172). */}
            {exportChk(exports.paper, (v) => setExports({ ...exports, paper: v }))}
            <Spacer px={20} />
            <SectionHeader>Preview</SectionHeader>
            <Spacer px={12} />
            {/* m_PageLayoutExampleBitmap: wxBORDER_SIMPLE on wxSYS_COLOUR_WINDOW
                (:133-137), added wxALL|wxEXPAND, 5 at proportion 1. */}
            <div className="ze-pgs-preview">
              <canvas
                ref={canvasRef}
                style={{ width: thumb.width, height: thumb.height, display: 'block' }}
              />
            </div>
          </div>

          {/* bUpperSizerH->Add( 15, 0, … ) (:143) */}
          <div className="ze-pgs-gutter" />

          {/* ---- bSizerRight (dialog_page_settings_base.cpp:145-388) ---- */}
          <div className="ze-pgs-right">
            <SectionHeader>Drawing Sheet</SectionHeader>
            <Spacer px={10} />
            <div className="ze-pgs-filerow">
              <span className={dim(pickerOn)}>File:</span>
              {/* m_textCtrlFilePicker — a wxTextCtrl, not a drop-down. Ours was
                  a <select> of the project's .kicad_wks files, which is neither
                  the control nor the reach upstream has. */}
              <input
                className="ze-search"
                size={1}
                value={wksName}
                disabled={!pickerOn}
                title={wksName}
                onChange={(e) => setWksName(e.target.value)}
              />
              {/* STD_BITMAP_BUTTON, wxBU_AUTODRAW, BITMAPS::small_folder
                  (dialog_page_settings_base.cpp:171, dialog_page_settings.cpp:69).
                  A bitmap button is sized by its bitmap, not by the standard
                  button width: [px] 25 x 24 on a live pl_editor against our 85
                  x 34. The path is KiCad's own small_folder.svg. */}
              <button
                className="ze-btn ze-btn-bitmap"
                disabled={!pickerOn}
                title="Drawing Sheet File"
                onClick={() => setBrowsing(true)}
              >
                <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true">
                  <path
                    d="M 2.9511719,2 A 2,2 0 0 0 1,4 2,2 0 0 0 1,4.048828 V 12 a 2,2 0 0 0 2,2 2,2 0 0 0 0.048828,0 H 13 a 2,2 0 0 0 2,-2 2,2 0 0 0 0,-0.04883 V 6 A 2,2 0 0 0 13,4 H 12.951172 8.5 L 6.5,2 H 3 a 2,2 0 0 0 -0.048828,0 z"
                    fill="currentColor"
                  />
                </svg>
              </button>
            </div>
            <Spacer px={10} />
            <SectionHeader>{labels.titleBlock}</SectionHeader>
            <Spacer px={10} />
            {/* SheetInfoSizer (:193-208), Show(false) unless eeschema
                (:170-171 against dialog_eeschema_page_settings.cpp:87-88). */}
            {talliesOn && (
              <div className="ze-pgs-tallies">
                <span>Number of sheets: {sheetCount}</span>
                <span className="ze-pgs-tallygap" />
                <span>Sheet number: {sheetNumber}</span>
              </div>
            )}
            {/* fgSizer2 — ONE wxFlexGridSizer( 0, 3, 0, 0 ) for all thirteen
                rows (:210-382), which is what puts the thirteen checkboxes in a
                single aligned column. */}
            <div className={exportsOn ? 'ze-pgs-tb with-exports' : 'ze-pgs-tb'}>
              {TITLE_BLOCK_ROWS.map((row) => (
                <Fragment key={row.field}>
                  <span className="ze-pgs-tblabel">{row.label}</span>
                  {row.field === 'date' ? (
                    /* bSizerDate (:220-235): the entry at proportion 3, the
                       "<<<" button wxBU_EXACTFIT, then the wxDatePickerCtrl at
                       2. All three are ONE cell of fgSizer2, so the export
                       checkbox stays in the third column with the others. */
                    <div className="ze-pgs-daterow">
                      <input
                        className="ze-search"
                        style={{ flex: 3 }}
                        size={1}
                        value={s.date}
                        onChange={(e) => set({ date: e.target.value })}
                      />
                      <button
                        className="ze-btn ze-btn-exactfit"
                        onClick={() => set({ date: pick })}
                      >
                        {/* The label really is three less-than signs (:228),
                            and the button carries wxBU_EXACTFIT — it is as wide
                            as that label and no wider. */}
                        &lt;&lt;&lt;
                      </button>
                      {/* m_PickDate, a wxDatePickerCtrl at proportion 2
                          (:231-232). On GTK that is an entry with its own
                          drop-down button beside it, so the native in-field
                          calendar glyph is hidden and this button takes its
                          place. */}
                      <div className="ze-pgs-datepick">
                        <input
                          ref={pickRef}
                          className="ze-search"
                          type="date"
                          value={pick}
                          onChange={(e) => setPick(e.target.value)}
                        />
                        <button
                          className="ze-btn"
                          aria-label="Pick a date"
                          onClick={() => pickRef.current?.showPicker?.()}
                        >
                          <svg width="10" height="10" viewBox="0 0 10 10" aria-hidden="true">
                            <path
                              d="M1 3.5 L5 7 L9 3.5"
                              fill="none"
                              stroke="currentColor"
                              strokeWidth="1.5"
                            />
                          </svg>
                        </button>
                      </div>
                    </div>
                  ) : (
                    <input
                      className={row.minWidth === 100 ? 'ze-search short' : 'ze-search'}
                      size={1}
                      value={rowValue(row)}
                      onChange={(e) => setRowValue(row, e.target.value)}
                    />
                  )}
                  {rowExport(row)}
                </Fragment>
              ))}
            </div>
          </div>
        </div>

        {error && <MessageDialogError message={error} onClose={() => setError(null)} />}

        {/* OnWksFileSelection (:686-777): a wxFileDialog titled "Drawing Sheet
            File" on FILEEXT::DrawingSheetFileWildcard, then LoadDrawingSheet on
            what came back and DisplayErrorMessage if it will not parse. */}
        {browsing && (
          <OpenFileDialog
            title="Drawing Sheet File"
            filters={[drawingSheetWildcard()]}
            kind="templates"
            projectDir={projectDir}
            onDone={(file) => {
              setBrowsing(false);
              if (!file) return;
              try {
                setWksSheet(parseDrawingSheet(file.text));
              } catch (e) {
                setError(
                  `Error loading drawing sheet '${file.path}'.\n${e instanceof Error ? e.message : String(e)}`,
                );
                return;
              }
              // "Try to use a project-relative path" (:745-750); failing that
              // upstream shortens with env vars, which a browser has none of.
              const prefix = projectDir ? `${projectDir.replace(/\/$/, '')}/` : '';
              setWksName(
                prefix && file.path.startsWith(prefix) ? file.path.slice(prefix.length) : file.path,
              );
            }}
          />
        )}

        <div className="ze-modal-footer">
          <button className="ze-btn" onClick={onCancel}>
            Cancel
          </button>
          <button
            className="ze-btn primary"
            onClick={() => onOk({ ...s, portrait }, exports, wksSheet, wksName)}
          >
            OK
          </button>
        </div>
      </div>
    </div>
  );
}

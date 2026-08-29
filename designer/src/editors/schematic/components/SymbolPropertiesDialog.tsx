// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
import { iuToMM, schIUScale } from '@ziroeda/common';
import { mmToIU, symbolTransform, composeMirror, orientationFromTransform } from '@ziroeda/common';
import type { FieldTemplate } from '../schematic_settings.js';
import {
  canDeleteRow,
  canMoveRowDown,
  canMoveRowUp,
  defaultShownColumns,
  duplicateNameError,
  fieldsFromRows,
  FIELDS_GRID_COLUMNS,
  gridRowIndices,
  isNameReadOnly,
  isValueReadOnly,
  type FieldsGridCellKind,
  mandatoryRowCount,
  rowsFromSymbol,
  validateRows,
  type FieldRow,
} from '../symbol_props_rows.js';
import { useMemo, useState, type JSX } from 'react';
import {
  effectiveHorizJustify,
  effectiveVertJustify,
  storedForEffectiveHoriz,
  storedForEffectiveVert,
  justifyTokens,
  storedHJustify,
  storedVJustify,
  fieldShownText,
  DEFAULT_TEXT_SIZE,
  type SubpartSettings,
  type SchSymbol,
  type SchField,
  type LibSymbol,
  type SymbolEdit,
  type EditedField,
  type TextEffects,
  pinGridRows,
  setPinAlternate,
  PIN_GRID_COLUMNS,
  symbolUnitCount,
  unitDisplayName,
  hasAlternateBodyStyle,
  embeddedFilesIn,
} from '@ziroeda/eeschema';
import { PIN_SHAPE_NAMES, PIN_TYPE_NAMES } from '../../symbol/render/symbolRenderer.js';
import { DEFAULT_FONT_NAME, measureText } from '@ziroeda/common/src/font/stroke_font.js';
import { parseUnitValueDouble, stringFromValue, type EdaUnits } from '../../../ui/unit_binder.js';
import { useModalEscape } from '../../../ui/useModalEscape.js';
import { ColorSwatch } from '../../../ui/ColorSwatch.js';
import { Icon } from '../../../ui/icons.js';
// The wxChoice port. A native <select> draws its option list with the OS,
// so its highlight is Chrome's blue rgb(153,200,255) where GTK paints
// rgb(62,62,62) — see the header of ui/Combo.tsx for the measurements.
import { Combo } from '../../../ui/Combo.js';
import { StdBitmapButton } from '../../../ui/StdBitmapButton.js';
import { color4dToItemColor, itemColorToColor4d } from '../dialogs/item_color.js';

/**
 * Symbol Properties. Counterpart: `DIALOG_SYMBOL_PROPERTIES`
 * (eeschema/dialogs/dialog_symbol_properties.cpp) over
 * `dialog_symbol_properties_base.cpp`'s layout, control for control:
 *
 *   [ General | Pin Functions | Embedded Files ]
 *   ┌ Fields ─────────────────────────────────────────────────────────┐
 *   │ Name | Value | Show | Show Name | H Align | V Align | Italic |B │
 *   │ [+] [↑] [↓]   [🗑]                                              │
 *   └─────────────────────────────────────────────────────────────────┘
 *   ┌ General ───────────┐ ┌ Attributes ────────┐ [Update Symbol...  ]
 *   │ Unit:      [     ] │ │ [ ] Exclude from…  │ [Change Symbol...  ]
 *   │ Body style:[     ] │ │ [ ] …              │ [Edit Symbol...    ]
 *   │ Angle:     [     ] │ │                    │
 *   │ Mirror:    [     ] │ │                    │ [Edit Library Sym… ]
 *   │ [x] Show pin numbers [x] Show pin names   │
 *   └────────────────────┘ └────────────────────┘
 *   Library link: [Device:R          ]  [Simulation Model...] [Cancel] [OK]
 *
 * The grid is a `WX_GRID` over `FIELDS_GRID_TABLE`, and that is where most of
 * this dialog's behaviour actually lives:
 *
 *  - fifteen columns (`FDC_SCH_EDIT_COUNT`), of which
 *    `ShowHideColumns( "0 1 2 3 4 5 6 7" )` shows eight; the rest are turned on
 *    from the column-label context menu (`GRID_TRICKS::onGridLabelRightClick`)
 *    and the set is not persisted between opens;
 *  - Show / Show Name / Italic / Bold / Allow Autoplacement carry a
 *    `wxGridCellBoolRenderer`, so they are a checkbox at all times; H Align,
 *    V Align and Orientation carry only a `wxGridCellChoiceEditor`, so they
 *    draw as plain centred TEXT and become a control when the cell is opened;
 *  - a mandatory field's Name cell is read-only, and a power symbol's
 *    Footprint value cell is too (`FIELDS_GRID_TABLE::GetAttr`);
 *  - a `private` field is not a row here at all (`getVisibleRowCount`), though
 *    it stays in the table so OK cannot drop it;
 *  - positions are shown symbol-relative (`TransferDataToWindow` offsets each
 *    copy by -symbol position), and Text Size / X / Y carry their unit word
 *    because `StringFromValue`'s `aAddUnitLabel` is true there;
 *  - the H/V-align cells show the *effective* justification and setting them
 *    stores the possibly-flipped one (Get/SetEffectiveHorizJustify). A field
 *    with no `(justify …)` token reads "Center" in BOTH programs — a KiCad
 *    that reads "Left" is showing a field whose token says left, which
 *    autoplacement writes and a bare library placement does not. It is data,
 *    not a dialog difference, and must not be "corrected" here.
 *
 * Not reachable from the browser build, and reported rather than faked:
 *
 *  - the Simulation Model dialog (`OnEditSpiceModel`, :587 → DIALOG_SIM_MODEL).
 *    Upstream never disables that button — it only *hides* it for a power
 *    symbol (:375) — so ours is the one control that is greyed where KiCad's
 *    is live. It carries the reason as its tooltip;
 *  - the FDC_FONT list. `Fontconfig()->ListFonts` has no browser counterpart
 *    without the Local Font Access prompt, so the cell shows the face name and
 *    offers no list. The name it shows is upstream's, "Default Font";
 *  - wxMINIMIZE_BOX / wxMAXIMIZE_BOX from the base file's style flags
 *    (dialog_symbol_properties_base.h:110). Those are decorations the desktop's
 *    window manager draws on a real top-level wxDialog; a DOM modal is not a
 *    window and has none to draw. wxRESIZE_BORDER, the third flag, IS
 *    expressible and is honoured — see `.ze-modal.ze-symprops`;
 *  - adding to / removing from a library symbol's embedded files, which has no
 *    write path in our model yet.
 */

type Row = FieldRow;

interface Props {
  symbol: SchSymbol;
  lib?: LibSymbol;
  /** Schematic Setup > Field Name Templates: names not yet on the symbol are
   *  offered as empty rows (dialog_symbol_properties.cpp appends them with the
   *  template's Visible flag; named-but-empty rows survive OK, like upstream). */
  fieldTemplates?: readonly FieldTemplate[];
  /** Unit-notation inputs for the shown Reference (SubReference). */
  subpart?: SubpartSettings;
  /**
   * `m_frame->GetUserUnits()`, which is what `FIELDS_GRID_TABLE` formats and
   * parses Text Size / X Position / Y Position with
   * (fields_grid_table.cpp:823-833). Defaults to millimetres so a caller with
   * no frame behind it still gets upstream's default unit rather than a bare
   * number in unstated units.
   */
  units?: EdaUnits;
  /** Whether the library symbol draws a second body style (De Morgan).
   *  `LIB_SYMBOL::IsMultiBodyStyle`; defaults to asking `lib` itself. */
  hasAlternate?: boolean;
  onOk: (edit: SymbolEdit) => void;
  onCancel: () => void;
  /**
   * The buttons down the right of upstream's General page
   * (dialog_symbol_properties_base.cpp:233-252). Each closes this dialog and
   * hands off to the flow that already exists for it, which is what upstream's
   * do — `EndQuasiModal( SYMBOL_PROPS_WANT_UPDATE_SYMBOL )` and friends.
   *
   * Optional so a caller with no such flow gets a disabled button rather than
   * a dead one; upstream never *hides* these, it disables two of them from
   * `onUpdateEditSymbol` / `onUpdateEditLibrarySymbol`.
   */
  onChangeSymbol?: () => void;
  onUpdateSymbol?: () => void;
  onEditSymbol?: () => void;
  /** "Edit Library Symbol...": open the library part, not this placement's copy. */
  onEditLibrarySymbol?: () => void;
}

/**
 * What the Text Size / X Position / Y Position cells hold:
 * `m_frame->StringFromValue( value, true )` (fields_grid_table.cpp:823-833).
 *
 * `aAddUnitLabel` is TRUE there, so the cell reads "1.27 mm" and not "1.27" —
 * these are `wxGridCellTextEditor` cells with no unit word beside them, and the
 * suffix is the only thing that says what the number is in. The formatting is
 * the shared `UNIT_BINDER` half of `eda_units.cpp`, at the SCHEMATIC IU scale.
 */
const valueStr = (iu: number, units: EdaUnits): string =>
  stringFromValue(iuToMM(iu), units, true, schIUScale);

/** A row as an absolute-position SchField, for the justify/box computations. */
function absField(row: Row, sym: SchSymbol): SchField {
  return {
    key: row.key,
    value: row.value,
    at: { x: row.at.x + sym.at.x, y: row.at.y + sym.at.y },
    angle: row.angle,
    effects: row.effects,
    nameShown: row.nameShown || undefined,
    source: row.source ?? ({ kind: 'list', items: [] } as SchField['source']),
  };
}

/**
 * A `wxGridCellChoiceEditor`'s items, straight off the column table so the
 * order in one place is the order in the other. The stored cell values are
 * lower case (`'left'`, `'top'`, `'horizontal'`); the labels are KiCad's.
 */
const choiceOptions = (col: number): JSX.Element[] =>
  (FIELDS_GRID_COLUMNS[col]?.choices ?? []).map((label) => (
    <option key={label} value={label.toLowerCase()}>
      {label}
    </option>
  ));

/** The grid cursor: `SetGridCursor( row, col )`, and whether its editor is up. */
interface Cursor {
  /** Index into the *visible* rows, which is what `getField( aRow )` maps. */
  row: number;
  /** A `FIELDS_DATA_COL_ORDER` index. */
  col: number;
  /** `IsCellEditControlShown()`. */
  editing: boolean;
  /**
   * Whether the row is SELECTED as well as under the cursor. The grid is
   * `wxGridSelectRows`, so a click selects the whole row — but
   * `SetGridCursor`, which is how the dialog opens (`HandleDelayedFocus`,
   * dialog_symbol_properties.cpp:1102-1125) and how add/move leave it, does
   * not select anything. That is why a freshly-opened dialog shows an editor
   * on the Reference row without the row being filled.
   */
  selected: boolean;
}

export function SymbolPropertiesDialog({
  symbol,
  lib,
  fieldTemplates,
  subpart,
  hasAlternate,
  units = 'mm',
  onOk,
  onCancel,
  onChangeSymbol,
  onUpdateSymbol,
  onEditSymbol,
  onEditLibrarySymbol,
}: Props): JSX.Element {
  // wxDialog maps Esc to wxID_CANCEL for free; ours has to ask. See
  // ui/modal_escape.ts.
  useModalEscape(onCancel);

  // `SCH_SYMBOL::GetUnitCount` and `LIB_SYMBOL::IsMultiBodyStyle`, both off the
  // library part. Shared helpers rather than a local count: the unit menu, the
  // annotator and this dialog must agree on what "multi-unit" means.
  const unitCount = symbolUnitCount(lib);
  const multiUnit = unitCount > 1;
  const multiBodyStyle = hasAlternate ?? hasAlternateBodyStyle(lib);
  const isPower = !!lib?.isPower;

  const [rows, setRows] = useState<Row[]>(() => rowsFromSymbol(symbol, fieldTemplates, lib));
  // `QueueEvent( SYMBOL_DELAY_FOCUS )` with `{ 0, FDC_VALUE }`, then
  // `EnableCellEditControl( true )` — the dialog opens with the Reference's
  // value cell open for editing and nothing selected.
  const [cursor, setCursor] = useState<Cursor>({ row: 0, col: 1, editing: true, selected: false });
  const [shownCols, setShownCols] = useState<Set<number>>(defaultShownColumns);
  const [colMenu, setColMenu] = useState<{ x: number; y: number } | null>(null);

  // Orientation & mirror decompose exactly as TransferDataToWindow: choices are
  // 0 / +90 / -90 / 180 (SYM_ORIENT_0/90/270/180) and none / around-X / around-Y.
  const [orient, setOrient] = useState<number>(
    symbol.angle === 90 ? 90 : symbol.angle === 270 ? 270 : symbol.angle === 180 ? 180 : 0,
  );
  const [mirror, setMirror] = useState<'' | 'x' | 'y'>(symbol.mirror ?? '');
  const [unit, setUnit] = useState(symbol.unit);
  const [bodyStyle, setBodyStyle] = useState(symbol.bodyStyle);

  const [excludeSim, setExcludeSim] = useState(!!symbol.excludedFromSim);
  const [excludeBom, setExcludeBom] = useState(!symbol.inBom);
  const [excludeBoard, setExcludeBoard] = useState(!symbol.onBoard);
  const [dnp, setDnp] = useState(symbol.dnp);
  const [excludePosFiles, setExcludePosFiles] = useState(!!symbol.excludedFromPosFiles);
  // dialog_symbol_properties.cpp reads these off the library symbol
  //   m_ShowPinNumButt->SetValue( m_part->GetShowPinNumbers() );
  //   m_ShowPinNameButt->SetValue( m_part->GetShowPinNames() );
  // and writes them back to the placement's cached copy on OK, so a symbol can
  // hide its pin text without the library changing for every other use of it.
  const [showPinNumbers, setShowPinNumbers] = useState(!lib?.pinNumbersHidden);
  const [showPinNames, setShowPinNames] = useState(!lib?.pinNamesHidden);
  const [error, setError] = useState<string | null>(null);
  const [tab, setTab] = useState<'general' | 'pins' | 'files'>('general');
  // Pin selections accumulate on a working copy, so Cancel discards them with
  // everything else rather than having already been applied.
  const [pinSym, setPinSym] = useState<SchSymbol>(symbol);
  /**
   * `OnUnitChoice` (dialog_symbol_properties.cpp:1172-1203) sets the symbol to
   * the newly chosen unit, rebuilds the pin model from `GetRawPins()` and puts
   * the unit back — so the Pin Functions page lists the pins of the unit the
   * COMBO is on, not the one the placement was opened as. Picking unit B and
   * looking at the page must show B's pins.
   *
   * Upstream `clear()`s the model, which also discards alternates entered for
   * the previous unit; ours are keyed by pin number on the working copy, so
   * they survive. That is the one place this deliberately keeps more than
   * upstream — throwing an edit away on a combo change is a data loss, not a
   * behaviour worth reproducing.
   */
  const pinUnitSym = useMemo(() => ({ ...pinSym, unit, bodyStyle }), [pinSym, unit, bodyStyle]);

  // "Multiple body styles are a superclass of alternate pin assignments, so
  // don't allow free-form alternate assignments as well." The page is disabled
  // rather than dropped, and carries upstream's tooltip.
  const pinsDisabled = multiBodyStyle;
  // `if( m_symbol->GetEmbeddedFiles() )` — SCH_SYMBOL::GetEmbeddedFiles returns
  // the LIBRARY symbol's collection, and is null when the placement has no
  // cached library symbol, so the page exists exactly when that does.
  const embedded = useMemo(() => (lib ? embeddedFilesIn(lib.source) : null), [lib]);

  /** The rows the grid shows: `private` fields are not rows here. */
  const view = useMemo(() => gridRowIndices(rows), [rows]);
  const rowAt = (viewRow: number): Row | undefined => rows[view[viewRow] ?? -1];

  /**
   * `GRID_TRICKS::showEditor`'s `isReadOnly( aRow, aCol )` guard: a single click
   * opens the editor only where the cell is editable. Everywhere else it
   * returns false, the event is skipped, and the click just selects the row.
   *
   * The two read-only cases are `FIELDS_GRID_TABLE::GetAttr`'s: a mandatory
   * field's NAME (fields_grid_table.cpp:592-597), and a POWER symbol's Footprint
   * value — "Power symbols do not appear in the board, so don't allow a
   * footprint" (:617-631). A bool cell has no editor at all; it toggles, which
   * is `toggleCell` above `showEditor` in the same handler.
   */
  /** Is the editor already open on this exact cell? Then the mouse is the
   *  editor's, not the grid's. */
  const inOpenEditor = (viewRow: number, colIndex: number): boolean =>
    cursor.editing && cursor.row === viewRow && cursor.col === colIndex;

  const cellIsEditable = (row: Row, col: { index: number; kind: FieldsGridCellKind }): boolean => {
    if (col.kind !== 'text' && col.kind !== 'choice') return false;
    if (col.index === 0) return !isNameReadOnly(row);
    if (col.index === 1) return !isValueReadOnly(row, isPower);
    return true;
  };

  const patchRow = (viewRow: number, patch: Partial<Row>): void => {
    const i = view[viewRow];
    if (i === undefined) return;
    setRows((rs) => rs.map((r, k) => (k === i ? { ...r, ...patch } : r)));
  };
  const patchEffects = (viewRow: number, fx: Partial<TextEffects>): void => {
    const i = view[viewRow];
    if (i === undefined) return;
    setRows((rs) => rs.map((r, k) => (k === i ? { ...r, effects: { ...r.effects, ...fx } } : r)));
  };

  // Numeric cells keep free text while the editor is open and commit on
  // blur/Enter, which is what a wxGrid text editor does.
  const [cellText, setCellText] = useState<string | null>(null);
  const numEditor = (valueIU: number, commit: (iu: number) => void): JSX.Element => (
    <input
      // biome-ignore lint/a11y/noAutofocus: SetGridCursor + EnableCellEditControl
      autoFocus
      className="ze-grid-input num"
      value={cellText ?? valueStr(valueIU, units)}
      onChange={(e) => setCellText(e.target.value)}
      onBlur={(e) => {
        // `WX_GRID`'s numeric cells go through `ValueFromString`, i.e. the same
        // `DoubleValueFromString` a UNIT_BINDER uses: the leading numeric run
        // is parsed and a trailing designator overrides the display unit, so
        // the " mm" the cell was showing does not become part of the number and
        // "50mil" typed into a mm cell means 50 mils.
        commit(mmToIU(parseUnitValueDouble(e.target.value, units)));
        setCellText(null);
        setCursor((c) => ({ ...c, editing: false }));
      }}
      onKeyDown={(e) => {
        e.stopPropagation();
        if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
      }}
    />
  );

  const shownFor = (row: Row): string =>
    fieldShownText(absField(row, symbol), symbol, unitCount, subpart);

  /**
   * `OnAddField`: a `USER` field named `GetUserFieldName( size )`, carrying the
   * Reference field's angle and starting hidden, then the cursor moves to its
   * Name cell with the editor open.
   */
  const addRow = (): void => {
    const refAngle = rows.find((r) => r.key === 'Reference')?.angle ?? 0;
    const next: Row = {
      key: `Field${rows.length}`,
      value: '',
      at: { x: 0, y: 0 },
      angle: refAngle,
      effects: { hidden: true, fontSize: [DEFAULT_TEXT_SIZE, DEFAULT_TEXT_SIZE] },
      nameShown: false,
    };
    setRows((rs) => [...rs, next]);
    setCursor({ row: view.length, col: 0, editing: true, selected: false });
  };

  /**
   * `OnDeleteField`'s filter: "The first %d fields are mandatory." The message
   * counts the mandatory BLOCK, not the row, which is why the count comes from
   * `GetMandatoryRowCount` rather than from the row being refused.
   */
  const deleteRow = (): void => {
    const i = view[cursor.row];
    if (i === undefined) return;
    if (!canDeleteRow(rows, i)) {
      setError(`The first ${mandatoryRowCount(rows)} fields are mandatory.`);
      return;
    }
    setRows((rs) => rs.filter((_, k) => k !== i));
    setCursor((c) => ({ ...c, row: Math.max(0, c.row - 1), editing: false, selected: false }));
  };

  /** `OnMoveUp` / `OnMoveDown`, each guarded by the mandatory block. */
  const moveRow = (dir: -1 | 1): void => {
    const i = view[cursor.row];
    if (i === undefined) return;
    if (!(dir === -1 ? canMoveRowUp(rows, i) : canMoveRowDown(rows, i))) return;
    setRows((rs) => {
      const n = rs.slice();
      [n[i], n[i + dir]] = [n[i + dir]!, n[i]!];
      return n;
    });
    setCursor((c) => ({ ...c, row: c.row + dir, editing: false, selected: false }));
  };

  const submit = (): void => {
    const invalid = validateRows(rows);
    if (invalid) {
      setError(invalid);
      return;
    }

    // Compose orientation then mirror exactly as the dialog's two SetOrientation
    // calls, and decompose to the canonical serialized (angle, mirror).
    let t = symbolTransform(orient, undefined);
    if (mirror) t = composeMirror(t, mirror);
    const o = orientationFromTransform(t);

    const fields: EditedField[] = fieldsFromRows(rows);

    onOk({
      fields,
      angle: o.angle,
      mirror: o.mirror,
      // `int unit_selection = m_unitChoice->IsEnabled() ? GetSelection() + 1 : 1;`
      // and the same for the body style — a symbol whose part offers neither is
      // written back as unit 1, body style 1 whatever the file said.
      unit: multiUnit ? unit : 1,
      bodyStyle: multiBodyStyle ? bodyStyle : 1,
      inBom: !excludeBom,
      onBoard: !excludeBoard,
      dnp,
      // Leave the token absent unless the file had it or the user turned it on.
      excludedFromSim: symbol.excludedFromSim !== undefined || excludeSim ? excludeSim : undefined,
      excludedFromPosFiles:
        symbol.excludedFromPosFiles !== undefined || excludePosFiles ? excludePosFiles : undefined,
      // Only when the Pin Functions page actually changed something, so a
      // symbol whose pins the file never listed does not gain a list from
      // merely opening the dialog.
      pins: pinSym === symbol ? undefined : pinSym.pins,
      // Only when changed, so opening the dialog on a symbol whose library copy
      // says nothing about pin text does not start writing the flags out.
      showPinNumbers: showPinNumbers === !lib?.pinNumbersHidden ? undefined : showPinNumbers,
      showPinNames: showPinNames === !lib?.pinNamesHidden ? undefined : showPinNames,
    });
  };

  /** One grid cell. `col` is a `FIELDS_DATA_COL_ORDER` index. */
  const cell = (viewRow: number, col: number): JSX.Element => {
    const row = rowAt(viewRow)!;
    const f = absField(row, symbol);
    const shown = shownFor(row);
    const editing = cursor.row === viewRow && cursor.col === col && cursor.editing;

    switch (col) {
      case 0: {
        // FDC_NAME. Read-only for a mandatory field.
        if (isNameReadOnly(row)) return <span className="ze-grid-text">{row.key}</span>;
        return editing ? (
          <input
            // biome-ignore lint/a11y/noAutofocus: EnableCellEditControl( true )
            autoFocus
            className="ze-grid-input ze-bare"
            // A wxGrid editor holds a string of its own and writes the table
            // only on commit, which is what lets `OnGridCellChanging` refuse
            // the write. Typing straight into the row would leave nothing to
            // refuse.
            value={cellText ?? row.key}
            onChange={(e) => setCellText(e.target.value)}
            onBlur={(e) => {
              // `OnGridCellChanging` (dialog_symbol_properties.cpp:878-896):
              // a name already in use is vetoed, the message shown, and the
              // cell re-focused with its OLD value — the edit is discarded,
              // not kept as a pending correction.
              const dup = duplicateNameError(rows, view[viewRow] ?? -1, e.target.value);
              setCellText(null);
              if (dup) {
                setError(dup);
                return;
              }
              patchRow(viewRow, { key: e.target.value });
              setCursor((c) => ({ ...c, editing: false }));
            }}
            onKeyDown={(e) => {
              e.stopPropagation();
              if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
            }}
          />
        ) : (
          <span className="ze-grid-text">{row.key}</span>
        );
      }
      case 1: {
        // FDC_VALUE. A power symbol's Footprint is read-only.
        if (isValueReadOnly(row, isPower)) return <span className="ze-grid-text">{row.value}</span>;
        return editing ? (
          <span className="ze-grid-editwrap">
            <input
              // biome-ignore lint/a11y/noAutofocus: EnableCellEditControl( true )
              autoFocus
              // `wxGridCellTextEditor::BeginEdit` ends with
              // `SetSelection( -1, -1 )` — the whole value is selected when the
              // editor opens, so typing replaces it.
              onFocus={(e) => e.currentTarget.select()}
              className="ze-grid-input ze-bare"
              value={row.value}
              onChange={(e) => patchRow(viewRow, { value: e.target.value })}
              onBlur={() => setCursor((c) => ({ ...c, editing: false }))}
              onKeyDown={(e) => {
                e.stopPropagation();
                if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
              }}
            />
            {/* The Footprint row's editor is a GRID_CELL_FPID_EDITOR
                (fields_grid_table.cpp:309), which is a GRID_CELL_TEXT_BUTTON:
                a text field with a button carrying `BITMAPS::small_library`
                (grid_text_button_helpers.cpp:62) that opens
                FRAME_FOOTPRINT_CHOOSER.

                GREYED, deliberately. The chooser frame does not exist in this
                app yet, and a button that silently does nothing is worse than
                one that says so — the same call this repo made for the Edit
                File button in Manage Footprint Association Files. It sits in
                its upstream position so the cell is the right shape now and
                wiring it is the only step left. */}
            {row.key === 'Footprint' ? (
              <button
                type="button"
                className="ze-grid-cellbtn"
                disabled
                title="Browse for footprint — needs the Footprint Chooser"
                aria-label="Browse for footprint"
                // The cell's mousedown must not treat this as a click on the
                // cell and re-enter the editor.
                onMouseDown={(e) => e.stopPropagation()}
              >
                <Icon name="smallLibrary" size={14} />
              </button>
            ) : null}
          </span>
        ) : (
          <span className="ze-grid-text">{row.value}</span>
        );
      }
      case 2:
        return (
          <input
            type="checkbox"
            aria-label="Show"
            checked={!row.effects.hidden}
            onChange={(e) => patchEffects(viewRow, { hidden: !e.target.checked })}
          />
        );
      case 3:
        return (
          <input
            type="checkbox"
            aria-label="Show Name"
            checked={row.nameShown}
            onChange={(e) => patchRow(viewRow, { nameShown: e.target.checked })}
          />
        );
      case 4: {
        const effH = effectiveHorizJustify(f, symbol, shown, measureText);
        const label = effH === 'left' ? 'Left' : effH === 'right' ? 'Right' : 'Center';
        return editing ? (
          <select
            // biome-ignore lint/a11y/noAutofocus: EnableCellEditControl( true )
            autoFocus
            className="ze-grid-input ze-bare"
            value={effH}
            onBlur={() => setCursor((c) => ({ ...c, editing: false }))}
            onChange={(e) => {
              const stored = storedForEffectiveHoriz(
                f,
                symbol,
                shown,
                measureText,
                e.target.value as 'left' | 'center' | 'right',
              );
              patchEffects(viewRow, { justify: justifyTokens(stored, storedVJustify(f)) });
              setCursor((c) => ({ ...c, editing: false }));
            }}
          >
            {choiceOptions(4)}
          </select>
        ) : (
          <span className="ze-grid-text">{label}</span>
        );
      }
      case 5: {
        const effV = effectiveVertJustify(f, symbol, shown, measureText);
        const label = effV === 'top' ? 'Top' : effV === 'bottom' ? 'Bottom' : 'Center';
        return editing ? (
          <select
            // biome-ignore lint/a11y/noAutofocus: EnableCellEditControl( true )
            autoFocus
            className="ze-grid-input ze-bare"
            value={effV}
            onBlur={() => setCursor((c) => ({ ...c, editing: false }))}
            onChange={(e) => {
              const stored = storedForEffectiveVert(
                f,
                symbol,
                shown,
                measureText,
                e.target.value as 'top' | 'center' | 'bottom',
              );
              patchEffects(viewRow, { justify: justifyTokens(storedHJustify(f), stored) });
              setCursor((c) => ({ ...c, editing: false }));
            }}
          >
            {choiceOptions(5)}
          </select>
        ) : (
          <span className="ze-grid-text">{label}</span>
        );
      }
      case 6:
        return (
          <input
            type="checkbox"
            aria-label="Italic"
            checked={!!row.effects.italic}
            onChange={(e) => patchEffects(viewRow, { italic: e.target.checked || undefined })}
          />
        );
      case 7:
        return (
          <input
            type="checkbox"
            aria-label="Bold"
            checked={!!row.effects.bold}
            onChange={(e) => patchEffects(viewRow, { bold: e.target.checked || undefined })}
          />
        );
      case 8: {
        const size = row.effects.fontSize?.[0] ?? DEFAULT_TEXT_SIZE;
        return editing ? (
          numEditor(size, (iu) => patchEffects(viewRow, { fontSize: [iu, iu] }))
        ) : (
          <span className="ze-grid-text">{valueStr(size, units)}</span>
        );
      }
      case 9: {
        const label = row.angle === 90 ? 'Vertical' : 'Horizontal';
        return editing ? (
          <select
            // biome-ignore lint/a11y/noAutofocus: EnableCellEditControl( true )
            autoFocus
            className="ze-grid-input ze-bare"
            value={label.toLowerCase()}
            onBlur={() => setCursor((c) => ({ ...c, editing: false }))}
            onChange={(e) => {
              patchRow(viewRow, { angle: e.target.value === 'vertical' ? 90 : 0 });
              setCursor((c) => ({ ...c, editing: false }));
            }}
          >
            {choiceOptions(9)}
          </select>
        ) : (
          <span className="ze-grid-text">{label}</span>
        );
      }
      case 10:
        return editing ? (
          numEditor(row.at.x, (iu) => patchRow(viewRow, { at: { ...row.at, x: iu } }))
        ) : (
          <span className="ze-grid-text">{valueStr(row.at.x, units)}</span>
        );
      case 11:
        return editing ? (
          numEditor(row.at.y, (iu) => patchRow(viewRow, { at: { ...row.at, y: iu } }))
        ) : (
          <span className="ze-grid-text">{valueStr(row.at.y, units)}</span>
        );
      case 12:
        // FDC_FONT. `field.GetFont() ? GetName() : DEFAULT_FONT_NAME`
        // (fields_grid_table.cpp:838-841), and DEFAULT_FONT_NAME is
        // `_( "Default Font" )` (:60) — NOT "KiCad Font", which is a face a
        // field can name explicitly and which the combo lists as a second,
        // separate entry (:410-411). A field with no `(face …)` reads "Default
        // Font" in KiCad even though the stroke font is what draws it.
        //
        // The combo behind the cell is `Fontconfig()->ListFonts`, which has no
        // browser counterpart, so the cell is text here rather than a list that
        // could not be honoured.
        return <span className="ze-grid-text">{row.effects.face ?? DEFAULT_FONT_NAME}</span>;
      case 13:
        // FDC_COLOR: GRID_CELL_COLOR_RENDERER, a swatch at all times. It can
        // express "unspecified" — MakeBitmap paints a checkerboard for it —
        // which is why this is a COLOR_SWATCH and not a colour input.
        return (
          <ColorSwatch
            size="small"
            label="Field color"
            color={itemColorToColor4d(row.effects.color)}
            onChange={(picked) => patchEffects(viewRow, { color: color4dToItemColor(picked) })}
          />
        );
      case 14:
        // FDC_ALLOW_AUTOPLACE — SCH_FIELD::CanAutoplace, which the file stores
        // inverted as (do_not_autoplace yes).
        return (
          <input
            type="checkbox"
            aria-label="Allow Autoplacement"
            checked={!row.doNotAutoplace}
            onChange={(e) =>
              patchRow(viewRow, { doNotAutoplace: e.target.checked ? undefined : true })
            }
          />
        );
      default:
        return <span className="ze-grid-text" />;
    }
  };

  const cols = FIELDS_GRID_COLUMNS.map((c, i) => ({ ...c, index: i })).filter((c) =>
    shownCols.has(c.index),
  );

  return (
    <div className="ze-modal-backdrop" onMouseDown={onCancel}>
      {/* NOT `.ze-props-dialog`, which states a 1060 px width. This dialog is
          `mainSizer->Fit( this )` and states none. */}
      <div className="ze-modal ze-symprops" onMouseDown={(e) => e.stopPropagation()}>
        <div className="ze-modal-header">
          Symbol Properties
          <span className="x" onClick={onCancel}>
            ✕
          </span>
        </div>

        <div className="ze-symprops-body">
          {error && (
            <div className="ze-props-error" onClick={() => setError(null)}>
              {error}, click to dismiss
            </div>
          )}

          {/* m_notebook1. Three pages, the third only when the symbol has a
              library part to carry embedded files. */}
          <div className="ze-nb-tabs" role="tablist">
            <button
              type="button"
              role="tab"
              aria-selected={tab === 'general'}
              className={tab === 'general' ? 'active' : ''}
              onClick={() => setTab('general')}
            >
              General
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={tab === 'pins'}
              className={tab === 'pins' ? 'active' : ''}
              disabled={pinsDisabled}
              title={
                pinsDisabled
                  ? 'Alternate pin assignments are not available for symbols with multiple body styles.'
                  : undefined
              }
              onClick={() => setTab('pins')}
            >
              Pin Functions
            </button>
            {embedded && (
              <button
                type="button"
                role="tab"
                aria-selected={tab === 'files'}
                className={tab === 'files' ? 'active' : ''}
                onClick={() => setTab('files')}
              >
                Embedded Files
              </button>
            )}
          </div>

          {/* A wxNotebook keeps every page and reports the MAX of them as its
              best size, so the dialog it sits in is fitted once and never
              changes size when you switch tabs. These were rendered with
              `tab === … ? … : null`, which takes the other pages out of the
              DOM entirely, so the dialog resized itself to whichever tab was
              showing. They are all present now and stacked in one grid cell —
              see `.ze-nb-body` — with the inactive ones made invisible rather
              than removed, which is what keeps them counting towards the
              size. */}
          <div className="ze-nb-body">
          <div className="ze-symprops-page" aria-hidden={tab !== 'pins'} data-nbhide={tab !== 'pins' ? '' : undefined}>
              <div className="ze-grid-pane ze-symprops-pin-pane">
                <table className="ze-grid">
                  <thead>
                    <tr>
                      {PIN_GRID_COLUMNS.map((c) => (
                        <th key={c}>{c}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {pinGridRows(pinUnitSym, lib).map((r) => (
                      <tr key={r.number}>
                        <td>
                          <span className="ze-grid-text">{r.number}</span>
                        </td>
                        <td>
                          <span className="ze-grid-text">{r.baseName}</span>
                        </td>
                        <td>
                          {/* "Don't accept random values; must use the popup to
                              change to a known alternate." A pin with no
                              alternates has an empty, uneditable cell. */}
                          {r.choices.length === 0 ? (
                            <span className="ze-grid-text" />
                          ) : (
                            <select
                              className="ze-grid-input ze-bare"
                              value={r.alternate}
                              onChange={(e) =>
                                setPinSym((sym) => ({
                                  ...sym,
                                  // The row's pin is found in the unit the
                                  // CHOICE is on, not the one the placement
                                  // was opened as; `sym.unit` itself is left
                                  // alone, since OK writes the unit from the
                                  // combo and not from this working copy.
                                  pins: setPinAlternate(
                                    { ...sym, unit, bodyStyle },
                                    lib,
                                    r.number,
                                    e.target.value,
                                  ).pins,
                                }))
                              }
                            >
                              {r.choices.map((c) => (
                                <option key={c} value={c}>
                                  {c}
                                </option>
                              ))}
                            </select>
                          )}
                        </td>
                        {/* Type and Style follow the selection: GetType/GetShape
                            consult the alternate, so picking a function changes
                            what the pin is, not just what it is called. */}
                        <td>
                          <span className="ze-grid-text">
                            {PIN_TYPE_NAMES[r.electricalType] ?? r.electricalType}
                          </span>
                        </td>
                        <td>
                          <span className="ze-grid-text">
                            {PIN_SHAPE_NAMES[r.shape] ?? r.shape}
                          </span>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>


          {embedded ? (
            // PANEL_EMBEDDED_FILES (common/dialogs/panel_embedded_files_base.cpp):
            // a two-column grid, an add/remove button pair, "Embed fonts" and
            // Export. Read-only here — see the header comment.
            // The page EXISTS whenever the symbol carries embedded files —
            // that is the upstream condition for adding it to the notebook —
            // and is merely invisible when another tab is selected.
            <div className="ze-symprops-page" aria-hidden={tab !== 'files'} data-nbhide={tab !== 'files' ? '' : undefined}>
              <div className="ze-grid-pane ze-symprops-files-pane">
                <table className="ze-grid">
                  <thead>
                    <tr>
                      <th>Filename</th>
                      <th>Embedded Reference</th>
                    </tr>
                  </thead>
                  <tbody>
                    {embedded.files.map((f) => (
                      <tr key={f.name}>
                        <td>
                          <span className="ze-grid-text">{f.name}</span>
                        </td>
                        <td>
                          <span className="ze-grid-text">{f.reference}</span>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <div className="ze-grid-btns">
                <StdBitmapButton
                  bitmap="small_folder"
                  title="Add embedded file"
                  disabled
                  onClick={() => {}}
                />
                <StdBitmapButton
                  bitmap="small_trash"
                  title="Remove embedded file"
                  disabled
                  onClick={() => {}}
                />
                <label className="ze-check ze-symprops-embedfonts">
                  <input type="checkbox" checked={embedded.embedFonts} disabled readOnly />
                  Embed fonts
                </label>
                <button type="button" className="ze-btn" disabled>
                  Export...
                </button>
              </div>
            </div>
          ) : null}

          <div className="ze-symprops-page" aria-hidden={tab !== 'general'} data-nbhide={tab !== 'general' ? '' : undefined}>
            {/* sbFields */}
            <fieldset className="ze-ds-group ze-symprops-fields">
              <legend>Fields</legend>
              <div className="ze-grid-pane ze-symprops-grid-pane">
                <table className="ze-grid ze-symprops-grid">
                  <thead>
                    <tr
                      onContextMenu={(e) => {
                        // GRID_TRICKS::onGridLabelRightClick: a checkable item
                        // per column, whatever its shown state.
                        e.preventDefault();
                        setColMenu({ x: e.clientX, y: e.clientY });
                      }}
                    >
                      {cols.map((c) => (
                        <th
                          key={c.id}
                          style={c.index === 1 ? undefined : { width: c.width }}
                          className={c.center ? 'c' : undefined}
                        >
                          {c.label}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {view.map((rowIndex, viewRow) => (
                      <tr
                        key={rowIndex}
                        // The row fill is not drawn over the row that holds
                        // the active editor. The SELECTION itself survives —
                        // `qa/probes/grid_edit_selection_probe.cpp` selects a
                        // row, enables the cell editor and asks the grid:
                        //   after SelectRow(2)               rows=1 inSel=1
                        //   after EnableCellEditControl(true) rows=1 inSel=1
                        //   after DisableCellEditControl()    rows=1 inSel=1
                        // so this is a painting rule, not a selection one, and
                        // the row is still selected for Delete Field etc.
                        className={
                          cursor.selected && cursor.row === viewRow && !cursor.editing
                            ? 'selected'
                            : ''
                        }
                      >
                        {cols.map((c) => (
                          <td
                            key={c.id}
                            className={[
                              c.center ? 'c' : '',
                              cursor.row === viewRow && cursor.col === c.index ? 'cursor' : '',
                            ]
                              .filter(Boolean)
                              .join(' ')}
                            onMouseDown={(e) => {
                              // `GRID_TRICKS::onGridCellLeftClick`
                              // (grid_tricks.cpp:218-231) — "Don't make users
                              // click twice to toggle a checkbox or edit a text
                              // cell". ONE click opens the editor, and
                              // `m_enableSingleClickEdit` is true by default
                              // (:48). This wanted two.
                              //
                              // `showEditor` (:/^bool GRID_TRICKS::showEditor)
                              // moves the cursor, and if the cell is NOT
                              // read-only it calls `ClearSelection()`, re-selects
                              // the row, and then `ShowEditorOnMouseUp()`. A
                              // read-only cell returns false and the click falls
                              // through to plain row selection — which is why
                              // clicking a mandatory field's NAME only
                              // highlights the row.
                              //
                              // The editor really does open on mouse UP, and
                              // that is load-bearing rather than pedantic: the
                              // browser moves focus while handling mousedown, so
                              // an editor mounted here is focused and then blurred
                              // straight back out by the same click. Upstream
                              // hit the same class of problem —
                              //   "There's the whole SetInSetFocus() issue/hack
                              //    in wxWidgets, and there's also wxGrid's MouseUp
                              //    handler which doesn't notice it's processing a
                              //    MouseUp until after it has disabled the editor
                              //    yet again."
                              // Suppressing the default here also stops the drag
                              // selecting cell text, which a wxGrid never does.
                              // A click INSIDE the editor that is already open
                              // on this cell is not a grid click at all: the
                              // editor control has the mouse, and wxGrid never
                              // sees it. It places the caret, and that is the
                              // whole of it — no cursor move, no re-selection,
                              // no re-opening. Handling it here made the row
                              // highlight flash back on and re-selected the
                              // whole string, so you could never put the caret
                              // in the middle of a long value.
                              if (inOpenEditor(viewRow, c.index)) return;
                              e.preventDefault();
                              setCursor({
                                row: viewRow,
                                col: c.index,
                                // wxGridSelectRows: clicking selects the row.
                                selected: true,
                                editing: false,
                              });
                            }}
                            onMouseUp={() => {
                              // `ShowEditorOnMouseUp()`. Nothing to do if the
                              // editor is already up on this cell.
                              //
                              // This guard is NOT observable and no test kills
                              // removing it: `{ ...prev, editing: true }` when
                              // `editing` is already true carries identical
                              // values, React keeps the same input element, and
                              // the caret survives — `onFocus` does not re-fire,
                              // so the select-all does not re-run either. It
                              // stays because it says what the mouseup means,
                              // and because it costs a render per click inside
                              // the editor otherwise. Recorded rather than
                              // pinned with a test that could not fail.
                              if (inOpenEditor(viewRow, c.index)) return;
                              if (!cellIsEditable(rowAt(viewRow)!, c)) return;
                              setCursor((prev) => ({ ...prev, editing: true }));
                            }}
                            onDoubleClick={() => {
                              if (!cellIsEditable(rowAt(viewRow)!, c)) return;
                              setCursor({
                                row: viewRow,
                                col: c.index,
                                editing: true,
                                selected: true,
                              });
                            }}
                          >
                            {cell(viewRow, c.index)}
                          </td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              {/* bButtonSize: add, up, down, a 20px spacer, delete. */}
              <div className="ze-grid-btns">
                <StdBitmapButton bitmap="small_plus" title="Add field" onClick={addRow} />
                <StdBitmapButton bitmap="small_up" title="Move up" onClick={() => moveRow(-1)} />
                <StdBitmapButton bitmap="small_down" title="Move down" onClick={() => moveRow(1)} />
                <span className="ze-symprops-btngap" />
                <StdBitmapButton bitmap="small_trash" title="Delete field" onClick={deleteRow} />
              </div>
            </fieldset>

            {/* bLowerSizer: General (4) | Attributes (3) | buttons (3). */}
            <div className="ze-symprops-lower">
              <fieldset className="ze-ds-group ze-symprops-general">
                <legend>General</legend>
                <div className="ze-symprops-gb">
                  {/* `m_unitLabel->Enable( false )` as well as the choice
                      (dialog_symbol_properties.cpp:504): a wxStaticText greys
                      with its control, so the word "Unit:" is grey too on a
                      single-unit part. */}
                  <label
                    className={multiUnit ? 'ze-symprops-lbl' : 'ze-symprops-lbl disabled'}
                    htmlFor="ze-symprops-unit"
                  >
                    Unit:
                  </label>
                  <Combo
                    id="ze-symprops-unit"
                    ariaLabel="Unit"
                    disabled={!multiUnit}
                    value={String(unit)}
                    onChange={(v) => setUnit(Number(v))}
                    options={
                      multiUnit
                        ? Array.from({ length: unitCount }, (_, k) => ({
                            value: String(k + 1),
                            label: unitDisplayName(lib, k + 1),
                          }))
                        : []
                    }
                  />

                  {/* `m_bodyStyle->Enable( false )` (:537), the same rule for
                      the label of a part with only one body style. */}
                  <label
                    className={multiBodyStyle ? 'ze-symprops-lbl' : 'ze-symprops-lbl disabled'}
                    htmlFor="ze-symprops-bodystyle"
                  >
                    Body style:
                  </label>
                  <Combo
                    id="ze-symprops-bodystyle"
                    ariaLabel="Body style"
                    disabled={!multiBodyStyle}
                    value={String(bodyStyle)}
                    onChange={(v) => setBodyStyle(Number(v))}
                    options={
                      multiBodyStyle
                        ? [
                            { value: '1', label: 'Standard' },
                            { value: '2', label: 'Alternate' },
                          ]
                        : []
                    }
                  />

                  {/* gbSizer1 leaves row 2 empty at SetEmptyCellSize( -1, 12 ). */}
                  <span className="ze-symprops-gbgap" />

                  <label className="ze-symprops-lbl" htmlFor="ze-symprops-angle">
                    Angle:
                  </label>
                  <Combo
                    id="ze-symprops-angle"
                    ariaLabel="Angle"
                    value={String(orient)}
                    onChange={(v) => setOrient(Number(v))}
                    options={[
                      { value: '0', label: '0' },
                      { value: '90', label: '+90' },
                      { value: '270', label: '-90' },
                      { value: '180', label: '180' },
                    ]}
                  />

                  <label className="ze-symprops-lbl" htmlFor="ze-symprops-mirror">
                    Mirror:
                  </label>
                  <Combo
                    id="ze-symprops-mirror"
                    ariaLabel="Mirror"
                    value={mirror}
                    onChange={(v) => setMirror(v as '' | 'x' | 'y')}
                    options={[
                      { value: '', label: 'Not mirrored' },
                      { value: 'x', label: 'Around X axis' },
                      { value: 'y', label: 'Around Y axis' },
                    ]}
                  />
                </div>

                {/* bSizer11, inside the General box and not Attributes. */}
                <div className="ze-symprops-pinchecks">
                  <label className="ze-check" title="Show or hide pin numbers">
                    <input
                      type="checkbox"
                      checked={showPinNumbers}
                      onChange={(e) => setShowPinNumbers(e.target.checked)}
                    />
                    Show pin numbers
                  </label>
                  <label className="ze-check" title="Show or hide pin names">
                    <input
                      type="checkbox"
                      checked={showPinNames}
                      onChange={(e) => setShowPinNames(e.target.checked)}
                    />
                    Show pin names
                  </label>
                </div>
              </fieldset>

              {/* sbAttributes, in the base file's order: simulation, a 10px
                  spacer, bill of materials, board, position files, DNP. */}
              <fieldset className="ze-ds-group ze-symprops-attrs">
                <legend>Attributes</legend>
                <label className="ze-check">
                  <input
                    type="checkbox"
                    checked={excludeSim}
                    onChange={(e) => setExcludeSim(e.target.checked)}
                  />
                  Exclude from simulation
                </label>
                <span className="ze-symprops-attrgap" />
                <label
                  className="ze-check"
                  title={
                    'This is useful for adding symbols for board footprints such as fiducials\n' +
                    'and logos that you do not want to appear in the bill of materials export'
                  }
                >
                  <input
                    type="checkbox"
                    checked={excludeBom}
                    onChange={(e) => setExcludeBom(e.target.checked)}
                  />
                  Exclude from bill of materials
                </label>
                <label
                  className="ze-check"
                  title={
                    'This is useful for adding symbols that only get exported to the bill of materials but\n' +
                    'not required to layout the board such as mechanical fasteners and enclosures'
                  }
                >
                  <input
                    type="checkbox"
                    checked={excludeBoard}
                    onChange={(e) => setExcludeBoard(e.target.checked)}
                  />
                  Exclude from board
                </label>
                <label
                  className="ze-check"
                  title={
                    'This is useful for adding symbols that should not be included in the \n' +
                    'exported position files used for pick and place machines'
                  }
                >
                  <input
                    type="checkbox"
                    checked={excludePosFiles}
                    onChange={(e) => setExcludePosFiles(e.target.checked)}
                  />
                  Exclude from position files
                </label>
                <label className="ze-check">
                  <input type="checkbox" checked={dnp} onChange={(e) => setDnp(e.target.checked)} />
                  Do not populate
                </label>
              </fieldset>

              {/* buttonsSizer: a vertical column, with a 20px gap before the
                  last one — it acts on the LIBRARY part rather than this
                  placement, which is what the gap says. */}
              <div className="ze-symprops-buttons">
                <button
                  type="button"
                  className="ze-btn"
                  disabled={!onUpdateSymbol}
                  onClick={onUpdateSymbol}
                >
                  Update Symbol from Library...
                </button>
                <button
                  type="button"
                  className="ze-btn"
                  disabled={!onChangeSymbol}
                  onClick={onChangeSymbol}
                >
                  Change Symbol...
                </button>
                {/* onUpdateEditSymbol: `event.Enable( m_symbol &&
                    m_symbol->GetLibSymbolRef() )` — a placement whose cached
                    library symbol is missing has nothing to open. */}
                <button
                  type="button"
                  className="ze-btn"
                  disabled={!lib || !onEditSymbol}
                  onClick={onEditSymbol}
                >
                  Edit Symbol...
                </button>
                <span className="ze-symprops-btnsgap" />
                <button
                  type="button"
                  className="ze-btn"
                  disabled={!lib || !onEditLibrarySymbol}
                  onClick={onEditLibrarySymbol}
                >
                  Edit Library Symbol...
                </button>
              </div>
            </div>
          </div>
          </div>
        </div>

        {/* bSizerBottom, OUTSIDE the notebook: it belongs to the dialog, not to
            the General page, so it stays put as the pages change. */}
        <div className="ze-modal-footer ze-symprops-foot">
          <span className="ze-symprops-libid-label">Library link:</span>
          {/* `wxTextCtrl( …, wxTE_READONLY|wxBORDER_NONE )`
              (dialog_symbol_properties_base.cpp:323), painted
              KIPLATFORM::UI::GetDialogBGColour() — wxSYS_COLOUR_BTNFACE, which
              is LIGHTER than the dialog around it. Nothing ever clears
              wxTE_READONLY: the LIB_ID is changed by "Change Symbol...", never
              by typing here. `aria-readonly` says so to a screen reader, since
              a borderless read-only entry looks like a label. */}
          <input
            /* `ze-bare` is the shared entry rule's own opt-out. Without it that
               rule wins on specificity — `.ze-app input:not(…)×5` is (0,6,1)
               against this class's (0,1,0) — and its `font: inherit` resets
               the size back to the dialog's 11pt, so the 9pt below never
               applied. KiCad sets `KIUI::GetSmallInfoFont` here
               (dialog_symbol_properties.cpp:381-383) and this is not a GTK
               entry anyway: it is wxTE_READONLY | wxBORDER_NONE. */
            className="ze-symprops-libid ze-bare"
            readOnly
            aria-readonly="true"
            aria-label="Library link"
            value={symbol.libId}
            title={symbol.libId}
          />
          {/* `if( m_part && m_part->IsPower() ) m_spiceFieldsButton->Hide();`
              (dialog_symbol_properties.cpp:375-376) is the ONLY thing upstream
              ever does to this button — it is hidden for a power symbol and
              live for every other one, with no wxUpdateUI handler and no
              enable condition at all.
              SEAM: it stays disabled here because `OnEditSpiceModel` (:587)
              opens DIALOG_SIM_MODEL, which is not ported — eeschema/src/sim/
              carries the model types the SPICE exporter needs, not the dialog.
              A live button that opened nothing would be the worse divergence,
              so the reason is stated in the tooltip the user actually sees. */}
          {!isPower && (
            <button
              type="button"
              className="ze-btn"
              disabled
              title="The simulator is not available in this build"
            >
              Simulation Model...
            </button>
          )}
          <button type="button" className="ze-btn" onClick={onCancel}>
            Cancel
          </button>
          <button type="button" className="ze-btn primary" onClick={submit}>
            OK
          </button>
        </div>

        {colMenu && (
          // GRID_TRICKS' column-label menu. It is the only way to reach the
          // seven columns ShowHideColumns leaves hidden.
          <>
            <div className="ze-symprops-menu-scrim" onMouseDown={() => setColMenu(null)} />
            <div
              className="ze-menu-popup ze-symprops-colmenu"
              style={{ left: colMenu.x, top: colMenu.y }}
              role="menu"
            >
              {FIELDS_GRID_COLUMNS.map((c, i) => (
                <div
                  key={c.id}
                  className="ze-mitem"
                  role="menuitemcheckbox"
                  aria-checked={shownCols.has(i)}
                  onClick={() =>
                    setShownCols((s) => {
                      const n = new Set(s);
                      if (n.has(i)) n.delete(i);
                      else n.add(i);
                      return n;
                    })
                  }
                >
                  <span className="mcheck">{shownCols.has(i) ? '✓' : ''}</span>
                  <span className="lbl">{c.label}</span>
                </div>
              ))}
            </div>
          </>
        )}
      </div>
    </div>
  );
}

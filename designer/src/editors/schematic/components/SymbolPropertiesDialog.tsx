// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
import { iuToMM } from '@ziroeda/common';
import { mmToIU, symbolTransform, composeMirror, orientationFromTransform } from '@ziroeda/common';
import type { FieldTemplate } from '../schematic_settings.js';
import {
  canDeleteRow,
  canMoveRowDown,
  canMoveRowUp,
  defaultShownColumns,
  fieldsFromRows,
  FIELDS_GRID_COLUMNS,
  gridRowIndices,
  isNameReadOnly,
  isValueReadOnly,
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
import { measureText } from '@ziroeda/common/src/font/stroke_font.js';
import { useModalEscape } from '../../../ui/useModalEscape.js';
import { ColorSwatch } from '../../../ui/ColorSwatch.js';
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
 *    copy by -symbol position) in the user units (mm);
 *  - the H/V-align cells show the *effective* justification and setting them
 *    stores the possibly-flipped one (Get/SetEffectiveHorizJustify).
 *
 * Not reachable from the browser build, and reported rather than faked:
 * the Simulation Model dialog (`OnEditSpiceModel`), the font list (everything
 * renders with KiCad's stroke font), and adding to / removing from a library
 * symbol's embedded files, which has no write path in our model yet.
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

const mmStr = (iu: number): string => {
  let s = iuToMM(iu).toFixed(4).replace(/0+$/, '').replace(/\.$/, '');
  if (s === '-0' || s === '') s = '0';
  return s;
};

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
      value={cellText ?? mmStr(valueIU)}
      onChange={(e) => setCellText(e.target.value)}
      onBlur={(e) => {
        const v = Number(e.target.value.replace(',', '.'));
        if (Number.isFinite(v)) commit(mmToIU(v));
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
            className="ze-grid-input"
            value={row.key}
            onChange={(e) => patchRow(viewRow, { key: e.target.value })}
            onBlur={() => setCursor((c) => ({ ...c, editing: false }))}
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
          <input
            // biome-ignore lint/a11y/noAutofocus: EnableCellEditControl( true )
            autoFocus
            className="ze-grid-input"
            value={row.value}
            onChange={(e) => patchRow(viewRow, { value: e.target.value })}
            onBlur={() => setCursor((c) => ({ ...c, editing: false }))}
            onKeyDown={(e) => {
              e.stopPropagation();
              if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
            }}
          />
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
            className="ze-grid-input"
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
            className="ze-grid-input"
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
          <span className="ze-grid-text">{mmStr(size)}</span>
        );
      }
      case 9: {
        const label = row.angle === 90 ? 'Vertical' : 'Horizontal';
        return editing ? (
          <select
            // biome-ignore lint/a11y/noAutofocus: EnableCellEditControl( true )
            autoFocus
            className="ze-grid-input"
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
          <span className="ze-grid-text">{mmStr(row.at.x)}</span>
        );
      case 11:
        return editing ? (
          numEditor(row.at.y, (iu) => patchRow(viewRow, { at: { ...row.at, y: iu } }))
        ) : (
          <span className="ze-grid-text">{mmStr(row.at.y)}</span>
        );
      case 12:
        // FDC_FONT. `Fontconfig()->ListFonts` has no browser counterpart — the
        // whole build draws with KiCad's stroke font — so the cell states which
        // font that is rather than offering a list that could not be honoured.
        return <span className="ze-grid-text">{row.effects.face ?? 'KiCad Font'}</span>;
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

          {tab === 'pins' ? (
            <div className="ze-symprops-page">
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
                    {pinGridRows(pinSym, lib).map((r) => (
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
                              className="ze-grid-input"
                              value={r.alternate}
                              onChange={(e) =>
                                setPinSym((sym) =>
                                  setPinAlternate(sym, lib, r.number, e.target.value),
                                )
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
          ) : null}

          {tab === 'files' && embedded ? (
            // PANEL_EMBEDDED_FILES (common/dialogs/panel_embedded_files_base.cpp):
            // a two-column grid, an add/remove button pair, "Embed fonts" and
            // Export. Read-only here — see the header comment.
            <div className="ze-symprops-page">
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

          <div className="ze-symprops-page" hidden={tab !== 'general'}>
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
                        className={cursor.selected && cursor.row === viewRow ? 'selected' : ''}
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
                            onMouseDown={() =>
                              setCursor((prev) => ({
                                row: viewRow,
                                col: c.index,
                                // A second click on the cell already under the
                                // cursor opens its editor, as wxGrid does.
                                editing:
                                  (c.kind === 'text' || c.kind === 'choice') &&
                                  prev.row === viewRow &&
                                  prev.col === c.index,
                                // wxGridSelectRows: clicking selects the row.
                                selected: true,
                              }))
                            }
                            onDoubleClick={() =>
                              setCursor({
                                row: viewRow,
                                col: c.index,
                                editing: c.kind === 'text' || c.kind === 'choice',
                                selected: true,
                              })
                            }
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
                  <label className="ze-symprops-lbl" htmlFor="ze-symprops-unit">
                    Unit:
                  </label>
                  <select
                    id="ze-symprops-unit"
                    className="ze-select"
                    disabled={!multiUnit}
                    value={unit}
                    onChange={(e) => setUnit(Number(e.target.value))}
                  >
                    {/* `for( ii = 1; ii <= GetUnitCount(); ii++ ) Append(
                        GetUnitDisplayName( ii, false ) )` — the bare letter, or
                        the library's own name for the unit. Appended only when
                        the symbol IS multi-unit; otherwise the choice is left
                        empty and disabled. */}
                    {multiUnit
                      ? Array.from({ length: unitCount }, (_, k) => (
                          <option key={k + 1} value={k + 1}>
                            {unitDisplayName(lib, k + 1)}
                          </option>
                        ))
                      : null}
                  </select>

                  <label className="ze-symprops-lbl" htmlFor="ze-symprops-bodystyle">
                    Body style:
                  </label>
                  <select
                    id="ze-symprops-bodystyle"
                    className="ze-select"
                    disabled={!multiBodyStyle}
                    value={bodyStyle}
                    onChange={(e) => setBodyStyle(Number(e.target.value))}
                  >
                    {/* Standard / Alternate is the De Morgan pair. A part with
                        named body styles lists those instead; we do not model
                        `(body_style_names …)` yet. */}
                    {multiBodyStyle ? <option value={1}>Standard</option> : null}
                    {multiBodyStyle ? <option value={2}>Alternate</option> : null}
                  </select>

                  {/* gbSizer1 leaves row 2 empty at SetEmptyCellSize( -1, 12 ). */}
                  <span className="ze-symprops-gbgap" />

                  <label className="ze-symprops-lbl" htmlFor="ze-symprops-angle">
                    Angle:
                  </label>
                  <select
                    id="ze-symprops-angle"
                    className="ze-select"
                    value={orient}
                    onChange={(e) => setOrient(Number(e.target.value))}
                  >
                    <option value={0}>0</option>
                    <option value={90}>+90</option>
                    <option value={270}>-90</option>
                    <option value={180}>180</option>
                  </select>

                  <label className="ze-symprops-lbl" htmlFor="ze-symprops-mirror">
                    Mirror:
                  </label>
                  <select
                    id="ze-symprops-mirror"
                    className="ze-select"
                    value={mirror}
                    onChange={(e) => setMirror(e.target.value as '' | 'x' | 'y')}
                  >
                    <option value="">Not mirrored</option>
                    <option value="x">Around X axis</option>
                    <option value="y">Around Y axis</option>
                  </select>
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

        {/* bSizerBottom, OUTSIDE the notebook: it belongs to the dialog, not to
            the General page, so it stays put as the pages change. */}
        <div className="ze-modal-footer ze-symprops-foot">
          <span className="ze-symprops-libid-label">Library link:</span>
          {/* wxTE_READONLY | wxBORDER_NONE, painted
              KIPLATFORM::UI::GetDialogBGColour() — wxSYS_COLOUR_BTNFACE, which
              is LIGHTER than the dialog around it. */}
          <input className="ze-symprops-libid" readOnly value={symbol.libId} title={symbol.libId} />
          {/* `if( m_part && m_part->IsPower() ) m_spiceFieldsButton->Hide();` */}
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

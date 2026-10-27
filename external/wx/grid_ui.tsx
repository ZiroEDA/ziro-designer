// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
/**
 * The page's half of `wxGrid`: it draws a grid model (`grid.ts`, a WX_GRID
 * for KiCad's grids) as the shared `.ze-grid` table, and turns the page's
 * mouse and keys into the grid's events - wx's generic grid window, not
 * KiCad code. Everything a grid DOES is the model's (and GRID_TRICKS'); this
 * file only draws it and routes input to it.
 *
 * Routing, as wxGTK does:
 *  - a click is `wxEVT_GRID_CELL_LEFT_CLICK`; if nothing handles it the grid
 *    moves the cursor (Shift extends the block, Ctrl adds the cell);
 *  - the mouse-up opens the editor a click asked for (`ShowEditorOnMouseUp`);
 *  - a double click is `..._LEFT_DCLICK`, and unhandled opens the editor;
 *  - a right click is `..._RIGHT_CLICK`, and the menu it pops up is drawn
 *    with the shared `ContextMenu`;
 *  - a key goes through `wxGrid::HandleKey`: the char hook, the editor or
 *    the key-down handlers and `OnKeyDown`, then `OnChar`;
 *  - after each, `wxEVT_UPDATE_UI`.
 */
import {
  type CSSProperties,
  type JSX,
  type ReactNode,
  useEffect,
  useLayoutEffect,
  useReducer,
  useRef,
  useState,
} from 'react';
import { ContextMenu, wxMenuContextItems } from './menu_ui.js';
import type { MenuItem } from './menu.js';
import { Combo } from './combobox.js';
import { wxKeyEventFromDom } from './dom_events.js';
import {
  wxEVT_GRID_CELL_LEFT_CLICK,
  wxEVT_GRID_CELL_LEFT_DCLICK,
  wxEVT_GRID_CELL_RIGHT_CLICK,
  wxEVT_GRID_LABEL_LEFT_CLICK,
  wxEVT_GRID_LABEL_RIGHT_CLICK,
  type wxGrid,
  wxALIGN_CENTER_HORIZONTAL,
  wxALIGN_RIGHT,
  wxGRID_VALUE_BOOL,
  wxGridCellBoolRenderer,
  wxGridCellChoiceEditor,
  type wxGridCellChoiceView,
  type wxGridCellBackgroundDrawn,
  type wxGridCellDrawn,
  type wxGridCellEditor,
  wxGridEvent,
  wxGridSelectionModes,
} from './grid.js';
import {
  wxEVT_KEY_DOWN,
  wxMOD_ALT,
  wxMOD_CONTROL,
  wxMOD_META,
  wxMOD_SHIFT,
  wxUpdateUIEvent,
} from './wx_event.js';

/** What a column needs beyond the model: its stated width (`SetColSize`), a floor. */
/**
 * An editor that draws a button at the entry's right (a `wxComboCtrl`'s button, which does not
 * take the focus): what the view needs of it. KiCad's GRID_CELL_TEXT_BUTTON is one.
 */
export interface wxGridCellButtonView {
  /** The button's bitmap, as an image URL. */
  GetButtonBitmap(): string;
  /** `OnButtonClick`: a button that opens another window answers when it closes. */
  OnButtonClick(): void | Promise<void>;
}

export interface GRID_COLUMN_VIEW {
  width?: number;
  /** `wxALIGN_CENTER` on the column's attribute. */
  center?: boolean;
}

const modifiersOf = (e: {
  shiftKey: boolean;
  ctrlKey: boolean;
  altKey: boolean;
  metaKey: boolean;
}): number =>
  (e.shiftKey ? wxMOD_SHIFT : 0) |
  (e.ctrlKey ? wxMOD_CONTROL : 0) |
  (e.altKey ? wxMOD_ALT : 0) |
  (e.metaKey ? wxMOD_META : 0);

export function WxGridView({
  grid,
  tricks,
  columns = [],
  flexCol,
  rowLabels = false,
  colLabels = true,
  renderCell,
  renderEditor,
  className,
  style,
  ariaLabel,
  onUpdate,
  rowLabelSize,
  fixedColumns,
  onSize,
}: {
  grid: wxGrid;
  /** The grid's GRID_TRICKS, for the cell tooltips. */
  tricks?: { GetCellTooltip(aRow: number, aCol: number): string };
  columns?: readonly GRID_COLUMN_VIEW[];
  /** `SetupColumnAutosizer( aFlexibleCol )`: the column that takes the slack. */
  flexCol?: number;
  rowLabels?: boolean;
  /** `SetRowLabelSize( n )`: the row-label column's width, a floor as a column's is. */
  rowLabelSize?: number;
  /**
   * The stated widths are exact, as `SetColSize` leaves them on a grid no autosizer re-measures:
   * the columns hold against the filler cell instead of growing to their content.
   */
  fixedColumns?: boolean;
  /**
   * `wxEVT_SIZE` on the grid window, with its new width. A grid that handles it is sized by
   * its parent, as every wx window is, and sizes its columns to that: its columns no longer
   * widen it (DIALOG_SYMBOL_FIELDS_TABLE::OnSizeViewControlsGrid).
   */
  onSize?: (aWidth: number) => void;
  colLabels?: boolean;
  /** A custom renderer's drawing (a swatch, an icon); null draws the default. */
  renderCell?: (aRow: number, aCol: number, aValue: string) => ReactNode | null;
  /** A custom editor's control; null draws the default for the editor's class. */
  renderEditor?: (
    aRow: number,
    aCol: number,
    aEditor: wxGridCellEditor,
    aChanged: () => void,
  ) => ReactNode | null;
  className?: string;
  style?: CSSProperties;
  ariaLabel?: string;
  /** After every redraw: where a controlled panel reads the grid back. */
  onUpdate?: () => void;
}): JSX.Element {
  const [, bump] = useReducer((n: number) => n + 1, 0);
  const tableRef = useRef<HTMLTableElement>(null);
  const lastPoint = useRef({ x: 0, y: 0 });
  const [menu, setMenu] = useState<{
    items: MenuItem[];
    x: number;
    y: number;
  } | null>(null);

  useLayoutEffect(() => {
    grid.SetRefreshListener(bump);
    grid.SetPopupMenuPresenter((aMenu, aOnSelect) =>
      setMenu({
        items: wxMenuContextItems(aMenu, (id) => {
          setMenu(null);
          aOnSelect(id);
          grid.ProcessEvent(new wxUpdateUIEvent(0));
        }),
        x: lastPoint.current.x,
        y: lastPoint.current.y,
      }),
    );
    grid.SetNavigateHandler(() => {
      // Ctrl+Tab: the next focusable control after the grid.
      const table = tableRef.current;
      const focusables = Array.from(
        document.querySelectorAll<HTMLElement>(
          'button, input, select, textarea, [tabindex]:not([tabindex="-1"])',
        ),
      ).filter((el) => !table?.contains(el) && !el.hasAttribute('disabled'));
      const next = focusables.find(
        (el) => table && table.compareDocumentPosition(el) & Node.DOCUMENT_POSITION_FOLLOWING,
      );
      next?.focus();
    });
    return () => {
      grid.SetRefreshListener(null);
      grid.SetPopupMenuPresenter(null);
      grid.SetNavigateHandler(null);
    };
  }, [grid]);

  // wxEVT_UPDATE_UI after every change the grid draws.
  useEffect(() => {
    grid.ProcessEvent(new wxUpdateUIEvent(0));
    onUpdate?.();
  });

  const editor = grid.GetCurrentEditor();
  const cursorRow = grid.GetGridCursorRow();
  const cursorCol = grid.GetGridCursorCol();

  // The editor closed: the grid window takes the focus back.
  const windowRef = useRef<HTMLDivElement>(null);
  const onSizeRef = useRef(onSize);
  onSizeRef.current = onSize;
  const sized = onSize !== undefined;
  useEffect(() => {
    // The window, not the table: a fixed-layout table is as wide as its columns, so
    // sizing the columns from the table fed itself without end.
    const window = windowRef.current;
    if (!sized || !window) return;
    let last = -1;
    const ro = new ResizeObserver(() => {
      const width = Math.round(window.clientWidth);
      if (width === last) return;
      last = width;
      onSizeRef.current?.(width);
    });
    ro.observe(window);
    return () => ro.disconnect();
  }, [sized]);

  const wasEditing = useRef(false);
  useEffect(() => {
    if (wasEditing.current && !editor) tableRef.current?.focus();
    wasEditing.current = editor !== null;
  });

  const shownCols = Array.from({ length: grid.GetNumberCols() }, (_, c) => c).filter((c) =>
    grid.IsColShown(c),
  );
  /**
   * `RecomputeGridWidths` (common/widgets/wx_grid.cpp:1116): with `SetupColumnAutosizer`
   * the flexible column is given whatever the others leave, so it - not a filler cell -
   * takes the slack. The filler is for a grid with no autosizer, whose columns stay at
   * their stated widths. Hidden by `ShowHideColumns`, the column takes nothing.
   */
  const slackCol = flexCol !== undefined && shownCols.includes(flexCol) ? flexCol : undefined;
  const mode = grid.GetSelectionMode();

  /** The grid's own response to a click nothing handled (wxGrid::DoGridCellLeftDown). */
  const defaultClick = (aRow: number, aCol: number, e: React.MouseEvent): void => {
    if (e.shiftKey && cursorRow >= 0) {
      grid.SelectBlock(cursorRow, cursorCol, aRow, aCol, e.ctrlKey);
      return;
    }

    if (e.ctrlKey) {
      if (grid.IsInSelection(aRow, aCol)) grid.DeselectCell(aRow, aCol);
      else grid.SelectBlock(aRow, aCol, aRow, aCol, true);
      grid.SetGridCursor(aRow, aCol);
      return;
    }

    grid.ClearSelection();
    grid.GoToCell(aRow, aCol);
  };

  const onCellMouseDown = (aRow: number, aCol: number, e: React.MouseEvent): void => {
    if (e.button !== 0) return;

    tableRef.current?.focus();

    if (editor && (aRow !== cursorRow || aCol !== cursorCol)) grid.DisableCellEditControl();

    if (editor && aRow === cursorRow && aCol === cursorCol) return;

    const evt = new wxGridEvent(
      e.detail >= 2 ? wxEVT_GRID_CELL_LEFT_DCLICK : wxEVT_GRID_CELL_LEFT_CLICK,
      grid,
      aRow,
      aCol,
      modifiersOf(e),
    );

    if (!grid.ProcessEvent(evt)) {
      defaultClick(aRow, aCol, e);

      if (e.detail >= 2 && grid.CanEnableCellControl()) {
        grid.ClearSelection();
        grid.EnableCellEditControl();
      }
    }
  };

  const onCellMouseUp = (): void => {
    const g = grid as wxGrid & {
      IsWaitingForSlowClick?: () => boolean;
      CancelShowEditorOnMouseUp?: () => void;
    };

    if (g.IsWaitingForSlowClick?.()) {
      g.CancelShowEditorOnMouseUp?.();
      grid.EnableCellEditControl();
    }
  };

  const onContextMenu = (aRow: number, aCol: number, aType: number, e: React.MouseEvent): void => {
    e.preventDefault();
    lastPoint.current = { x: e.clientX, y: e.clientY };
    grid.ProcessEvent(new wxGridEvent(aType, grid, aRow, aCol, modifiersOf(e)));
  };

  /** A key, as wx routes it; the page's default is stopped when the grid used it. */
  const onKey = (e: React.KeyboardEvent, aTextEntry: HTMLInputElement | null): void => {
    e.stopPropagation();

    const evt = wxKeyEventFromDom(e.currentTarget as HTMLElement, e.nativeEvent, wxEVT_KEY_DOWN, {
      x: 0,
      y: 0,
    });

    if (aTextEntry) {
      const input = aTextEntry;
      evt.SetEventObject({
        GetStringSelection: () =>
          input.value.slice(input.selectionStart ?? 0, input.selectionEnd ?? 0),
        WriteText: (aText: string) => {
          input.setRangeText(aText, input.selectionStart ?? 0, input.selectionEnd ?? 0, 'end');
          if (editor) editor.m_value = input.value;
          bump();
        },
        IsEditable: () => !input.readOnly,
      });
    }

    if (grid.HandleKey(evt)) e.preventDefault();
  };

  const editorFor = (aRow: number, aCol: number, aEditor: wxGridCellEditor): ReactNode => {
    const custom = renderEditor?.(aRow, aCol, aEditor, bump);

    if (custom) return custom;

    const choiceView = aEditor as wxGridCellEditor & Partial<wxGridCellChoiceView>;

    if (choiceView.GetComboOptions)
      return (
        <Combo
          autoFocus
          value={aEditor.m_value}
          options={choiceView.GetComboOptions().map((o) => ({
            value: o.value,
            label: o.label,
            ...(o.swatch === undefined ? {} : { swatch: o.swatch }),
            ...(o.bitmap === undefined ? {} : { bitmap: o.bitmap }),
          }))}
          onChange={(v) => {
            aEditor.m_value = v;
            grid.DisableCellEditControl();
          }}
        />
      );

    if (aEditor instanceof wxGridCellChoiceEditor)
      return (
        <Combo
          autoFocus
          value={aEditor.m_value}
          options={aEditor.m_choices.map((c) => ({ value: c, label: c }))}
          onChange={(v) => {
            aEditor.m_value = v;
            grid.DisableCellEditControl();
          }}
        />
      );

    const input = (
      <input
        className="ze-grid-input"
        type="text"
        size={1}
        autoFocus
        value={aEditor.m_value}
        onChange={(e) => {
          aEditor.m_value = aEditor.FilterText(e.target.value);
          bump();
        }}
        onKeyDown={(e) => onKey(e, e.currentTarget)}
        onBlur={() => {
          if (grid.GetCurrentEditor() === aEditor) grid.DisableCellEditControl();
        }}
      />
    );

    // GRID_CELL_TEXT_BUTTON: the entry with a button at its right, which keeps
    // the focus in the entry (a wxComboCtrl's button does not take it).
    const textButton = aEditor as wxGridCellEditor & Partial<wxGridCellButtonView>;

    if (textButton.GetButtonBitmap && textButton.OnButtonClick) {
      const bitmap = textButton.GetButtonBitmap();
      return (
        <span className="ze-grid-textbtn">
          {input}
          <button
            type="button"
            className="ze-grid-cellbtn"
            tabIndex={-1}
            onMouseDown={(e) => {
              e.preventDefault();
              e.stopPropagation();
            }}
            onClick={() => {
              // A button that opens another window answers later; draw again when it does.
              void Promise.resolve(textButton.OnButtonClick?.()).then(bump);
              bump();
            }}
          >
            {bitmap ? <img src={bitmap} alt="" draggable={false} /> : null}
          </button>
        </span>
      );
    }

    return input;
  };

  /**
   * A cell being edited. wxGrid shows the editor as a control of its own, set to the cell's
   * rectangle (`wxGridCellEditor::SetSize( rect )`), so it never sizes a column or a row: the
   * column stays what the renderer's text made it. The renderer keeps its place, unseen, and the
   * editor is laid over the cell - else a layer editor's swatch widened Layer and moved Value.
   */
  const cellContent = (aRow: number, aCol: number): ReactNode => {
    if (editor && aRow === cursorRow && aCol === cursorCol)
      return (
        <>
          <span className="ze-grid-under-editor" aria-hidden="true">
            {rendererContent(aRow, aCol)}
          </span>
          <span className="ze-grid-editor">{editorFor(aRow, aCol, editor)}</span>
        </>
      );

    return rendererContent(aRow, aCol);
  };

  const rendererContent = (aRow: number, aCol: number): ReactNode => {
    const value = grid.GetCellValue(aRow, aCol);
    const custom = renderCell?.(aRow, aCol, value);

    if (custom) return custom;

    const drawn = grid.GetCellRenderer(aRow, aCol) as Partial<wxGridCellDrawn>;

    if (drawn.DrawValue) {
      const { label, swatch, icon, indent } = drawn.DrawValue(value, grid, aRow, aCol);
      return (
        <span
          className={`ze-grid-text${icon !== undefined ? ' ze-icon-text' : ''}${
            swatch !== undefined ? ' ze-swatch-text' : ''
          }`}
          style={indent ? { paddingLeft: indent } : undefined}
        >
          {icon !== undefined && (
            <img className="ze-pin-icon" src={icon} alt="" aria-hidden="true" />
          )}
          {swatch !== undefined && (
            <span className="ze-combo-swatch" style={{ background: swatch }} />
          )}
          {label}
        </span>
      );
    }

    if (grid.GetCellRenderer(aRow, aCol) instanceof wxGridCellBoolRenderer) {
      // wxGridCellBoolRenderer::Draw: the table's bool when it can give one,
      // else the string compared against the editor's "1".
      const table = grid.GetTable();
      const checked = table?.CanGetValueAs(aRow, aCol, wxGRID_VALUE_BOOL)
        ? table.GetValueAsBool(aRow, aCol)
        : value === '1';
      return (
        <input
          type="checkbox"
          tabIndex={-1}
          readOnly
          checked={checked}
          aria-label={grid.GetColLabelValue(aCol)}
        />
      );
    }

    return <span className="ze-grid-text">{value}</span>;
  };

  const rowSelected = (aRow: number): boolean =>
    mode !== wxGridSelectionModes.wxGridSelectCells
      ? grid.IsInSelection(aRow, 0)
      : shownCols.length > 0 && shownCols.every((c) => grid.IsInSelection(aRow, c));

  /**
   * A column's width. The slack goes to the one column with no width: the flexible one, or else
   * the filler. Every other column is max( stated, content ) - `1px` is "its content" - so the
   * table asks for the sum of its columns, as the wxGrid's best size does, and nothing is a
   * percentage: a `100%` cell makes an auto table claim every pixel it is offered, which is what
   * stretched Footprint Properties across the screen.
   */
  const colWidth = (c: number): { width: number } | undefined => {
    if (c === slackCol) return undefined;
    const width = columns[c]?.width ?? grid.GetStatedColSize(c);
    if (width) return { width };
    return fixedColumns ? undefined : { width: 1 };
  };

  const table = (
    <table
      ref={tableRef}
      className={`ze-grid${
        (grid as wxGrid & { AlternateRowColors?: () => boolean }).AlternateRowColors?.()
          ? ' ze-grid-striped'
          : ''
      }${fixedColumns ? ' ze-grid-fixed' : ''}${className ? ` ${className}` : ''}`}
      style={style}
      // biome-ignore lint/a11y/noNoninteractiveTabindex: the grid window takes the focus, as wx's does
      tabIndex={0}
      aria-label={ariaLabel}
      onKeyDown={(e) => {
        if (e.target === e.currentTarget) onKey(e, null);
      }}
    >
      {/* SetColLabelSize( 0 ): no label row to carry the widths, so the columns do; without
          them the table spread its width by content, and the path substitutions' Name took all
          but a sliver of it from Value. */}
      {!colLabels && (
        <colgroup>
          {rowLabels && <col style={rowLabelSize ? { width: rowLabelSize } : undefined} />}
          {shownCols.map((c) => (
            <col key={c} style={colWidth(c)} />
          ))}
          {slackCol === undefined && <col />}
        </colgroup>
      )}
      {colLabels && (
        <thead>
          <tr>
            {rowLabels && (
              <th
                className="ze-grid-corner ze-grid-rowlabel"
                style={rowLabelSize ? { width: rowLabelSize } : undefined}
              />
            )}
            {shownCols.map((c) => (
              <th
                key={c}
                className={columns[c]?.center ? 'c' : undefined}
                style={colWidth(c)}
                onClick={(e) => {
                  grid.ProcessEvent(
                    new wxGridEvent(wxEVT_GRID_LABEL_LEFT_CLICK, grid, -1, c, modifiersOf(e)),
                  );
                  // The label's mouse-up: `DoColHeaderClick`.
                  grid.DoColHeaderClick(c);
                }}
                onContextMenu={(e) => onContextMenu(-1, c, wxEVT_GRID_LABEL_RIGHT_CLICK, e)}
              >
                {c === slackCol ? (
                  // Its stated width is the least its label gets: a table cell's own
                  // min-width is not honoured, its content's is.
                  <div style={{ minWidth: columns[c]?.width ?? grid.GetStatedColSize(c) }}>
                    {grid.GetColLabelValue(c)}
                  </div>
                ) : (
                  grid.GetColLabelValue(c)
                )}
              </th>
            ))}
            {slackCol === undefined && <th className="ze-grid-filler" />}
          </tr>
        </thead>
      )}
      <tbody>
        {Array.from({ length: grid.GetNumberRows() }, (_, r) => (
          <tr key={r} className={rowSelected(r) ? 'selected' : undefined}>
            {rowLabels && (
              <td
                className="ze-grid-rowlabel"
                style={
                  grid.GetRowLabelHAlign() & wxALIGN_CENTER_HORIZONTAL
                    ? undefined
                    : { textAlign: grid.GetRowLabelHAlign() & wxALIGN_RIGHT ? 'right' : 'left' }
                }
              >
                {grid.GetRowLabelValue(r)}
              </td>
            )}
            {shownCols.map((c) => {
              const attr = grid.GetCellAttr(r, c);
              const hAlign = attr.GetHAlign();
              const center =
                hAlign !== null ? (hAlign & wxALIGN_CENTER_HORIZONTAL) !== 0 : columns[c]?.center;
              const cellSelected =
                rowSelected(r) ||
                (mode === wxGridSelectionModes.wxGridSelectCells && grid.IsInSelection(r, c));
              const painter = grid.GetCellRenderer(r, c) as Partial<wxGridCellBackgroundDrawn>;
              const background =
                painter.DrawBackground?.(cellSelected) ?? attr.GetBackgroundColour();
              const classes = [
                center ? 'c' : '',
                c === flexCol ? 'ze-grid-flexcol' : '',
                mode === wxGridSelectionModes.wxGridSelectCells &&
                !rowSelected(r) &&
                grid.IsInSelection(r, c)
                  ? 'selected'
                  : '',
              ]
                .filter(Boolean)
                .join(' ');
              const tip = tricks?.GetCellTooltip(r, c) ?? '';
              return (
                <td
                  key={c}
                  className={classes || undefined}
                  style={background ? { background } : undefined}
                  title={tip || undefined}
                  data-row={r}
                  data-col={c}
                  onMouseDown={(e) => onCellMouseDown(r, c, e)}
                  onMouseUp={onCellMouseUp}
                  onContextMenu={(e) => onContextMenu(r, c, wxEVT_GRID_CELL_RIGHT_CLICK, e)}
                >
                  {cellContent(r, c)}
                </td>
              );
            })}
            {slackCol === undefined && <td className="ze-grid-filler" />}
          </tr>
        ))}
      </tbody>
    </table>
  );
  return (
    <>
      {/* The grid window: what the sizer sizes. The rows keep their heights inside it and the
          space below them is the window's (wxGrid::DrawGridSpace) - a table given the slot's
          height instead spreads it over its rows. A grid with a wxEVT_SIZE handler is measured
          here; size containment does not apply to a table, so that is on this box too. */}
      <div ref={windowRef} className={`ze-grid-window${sized ? ' ze-grid-self-sized' : ''}`}>
        {table}
      </div>
      {menu && (
        <ContextMenu items={menu.items} x={menu.x} y={menu.y} onClose={() => setMenu(null)} />
      )}
    </>
  );
}

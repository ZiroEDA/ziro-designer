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
import type { GRID_TRICKS } from '../grid_tricks.js';
import { ContextMenu } from '../tool/action_menu_bar.js';
import type { MenuItem } from '../tool/action_menu_types.js';
import { Combo } from '../widgets/wx_combobox.js';
import { wxKeyEventFromDom } from './dom_events.js';
import {
  wxEVT_GRID_CELL_LEFT_CLICK,
  wxEVT_GRID_CELL_LEFT_DCLICK,
  wxEVT_GRID_CELL_RIGHT_CLICK,
  wxEVT_GRID_LABEL_LEFT_CLICK,
  wxEVT_GRID_LABEL_RIGHT_CLICK,
  type wxGrid,
  wxGridCellBoolRenderer,
  wxGridCellChoiceEditor,
  type wxGridCellEditor,
  wxGridEvent,
  wxGridSelectionModes,
} from './grid.js';
import { type wxMenu, wxMenuItem } from './menu.js';
import {
  wxEVT_KEY_DOWN,
  wxMOD_ALT,
  wxMOD_CONTROL,
  wxMOD_META,
  wxMOD_SHIFT,
  wxUpdateUIEvent,
} from './wx_event.js';

/** What a column needs beyond the model: its stated width (`SetColSize`), a floor. */
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

/** A wxMenu's rows for the shared ContextMenu. */
function menuItems(aMenu: wxMenu, aOnSelect: (aId: number) => void): MenuItem[] {
  return aMenu.GetMenuItems().map((item): MenuItem => {
    if (item.IsSeparator()) return { sep: true };

    const shortcut = item.GetAccelString();

    return {
      label: wxMenuItem.GetLabelText(item.GetItemLabel()),
      ...(shortcut ? { shortcut } : {}),
      ...(item.GetHelp() ? { tooltip: item.GetHelp() } : {}),
      ...(item.IsCheckable() ? { checked: item.IsChecked() } : {}),
      disabled: !item.IsEnabled(),
      action: () => aOnSelect(item.GetId()),
    };
  });
}

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
}: {
  grid: wxGrid;
  /** The grid's GRID_TRICKS, for the cell tooltips. */
  tricks?: GRID_TRICKS;
  columns?: readonly GRID_COLUMN_VIEW[];
  /** `SetupColumnAutosizer( aFlexibleCol )`: the column that takes the slack. */
  flexCol?: number;
  rowLabels?: boolean;
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
        items: menuItems(aMenu, (id) => {
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
  });

  const editor = grid.GetCurrentEditor();
  const cursorRow = grid.GetGridCursorRow();
  const cursorCol = grid.GetGridCursorCol();

  // The editor closed: the grid window takes the focus back.
  const wasEditing = useRef(false);
  useEffect(() => {
    if (wasEditing.current && !editor) tableRef.current?.focus();
    wasEditing.current = editor !== null;
  });

  const shownCols = Array.from({ length: grid.GetNumberCols() }, (_, c) => c).filter((c) =>
    grid.IsColShown(c),
  );
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

    return (
      <input
        className="ze-grid-input"
        type="text"
        size={1}
        autoFocus
        value={aEditor.m_value}
        onChange={(e) => {
          aEditor.m_value = e.target.value;
          bump();
        }}
        onKeyDown={(e) => onKey(e, e.currentTarget)}
        onBlur={() => {
          if (grid.GetCurrentEditor() === aEditor) grid.DisableCellEditControl();
        }}
      />
    );
  };

  const cellContent = (aRow: number, aCol: number): ReactNode => {
    if (editor && aRow === cursorRow && aCol === cursorCol) return editorFor(aRow, aCol, editor);

    const value = grid.GetCellValue(aRow, aCol);
    const custom = renderCell?.(aRow, aCol, value);

    if (custom) return custom;

    if (grid.GetCellRenderer(aRow, aCol) instanceof wxGridCellBoolRenderer)
      return (
        <input
          type="checkbox"
          tabIndex={-1}
          readOnly
          checked={value === '1'}
          aria-label={grid.GetColLabelValue(aCol)}
        />
      );

    return <span className="ze-grid-text">{value}</span>;
  };

  const rowSelected = (aRow: number): boolean =>
    mode !== wxGridSelectionModes.wxGridSelectCells
      ? grid.IsInSelection(aRow, 0)
      : shownCols.length > 0 && shownCols.every((c) => grid.IsInSelection(aRow, c));

  return (
    <>
      <table
        ref={tableRef}
        className={`ze-grid${className ? ` ${className}` : ''}`}
        style={style}
        // biome-ignore lint/a11y/noNoninteractiveTabindex: the grid window takes the focus, as wx's does
        tabIndex={0}
        aria-label={ariaLabel}
        onKeyDown={(e) => {
          if (e.target === e.currentTarget) onKey(e, null);
        }}
      >
        {colLabels && (
          <thead>
            <tr>
              {rowLabels && <th className="ze-grid-corner ze-grid-rowlabel" />}
              {shownCols.map((c) => (
                <th
                  key={c}
                  className={columns[c]?.center ? 'c' : undefined}
                  style={columns[c]?.width ? { width: columns[c]!.width } : undefined}
                  onClick={(e) =>
                    grid.ProcessEvent(
                      new wxGridEvent(wxEVT_GRID_LABEL_LEFT_CLICK, grid, -1, c, modifiersOf(e)),
                    )
                  }
                  onContextMenu={(e) => onContextMenu(-1, c, wxEVT_GRID_LABEL_RIGHT_CLICK, e)}
                >
                  {grid.GetColLabelValue(c)}
                </th>
              ))}
              <th className="ze-grid-filler" />
            </tr>
          </thead>
        )}
        <tbody>
          {Array.from({ length: grid.GetNumberRows() }, (_, r) => (
            <tr key={r} className={rowSelected(r) ? 'selected' : undefined}>
              {rowLabels && <td className="ze-grid-rowlabel">{grid.GetRowLabelValue(r)}</td>}
              {shownCols.map((c) => {
                const classes = [
                  columns[c]?.center ? 'c' : '',
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
              <td className="ze-grid-filler" />
            </tr>
          ))}
        </tbody>
      </table>
      {menu && (
        <ContextMenu items={menu.items} x={menu.x} y={menu.y} onClose={() => setMenu(null)} />
      )}
    </>
  );
}

// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * PROPERTIES_PANEL — the docked Properties pane, once, for every launcher.
 *
 * Counterpart: `common/widgets/properties_panel.cpp` / `.h`. Upstream the
 * WIDGET lives in `common/` and each editor subclasses it only to supply data:
 * `eeschema/widgets/sch_properties_panel.cpp` and
 * `pcbnew/widgets/pcb_properties_panel.cpp` override `UpdateData()`,
 * `createPGProperty()` and `valueChanged()` and nothing about how the thing
 * looks. Everything the two subclasses disagree about is *rows*, so everything
 * they agree about belongs here.
 *
 * What `properties_panel.cpp` actually specifies, and what this port keeps:
 *
 *  - a `wxStaticText` caption above the grid carrying, for one selected item,
 *    `EDA_ITEM::GetFriendlyName()` — the item's TYPE, "Symbol" — and otherwise
 *    "No objects selected" or "%d objects selected" (:196-210);
 *  - a `wxPropertyGrid`, so a row is a grid cell and not a form field: the
 *    value is drawn as text and an editor control exists only while the cell
 *    is activated;
 *  - `wxPropertyCategory` group headers, collapsible, one per property group in
 *    the group display order, with the unnamed group captioned
 *    "Basic Properties" (:339, `unspecifiedGroupCaption`);
 *  - rows sorted inside a group by the property manager's display order, which
 *    is why the caller hands rows over already ordered;
 *  - `pgProp->ChangeFlag( wxPG_PROP_READONLY, !writeable )` (:323), which
 *    `PG_CELL_RENDERER::Render` turns into value text in
 *    `GetCellDisabledTextColour()` — and only the value: the name column keeps
 *    its normal foreground.
 *
 * The command type is a parameter so this stays launcher-agnostic exactly the
 * way `PROPERTIES_PANEL` is: eeschema commits through `SCH_COMMIT`, pcbnew
 * through `BOARD_COMMIT`, and the widget knows about neither.
 *
 * pcbnew consumes this too, through `pcbnew/src/properties_panel.ts` and
 * `editors/pcb/PcbPropertiesPanel.tsx`; the ~1200 lines of `Pg*` components
 * and seven per-item panels that used to live inline in `PcbEditor.tsx` are
 * gone. Adopting it needed two fields, and each has a real consumer:
 *
 *  - `swatch`, the colour rectangle `PGPROPERTY_COLORENUM::OnCustomPaint`
 *    (pg_properties.cpp:647-669) paints before the value.
 *    `PCB_PROPERTIES_PANEL::createPGProperty` (:466-500) turns EVERY
 *    `PCB_LAYER_ID` property into one of those, with `SetColorFunc` reading
 *    `m_frame->GetColorSettings()->GetColor()`, which is how a Layer row gets
 *    its swatch. It is NOT `PGPROPERTY_COLOR4D`/`COLOR_SWATCH`
 *    (pg_cell_renderer.cpp:38-58): that paints the WHOLE value cell and is
 *    used by *eeschema*'s subclass (sch_properties_panel.cpp:472), not by
 *    pcbnew's, and nothing here reads it yet.
 *  - `optional`, which is `PGPROPERTY_DISTANCE` over `std::optional<int>`:
 *    `DistanceToString` returns `wxEmptyString` when the optional is empty and
 *    `PG_UNIT_EDITOR::GetValueFromControl` (pg_editors.cpp:262-286) writes an
 *    empty optional back when the control is cleared. That is what makes a
 *    pad's Clearance Override read blank — "inherit" — rather than "0".
 */
import { Fragment, useEffect, useState } from 'react';
import type { JSX } from 'react';
import { COLOR4D_UNSPECIFIED, parseColor4d, toHexString } from '@ziroeda/common';
import { ColorSwatch } from '../ui/ColorSwatch.js';
import './properties_panel.css';

/**
 * One row of the grid.
 *
 * `coord` and `dist` carry internal units and are rendered through the frame's
 * unit conversion, the way `PGPROPERTY_COORD` / `PGPROPERTY_SIZE` go through
 * `PG_UNIT_EDITOR`'s unit binder. A row with no `set` is the read-only case:
 * upstream that is `wxPG_PROP_READONLY`, set from
 * `PROPERTY_MANAGER::IsWriteableFor`.
 */
export interface PropertyGridRow<C> {
  /** The property's group; '' is upstream's unnamed group. */
  readonly group: string;
  readonly name: string;
  readonly kind: 'coord' | 'dist' | 'string' | 'bool' | 'int' | 'choice' | 'color';
  readonly choices?: readonly string[];
  /**
   * `PGPROPERTY_COLORENUM`'s custom image (pg_properties.cpp:647-669): a CSS
   * colour painted as a rectangle before the value. pcbnew gives one to every
   * `PCB_LAYER_ID` row.
   */
  readonly swatch?: string;
  /**
   * `null` is `std::optional<int>` with no value, which
   * `PGPROPERTY_DISTANCE::DistanceToString` renders as the empty string.
   */
  readonly value: string | number | boolean | null;
  /**
   * The underlying property is `std::optional<int>`, so an emptied cell means
   * "no value" and commits `''` rather than being parsed as a number
   * (`PG_UNIT_EDITOR::GetValueFromControl`, pg_editors.cpp:262-286).
   */
  readonly optional?: boolean;
  /** Absent for a read-only property. Returns the edit to commit, or null to
   *  reject the input and put the cell back. */
  readonly set?: (v: string | number | boolean) => C | null;
}

/**
 * `unspecifiedGroupCaption` (properties_panel.cpp:339): the group a property
 * registered without one falls into is captioned "Basic Properties".
 */
export const UNSPECIFIED_GROUP_CAPTION = 'Basic Properties';

/**
 * What a colour cell commits.
 *
 * `COLOR4D::UNSPECIFIED` is fully transparent, and upstream stores it as "no
 * colour" rather than as a transparent black -- `SCH_FIELD` has no colour token
 * at all in that state. So an alpha of zero clears the property; anything else
 * commits the colour. Named rather than inlined because it is a rule, and a
 * lambda in a JSX prop is not reachable from a test.
 */
export function colorCellValue(c: Parameters<typeof toHexString>[0]): string {
  return c.a <= 0 ? '' : toHexString(c);
}

/**
 * The caption string, from `PROPERTIES_PANEL::rebuildProperties` (:196-210).
 * Exported because it is a rule, not a rendering detail: an empty selection
 * says so, one selected item is named by its TYPE, and several are counted.
 */
export function propertiesPanelCaption(count: number, friendlyName?: string): string {
  if (count === 0) return 'No objects selected';
  if (count === 1) return friendlyName ?? '';
  return `${count} objects selected`;
}

/** Rows in the order given, split into groups in first-appearance order. */
function groupRows<C>(
  rows: readonly PropertyGridRow<C>[],
): { title: string; caption: string; rows: PropertyGridRow<C>[] }[] {
  const groups: { title: string; caption: string; rows: PropertyGridRow<C>[] }[] = [];
  for (const r of rows) {
    const found = groups.find((g) => g.title === r.group);
    if (found) found.rows.push(r);
    else
      groups.push({
        title: r.group,
        caption: r.group === '' ? UNSPECIFIED_GROUP_CAPTION : r.group,
        rows: [r],
      });
  }
  return groups;
}

/**
 * The value column of one row.
 *
 * A `wxPropertyGrid` cell is not a control. `wxPropertyGrid::DoSelectProperty`
 * calls `wxPGEditor::CreateControls` when a cell is activated and destroys the
 * control again when it is not, so at rest the value is painted text. The one
 * exception is a bool: `PGPROPERTY_BOOL` uses `PG_CHECKBOX_EDITOR`, and a
 * checkbox editor's `DrawValue` paints the box in the resting cell too, which
 * is why the pin flags and the mirror flags show real checkboxes while
 * Orientation shows the word "180".
 *
 * What ACTIVATES the cell is the cell, not the text in it. `HandleMouseClick(
 * int x, unsigned int y, wxMouseEvent& )` (wx/propgrid/propgrid.h:1747) is
 * handed the click's x and compares it against the splitter position, so
 * anywhere right of the splitter selects the property and builds its editor.
 * This component therefore renders the value cell itself and carries the
 * handler there: hung on the text span instead, a row whose value is EMPTY —
 * "Footprint" on a symbol whose library part leaves it blank — had a
 * zero-width hit target and could not be opened at all, and a one-character
 * one ("Datasheet", which KiCad's libraries write as "~") had a few pixels.
 */
function ValueCell<C>({
  row,
  fmt,
  parse,
  onCommand,
}: {
  row: PropertyGridRow<C>;
  fmt: (iu: number) => string;
  parse: (text: string) => number | null;
  onCommand: (cmd: C) => void;
}): JSX.Element {
  const isDist = row.kind === 'coord' || row.kind === 'dist';
  const display = row.value === null ? '' : isDist ? fmt(row.value as number) : String(row.value);
  const [editing, setEditing] = useState(false);
  const [text, setText] = useState(display);

  // Re-sync when the document (and so the row value) changes under us.
  // biome-ignore lint/correctness/useExhaustiveDependencies: display is derived
  useEffect(() => setText(display), [display]);

  const commitValue = (v: string | number | boolean): boolean => {
    const cmd = row.set?.(v);
    if (cmd === undefined || cmd === null) return false;
    onCommand(cmd);
    return true;
  };

  /**
   * The cell the row's value lives in. `activate` is the click wxPropertyGrid
   * answers with `DoSelectProperty`; it is absent for a read-only property, for
   * a bool (whose checkbox is the editor, and is already live at rest), and
   * once the editor is up.
   */
  const cell = (inner: JSX.Element, activate?: () => void): JSX.Element => (
    // biome-ignore lint/a11y/useKeyWithClickEvents: a wxPropertyGrid cell is
    // reached from the keyboard by selecting the ROW, which is the grid's job,
    // not the cell's.
    // biome-ignore lint/a11y/noStaticElementInteractions: as above — this is
    // the cell rectangle wxPropertyGrid hit-tests, not a control.
    <span className="ze-pgrid-value" onClick={activate}>
      {/* `PGPROPERTY_COLORENUM::OnCustomPaint`: a plain filled rectangle in the
          cell's image slot, drawn before the value text. Not a `COLOR_SWATCH` —
          that widget is a button onto DIALOG_COLOR_PICKER and this is paint. */}
      {row.swatch !== undefined && (
        <span className="ze-pgrid-swatch" style={{ background: row.swatch }} />
      )}
      {inner}
    </span>
  );

  // `PGPROPERTY_COLOR4D`, which `SCH_PROPERTIES_PANEL::createPGProperty`
  // (sch_properties_panel.cpp:472-476) builds for every COLOR4D property and
  // hands `LAYER_SCHEMATIC_BACKGROUND` so the cell composites over the sheet.
  // It is not the `swatch` above: that one is `PGPROPERTY_COLORENUM`'s painted
  // rectangle, which pcbnew gives a layer row and which nothing can click. This
  // is `COLOR_SWATCH` — a control, opening `DIALOG_COLOR_PICKER`.
  //
  // `ui/ColorSwatch.tsx` already is that control, checkerboard and picker
  // included, so this row hands it the value and takes the answer back; the
  // panel does not draw a swatch of its own.
  if (row.kind === 'color') {
    const css = typeof row.value === 'string' ? row.value : '';
    return cell(
      <ColorSwatch
        color={css === '' ? COLOR4D_UNSPECIFIED : parseColor4d(css)}
        size="small"
        label={row.name}
        disabled={!row.set}
        onChange={(c) => commitValue(colorCellValue(c))}
      />,
    );
  }

  if (row.kind === 'bool') {
    return cell(
      <input
        className="ze-pgrid-check"
        type="checkbox"
        checked={row.value as boolean}
        disabled={!row.set}
        onChange={(e) => commitValue(e.target.checked)}
      />,
    );
  }

  if (!row.set || !editing)
    return cell(
      <span className="ze-pgrid-text" title={display}>
        {display}
      </span>,
      row.set ? () => setEditing(true) : undefined,
    );

  if (row.kind === 'choice') {
    return cell(
      <select
        className="ze-pgrid-editor"
        // biome-ignore lint/a11y/noAutofocus: the just-activated cell's editor
        autoFocus
        value={String(row.value)}
        onChange={(e) => {
          commitValue(e.target.value);
          setEditing(false);
        }}
        onBlur={() => setEditing(false)}
        onKeyDown={(e) => e.stopPropagation()}
      >
        {row.choices?.map((c) => (
          <option key={c} value={c}>
            {c}
          </option>
        ))}
      </select>,
    );
  }

  const commitText = (): void => {
    setEditing(false);
    if (text === display) return;
    let v: string | number | boolean = text;
    if (isDist) {
      // The `std::optional<int>` branch: an emptied cell is "no value", and it
      // is committed as such instead of being parsed into a number.
      if (row.optional && text.trim() === '') {
        if (!commitValue('')) setText(display);
        return;
      }
      const iu = parse(text);
      if (iu === null) {
        setText(display);
        return;
      }
      v = iu;
    } else if (row.kind === 'int') {
      const n = Number(text);
      if (!Number.isInteger(n)) {
        setText(display);
        return;
      }
      v = n;
    }
    if (!commitValue(v)) setText(display);
  };

  return cell(
    <input
      className="ze-pgrid-editor"
      type="text"
      // biome-ignore lint/a11y/noAutofocus: the just-activated cell's editor
      autoFocus
      value={text}
      onChange={(e) => setText(e.target.value)}
      onBlur={commitText}
      onKeyDown={(e) => {
        if (e.key === 'Enter') commitText();
        else if (e.key === 'Escape') {
          setText(display);
          setEditing(false);
        }
        // The canvas listens for bare keys; a cell editor must swallow them.
        e.stopPropagation();
      }}
    />,
  );
}

/**
 * The panel. `selectionCount` and `friendlyName` are the selection facts
 * `rebuildProperties` reads off the SELECTION; `rows` is what the subclass's
 * `UpdateData()` produced, already in display order.
 */
export function PropertiesPanel<C>({
  selectionCount,
  friendlyName,
  rows,
  fmt,
  parse,
  onCommand,
}: {
  selectionCount: number;
  friendlyName?: string;
  rows: readonly PropertyGridRow<C>[];
  fmt: (iu: number) => string;
  parse: (text: string) => number | null;
  onCommand: (cmd: C) => void;
}): JSX.Element {
  const [collapsed, setCollapsed] = useState<readonly string[]>([]);
  // `reset()` (:186-194) clears the grid whenever nothing is selected, so an
  // empty selection is a caption and no rows, never stale ones.
  const groups = selectionCount === 0 ? [] : groupRows(rows);

  return (
    <div className="ze-pgrid-panel">
      <div className="ze-pgrid-caption">{propertiesPanelCaption(selectionCount, friendlyName)}</div>
      <div className="ze-pgrid">
        {groups.map((g) => {
          const open = !collapsed.includes(g.title);
          return (
            <Fragment key={g.title || ' base'}>
              <div
                className="ze-pgrid-cat"
                data-group={g.title}
                onClick={() =>
                  setCollapsed((c) =>
                    c.includes(g.title) ? c.filter((t) => t !== g.title) : [...c, g.title],
                  )
                }
              >
                <span className={open ? 'ze-pgrid-twisty open' : 'ze-pgrid-twisty'} />
                <span className="ze-pgrid-cat-label">{g.caption}</span>
              </div>
              {open &&
                g.rows.map((r) => (
                  <div
                    className="ze-pgrid-row"
                    key={`${g.title}/${r.name}`}
                    data-readonly={r.set ? undefined : ''}
                  >
                    <span className="ze-pgrid-margin" />
                    <span className="ze-pgrid-name" title={r.name}>
                      {r.name}
                    </span>
                    {/* ValueCell renders `.ze-pgrid-value` itself, swatch and
                        all, because the cell rectangle is what a click has to
                        land on to activate the property. */}
                    <ValueCell
                      key={`${r.name}:${String(r.value)}`}
                      row={r}
                      fmt={fmt}
                      parse={parse}
                      onCommand={onCommand}
                    />
                  </div>
                ))}
            </Fragment>
          );
        })}
      </div>
    </div>
  );
}

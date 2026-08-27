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
 * pcbnew has a second copy of all of this, written inline in `PcbEditor.tsx`
 * (the `Pg*` components and the seven per-item panels below them). Its rows
 * are the same shape as `PropertyGridRow`, so consuming this widget is a
 * matter of turning those panels into row builders — a `pcbPropertiesFor` to
 * match eeschema's `schPropertiesFor` — rather than of changing the API. The
 * one thing it needs that is not here is a `color` kind: `PGPROPERTY_COLOR4D`
 * has `PG_CELL_RENDERER` paint a `COLOR_SWATCH` into the value cell
 * (pg_cell_renderer.cpp:38-58), which is how a layer row gets its swatch.
 * That kind is deliberately absent until something reads it — an unused field
 * beside a component that draws its own is exactly the drift this widget
 * exists to end.
 */
import { Fragment, useEffect, useState } from 'react';
import type { JSX } from 'react';
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
  readonly kind: 'coord' | 'dist' | 'string' | 'bool' | 'int' | 'choice';
  readonly choices?: readonly string[];
  readonly value: string | number | boolean;
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
  const display = isDist ? fmt(row.value as number) : String(row.value);
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

  if (row.kind === 'bool') {
    return (
      <input
        className="ze-pgrid-check"
        type="checkbox"
        checked={row.value as boolean}
        disabled={!row.set}
        onChange={(e) => commitValue(e.target.checked)}
      />
    );
  }

  if (!row.set)
    return (
      <span className="ze-pgrid-text" title={display}>
        {display}
      </span>
    );

  if (!editing)
    return (
      <span className="ze-pgrid-text" title={display} onClick={() => setEditing(true)}>
        {display}
      </span>
    );

  if (row.kind === 'choice') {
    return (
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
      </select>
    );
  }

  const commitText = (): void => {
    setEditing(false);
    if (text === display) return;
    let v: string | number | boolean = text;
    if (isDist) {
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

  return (
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
    />
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
                    <span className="ze-pgrid-value">
                      <ValueCell
                        key={`${r.name}:${String(r.value)}`}
                        row={r}
                        fmt={fmt}
                        parse={parse}
                        onCommand={onCommand}
                      />
                    </span>
                  </div>
                ))}
            </Fragment>
          );
        })}
      </div>
    </div>
  );
}

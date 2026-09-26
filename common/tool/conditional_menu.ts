// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * `CONDITIONAL_MENU` — `common/tool/conditional_menu.cpp`.
 *
 * Every KiCad tool menu is built this way: each tool that has something to
 * contribute calls `AddItem( action, condition, order )` on the SAME menu
 * object, from its own `Init()`, and the menu is re-evaluated against the live
 * selection every time it is popped up. Two rules do all the work:
 *
 *   - **order** (`addEntry`, :210-221) — a new entry is inserted after every
 *     entry whose order is less than or equal to its own, so the list is sorted
 *     ascending and ties keep their insertion order. This is what lets three
 *     unrelated files interleave their rows without knowing about each other.
 *
 *   - **separator elision** (`Evaluate`, :128-190) — `menu_count` counts the
 *     rows emitted since the last separator that was actually drawn, and a
 *     separator with `menu_count == 0` is skipped. So a group that conditions
 *     itself away takes its rule with it, and the menu never opens on a rule.
 *     Note what `menu_count` is NOT: it is not per order-group. A separator
 *     draws if *anything* preceded it since the last one, even from a lower
 *     group.
 *
 * Writing the evaluated shape out by hand instead — `if (hasSelection) push(…)`
 * — is how a menu quietly stops matching: the conditions end up spelled once in
 * the layout rather than once per row, and a rule that should vanish stays.
 */
import type { MenuItem } from './action_menu_types.js';
import { BITMAPS } from '../bitmaps_list.js';
import { wxItemKind, wxMenuItem } from '../wx/menu.js';
import { ACTION_MENU, type TOOL_INTERACTIVE_LIKE } from './action_menu.js';
import { SELECTION } from './selection.js';
import { type SELECTION_CONDITION, SELECTION_CONDITIONS } from './selection_conditions.js';
import type { TOOL_ACTION } from './tool_action.js';

/** One `CONDITIONAL_MENU::ENTRY`. */
export interface ConditionalEntry {
  /** The row, or omitted for `ENTRY::SEPARATOR`. */
  item?: MenuItem;
  /** `AddSeparator( order )`. */
  separator?: boolean;
  /** The `aOrder` argument. Entries are drawn in ascending order. */
  order: number;
  /** The `SELECTION_CONDITION`, already evaluated against the selection. */
  when?: boolean;
}

/** `AddItem( aAction, aCondition, aOrder )`. */
export function menuEntry(item: MenuItem, order: number, when = true): ConditionalEntry {
  return { item, order, when };
}

/** `AddSeparator( aOrder )`. */
export function menuSeparator(order: number): ConditionalEntry {
  return { separator: true, order };
}

/**
 * `CONDITIONAL_MENU::Evaluate` — sort by order, drop the entries whose
 * condition is false, and drop every separator that has nothing in front of it.
 */
export function evaluateConditionalMenu(entries: readonly ConditionalEntry[]): MenuItem[] {
  const sorted = [...entries]
    .map((e, i) => ({ e, i }))
    .sort((a, b) => a.e.order - b.e.order || a.i - b.i)
    .map(({ e }) => e);

  const out: MenuItem[] = [];
  let menuCount = 0;

  for (const entry of sorted) {
    if (entry.separator) {
      if (menuCount) out.push({ sep: true });
      menuCount = 0;
      continue;
    }
    if (entry.when === false || !entry.item) continue;
    out.push(entry.item);
    menuCount++;
  }

  return out;
}

// ---- CONDITIONAL_MENU --------------------------------------------------------

enum ENTRY_TYPE {
  ACTION,
  MENU,
  WXITEM,
  SEPARATOR,
}

/** `CONDITIONAL_MENU::ENTRY`: one entry and the condition that shows it. */
class ENTRY {
  constructor(
    readonly m_type: ENTRY_TYPE,
    readonly m_condition: SELECTION_CONDITION,
    public m_order: number,
    readonly m_isCheckmarkEntry: boolean,
    readonly m_action: TOOL_ACTION | null = null,
    readonly m_menu: ACTION_MENU | null = null,
    readonly m_wxItem: {
      id: number;
      text: string;
      tooltip: string;
      kind: wxItemKind;
    } | null = null,
    readonly m_icon: BITMAPS = BITMAPS.INVALID_BITMAP,
  ) {}

  Type(): ENTRY_TYPE {
    return this.m_type;
  }

  Condition(): SELECTION_CONDITION {
    return this.m_condition;
  }

  Order(): number {
    return this.m_order;
  }

  SetOrder(aOrder: number): void {
    this.m_order = aOrder;
  }

  IsCheckmarkEntry(): boolean {
    return this.m_isCheckmarkEntry;
  }
}

/**
 * `CONDITIONAL_MENU` (`common/tool/conditional_menu.cpp`): an ACTION_MENU
 * whose entries each carry a SELECTION_CONDITION, re-built by Evaluate for
 * the selection the menu is shown over.
 */
export class CONDITIONAL_MENU extends ACTION_MENU {
  ///< Constant to indicate that we do not care about an #ENTRY location in the menu.
  static readonly ANY_ORDER = -1;

  ///< List of all menu entries.
  private m_entries: ENTRY[] = [];

  constructor(aTool: TOOL_INTERACTIVE_LIKE | null) {
    super(true, aTool);
  }

  protected override create(): ACTION_MENU {
    const clone = new CONDITIONAL_MENU(this.m_tool);
    clone.m_entries = [...this.m_entries];
    return clone;
  }

  /**
   * Add a menu entry to run a TOOL_ACTION on selected items.
   */
  AddItem(aAction: TOOL_ACTION, aCondition: SELECTION_CONDITION, aOrder?: number): void;
  /**
   * Add a menu entry to run an arbitrary command on selected items.
   */
  AddItem(
    aId: number,
    aText: string,
    aTooltip: string,
    aIcon: BITMAPS,
    aCondition: SELECTION_CONDITION,
    aOrder?: number,
  ): void;
  AddItem(
    a: TOOL_ACTION | number,
    b: SELECTION_CONDITION | string,
    c?: number | string,
    d?: BITMAPS,
    e?: SELECTION_CONDITION,
    f?: number,
  ): void {
    if (typeof a !== 'number') {
      console.assert(a.GetId() > 0); // Check if action was previously registered in ACTION_MANAGER
      this.addEntry(
        new ENTRY(
          ENTRY_TYPE.ACTION,
          b as SELECTION_CONDITION,
          (c as number | undefined) ?? CONDITIONAL_MENU.ANY_ORDER,
          false,
          a,
        ),
      );
      return;
    }

    this.addEntry(
      new ENTRY(
        ENTRY_TYPE.WXITEM,
        e!,
        f ?? CONDITIONAL_MENU.ANY_ORDER,
        false,
        null,
        null,
        { id: a, text: b as string, tooltip: c as string, kind: wxItemKind.wxITEM_NORMAL },
        d ?? BITMAPS.INVALID_BITMAP,
      ),
    );
  }

  /**
   * Add a checkable menu entry to run a TOOL_ACTION on selected items.
   */
  AddCheckItem(aAction: TOOL_ACTION, aCondition: SELECTION_CONDITION, aOrder?: number): void;
  AddCheckItem(
    aId: number,
    aText: string,
    aTooltip: string,
    aIcon: BITMAPS,
    aCondition: SELECTION_CONDITION,
    aOrder?: number,
  ): void;
  AddCheckItem(
    a: TOOL_ACTION | number,
    b: SELECTION_CONDITION | string,
    c?: number | string,
    d?: BITMAPS,
    e?: SELECTION_CONDITION,
    f?: number,
  ): void {
    if (typeof a !== 'number') {
      console.assert(a.GetId() > 0); // Check if action was previously registered in ACTION_MANAGER
      this.addEntry(
        new ENTRY(
          ENTRY_TYPE.ACTION,
          b as SELECTION_CONDITION,
          (c as number | undefined) ?? CONDITIONAL_MENU.ANY_ORDER,
          true,
          a,
        ),
      );
      return;
    }

    this.addEntry(
      new ENTRY(
        ENTRY_TYPE.WXITEM,
        e!,
        f ?? CONDITIONAL_MENU.ANY_ORDER,
        true,
        null,
        null,
        { id: a, text: b as string, tooltip: c as string, kind: wxItemKind.wxITEM_CHECK },
        d ?? BITMAPS.INVALID_BITMAP,
      ),
    );
  }

  /**
   * Add a submenu to the menu.
   *
   * CONDITIONAL_MENU takes ownership of the added menu, so it will be freed when the
   * CONDITIONAL_MENU object is destroyed.
   */
  AddMenu(
    aMenu: ACTION_MENU,
    aCondition: SELECTION_CONDITION = SELECTION_CONDITIONS.ShowAlways,
    aOrder: number = CONDITIONAL_MENU.ANY_ORDER,
  ): void {
    this.addEntry(new ENTRY(ENTRY_TYPE.MENU, aCondition, aOrder, false, null, aMenu));
  }

  /**
   * Add a separator to the menu.
   */
  AddSeparator(aOrder?: number): void;
  AddSeparator(aCondition: SELECTION_CONDITION, aOrder?: number): void;
  AddSeparator(a?: number | SELECTION_CONDITION, b?: number): void {
    if (typeof a === 'function')
      this.addEntry(new ENTRY(ENTRY_TYPE.SEPARATOR, a, b ?? CONDITIONAL_MENU.ANY_ORDER, false));
    else
      this.addEntry(
        new ENTRY(
          ENTRY_TYPE.SEPARATOR,
          SELECTION_CONDITIONS.ShowAlways,
          a ?? CONDITIONAL_MENU.ANY_ORDER,
          false,
        ),
      );
  }

  /**
   * Update the contents of the menu based on the supplied conditions.
   */
  Evaluate(aSelection: SELECTION): void {
    this.Clear();

    // We try to avoid adding useless separators (when no menuitems between separators)
    let menu_count = 0; // number of menus since the latest separator

    for (const entry of this.m_entries) {
      const cond = entry.Condition();
      let result: boolean;

      try {
        result = cond(aSelection);
      } catch {
        continue;
      }

      if (!result) continue;

      switch (entry.Type()) {
        case ENTRY_TYPE.ACTION:
          this.Add(entry.m_action!, entry.IsCheckmarkEntry());
          menu_count++;
          break;

        case ENTRY_TYPE.MENU:
          entry.m_menu!.UpdateTitle();
          this.Add(entry.m_menu!.Clone());
          menu_count++;
          break;

        case ENTRY_TYPE.WXITEM: {
          const w = entry.m_wxItem!;
          const menuItem = new wxMenuItem(this, w.id, w.text, w.tooltip, w.kind);

          if (entry.m_icon !== BITMAPS.INVALID_BITMAP) menuItem.SetBitmap(entry.m_icon);

          // the wxMenuItem must be append only after the bitmap is set:
          this.Append(menuItem);

          menu_count++;
          break;
        }

        case ENTRY_TYPE.SEPARATOR:
          if (menu_count) this.AppendSeparator();

          menu_count = 0;
          break;
      }
    }

    // Recursively call Evaluate on all the submenus that are CONDITIONAL_MENUs to ensure
    // they are updated. This is also required on GTK to make sure the menus have the proper
    // size when created.
    this.runOnSubmenus((aMenu) => {
      if (aMenu instanceof CONDITIONAL_MENU) aMenu.Evaluate(aSelection);
    });
  }

  /**
   * Update the initial contents so that wxWidgets doesn't get its knickers tied in a knot
   * over the menu being empty (mainly an issue on GTK, but also on OSX with the preferences
   * and quit menu items).
   */
  Resolve(): void {
    this.Evaluate(new SELECTION());
    this.UpdateAll();

    this.runOnSubmenus((aMenu) => {
      if (aMenu instanceof CONDITIONAL_MENU) aMenu.Resolve();
    });
  }

  ///< Inserts the entry, preserving the requested order.
  private addEntry(aEntry: ENTRY): void {
    if (aEntry.Order() < 0)
      // Any order, so give it any order number
      aEntry.SetOrder(this.m_entries.length);

    let it = 0;

    // Find the right spot for the entry
    while (it < this.m_entries.length && this.m_entries[it]!.Order() <= aEntry.Order()) ++it;

    this.m_entries.splice(it, 0, aEntry);
  }
}

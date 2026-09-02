// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * `PANEL_TOOLBAR_CUSTOMIZATION` — the Toolbars page, written **once**.
 *
 * Upstream this is `common/dialogs/panel_toolbar_customization.{h,cpp}` plus
 * its wxFormBuilder base, and it is one class for all seven frames that have
 * the page. Each KIFACE constructs the same type and hands it that app's
 * settings, that app's `TOOLBAR_SETTINGS` file, its `FRAME_T`, and the action
 * and control lists to offer:
 *
 *     return new PANEL_TOOLBAR_CUSTOMIZATION( aParent, cfg, tb, FRAME_PL_EDITOR,
 *                                             actions, controls );
 *     (pagelayout_editor/pl_editor.cpp:99; eeschema.cpp:301, :357;
 *      pcbnew.cpp:395, :466, :495; gerbview.cpp:110)
 *
 * So this component takes the same things as props and knows no editor. The
 * `FRAME_T` argument exists upstream only to drive `isActionSupported`, which
 * filters `ACTION_MANAGER`'s global action list down to the app's own; ours is
 * handed the app's default toolbars instead, and the set of buttons they name
 * *is* that filtered list. See `ui/toolbar_config.ts` for why, and the note on
 * {@link PanelToolbarCustomization} for what that costs.
 *
 * **Layout**, from `panel_toolbar_customization_base.cpp:15-133`: a
 * "Customize toolbars" checkbox, a horizontal rule, then a three-column
 * `wxFlexGridSizer` — the toolbar being edited on the left (a "Toolbar:"
 * choice, the item tree, and a row of Insert / up / down / delete buttons), a
 * single left-arrow button in the middle, and the filterable action list on the
 * right. Everything below the checkbox is enabled by it
 * (`enableCustomControls`).
 *
 * The up and down buttons are `Enable( false )` in upstream's constructor, with
 * the comment `// TODO (ISM): Enable draging` — so they are drawn and dead
 * there too. Restoring them here would be a divergence, not a fix.
 */
import { useMemo, useState, type JSX } from 'react';
import { Check } from './widgets.js';
import { Combo } from '../../ui/Combo.js';
import { SplitButton } from '../../ui/SplitButton.js';
import { StdBitmapButton } from '../../ui/StdBitmapButton.js';
import { toolbarIconUrl } from '../../ui/toolbarIcons.js';
import { toolbarButtonLabel } from '../../ui/toolbar_actions.js';
import { toolbarControlDescription, toolbarControlUiName } from '../../ui/toolbar_controls.js';
import {
  TOOLBAR_LOC_NAMES,
  configFromEntries,
  setStoredToolbarConfig,
  storedToolbarConfig,
  toolbarControlNames,
  toolbarLocsOf,
  toolbarTemplates,
  type ToolbarConfigJson,
  type ToolbarDefaults,
  type ToolbarItemJson,
  type ToolbarLoc,
  type ToolbarSettings,
} from '../../ui/toolbar_config.js';
import type { MenuItem } from '../../ui/menu_types.js';

/** A selected tree node: a top-level index, and a child index inside a group. */
interface TreeSel {
  i: number;
  /** null for a top-level item. */
  j: number | null;
}

/** One row of `m_actionsList`: `PANEL_TOOLBAR_CUSTOMIZATION::ACTION_LIST_ENTRY`. */
interface ActionEntry {
  label: string;
  tooltip: string;
  /** `entry.label.Upper() + " " + entry.tooltip.Upper()`. */
  search: string;
  /** Set for a TOOL; `control` is set instead for a CONTROL. */
  action?: string;
  control?: string;
  /** The bitmap the row and the tree draw, when the action has one. */
  icon?: string;
}

export function PanelToolbarCustomization({
  app,
  defaults,
  custom,
  setCustom,
  store,
  update,
}: {
  /**
   * Which app's TOOL_ACTIONs the ids name, for `toolbar_actions.ts`. Upstream's
   * `aActionContext`, minus the filtering job `defaults` now does.
   */
  app: string;
  /** That app's `DefaultToolbarConfig`, keyed by `TOOLBAR_LOC`. */
  defaults: ToolbarDefaults;
  /** `m_appSettings->m_CustomToolbars`. */
  custom: boolean;
  setCustom: (v: boolean) => void;
  /** The working copy of that app's `TOOLBAR_SETTINGS`. */
  store: ToolbarSettings;
  update: (fn: (s: ToolbarSettings) => void) => void;
}): JSX.Element {
  const locs = useMemo(() => toolbarLocsOf(defaults), [defaults]);
  const [loc, setLoc] = useState<ToolbarLoc>(() => locs[0] ?? 'TOP_MAIN');
  const [sel, setSel] = useState<TreeSel | null>(null);
  const [filter, setFilter] = useState('');
  const [selAction, setSelAction] = useState(0);
  const [editing, setEditing] = useState<number | null>(null);
  /**
   * `m_toolbarTree->ExpandAll()` (`:575`) opens every group, and a wxTreeCtrl
   * with `wxTR_HAS_BUTTONS` — which `wxTR_DEFAULT_STYLE` carries — then lets
   * the user shut one again. Only the closed ones are tracked, so a group
   * added later starts open the way `ExpandAll` leaves it.
   */
  const [collapsed, setCollapsed] = useState<ReadonlySet<number>>(() => new Set());

  /**
   * `TransferDataToWindow` (`panel_toolbar_customization.cpp:270-322`) fills the
   * shadow toolbars from `GetToolbarConfig( tb )` — the stored configuration if
   * there is one, `DefaultToolbarConfig` otherwise. Ours asks the same question
   * per render instead of copying the answer into the working copy on mount,
   * which is the same thing to look at and differs in one invisible way:
   *
   * upstream's `TransferDataFromWindow` writes ALL four toolbars back through
   * `SetStoredToolbarConfig` on OK, changed or not (`:352-354`), so merely
   * opening this page and pressing OK freezes that app's toolbars at today's
   * defaults for ever. Ours stores a toolbar only once it is edited, so an
   * untouched toolbar keeps following `DefaultToolbarConfig` as the port's
   * parity work moves it. Nothing on screen differs; a `<app>-toolbars.json`
   * written by the two would.
   *
   * It is also what makes `ResetPanel` a one-liner — see
   * `dialogs/prefs/toolbar_reset.ts`.
   */
  const items: ToolbarConfigJson = useMemo(
    () => storedToolbarConfig(store, loc) ?? configFromEntries(defaults[loc] ?? []),
    [store, loc, defaults],
  );

  const tools = useMemo(() => toolbarTemplates(defaults), [defaults]);
  const controls = useMemo(() => toolbarControlNames(defaults), [defaults]);

  /** `populateActions` (`:582-643`): the tools, then the controls, then sorted. */
  const entries = useMemo<ActionEntry[]>(() => {
    const out: ActionEntry[] = [];
    for (const [id, b] of tools) {
      const label = toolbarButtonLabel(app, id, b.title) || id;
      const tooltip = b.title ?? '';
      out.push({
        label,
        tooltip,
        search: `${label} ${tooltip}`.toUpperCase(),
        action: id,
        icon: id,
      });
    }
    for (const name of controls) {
      const label = toolbarControlUiName(name);
      const tooltip = toolbarControlDescription(name);
      out.push({ label, tooltip, search: `${label} ${tooltip}`.toUpperCase(), control: name });
    }
    // `a.label.CmpNoCase( b.label ) < 0`.
    return out.sort((a, b) => a.label.toLowerCase().localeCompare(b.label.toLowerCase()));
  }, [app, tools, controls]);

  /** `applyActionFilter` (`:657-687`): `search_text.Contains( filter.Upper() )`. */
  const shown = useMemo(
    () => entries.filter((e) => filter === '' || e.search.includes(filter.toUpperCase())),
    [entries, filter],
  );

  // ----- editing the tree ------------------------------------------------------

  /** The current toolbar, materialised if it was still the default. */
  const listOf = (s: ToolbarSettings, l: ToolbarLoc): ToolbarItemJson[] => [
    ...(storedToolbarConfig(s, l) ?? configFromEntries(defaults[l] ?? [])),
  ];

  const write = (fn: (list: ToolbarItemJson[]) => void): void => {
    update((s) => {
      const list = listOf(s, loc);
      fn(list);
      setStoredToolbarConfig(s, loc, list);
    });
  };

  /** `InsertItem( parent, selItem, … )`: after the selection, at its level. */
  const insertTop = (item: ToolbarItemJson): void => {
    write((list) => {
      const at = sel ? sel.i + 1 : list.length;
      list.splice(at, 0, item);
      setSel({ i: at, j: null });
    });
  };

  /**
   * Upstream refuses to put a separator, a spacer or a group inside a group:
   * when the selection has a grandparent it `delete`s the new item and returns
   * (`:707-714`, `:744-753`, `:783-792`).
   */
  const insideGroup = sel?.j !== null && sel?.j !== undefined;

  const onInsertSeparator = (): void => {
    if (insideGroup) return;
    insertTop({ type: 'SEPARATOR' });
  };

  const onInsertSpacer = (): void => {
    if (insideGroup) return;
    // `TOOLBAR_TREE_ITEM_DATA( TOOLBAR_ITEM_TYPE::SPACER, 5 )` (`:733`). [data]
    insertTop({ type: 'SPACER', size: 5 });
  };

  const onInsertGroup = (): void => {
    if (insideGroup) return;
    // `_( "Group" )` (`:703`), the label a new group is created under and which
    // the user then edits in place.
    insertTop({ type: 'TB_GROUP', group_name: 'Group', group_items: [] });
  };

  /** `onToolDelete` (`:834-853`): delete, then fall back to the previous row. */
  const onDelete = (): void => {
    if (!sel) return;
    write((list) => {
      if (sel.j === null) {
        list.splice(sel.i, 1);
        setSel(sel.i > 0 ? { i: sel.i - 1, j: null } : null);
      } else {
        const g = list[sel.i];
        if (!g?.group_items) return;
        const kids = [...g.group_items];
        kids.splice(sel.j, 1);
        list[sel.i] = { ...g, group_items: kids };
        setSel(sel.j > 0 ? { i: sel.i, j: sel.j - 1 } : { i: sel.i, j: null });
      }
    });
  };

  /** `onBtnAddAction` (`:868-949`). */
  const onAdd = (): void => {
    const entry = shown[selAction];
    if (!entry) return;
    const item: ToolbarItemJson = entry.control
      ? { type: 'CONTROL', name: entry.control }
      : { type: 'TOOL', name: entry.action };

    update((s) => {
      // `removeControlFromOtherToolbars` (`:1052-1069`) — a control may sit on
      // one toolbar only, and adding it here takes it off the others.
      if (entry.control) {
        for (const row of s.toolbars) {
          if (row.name === loc) continue;
          row.contents = row.contents.filter(
            (it) => !(it.type === 'CONTROL' && it.name === entry.control),
          );
        }
      }
      const list = listOf(s, loc);
      // `removeControlFromCurrentTree` (`:1072-1099`).
      const cleaned = entry.control
        ? list.filter((it) => !(it.type === 'CONTROL' && it.name === entry.control))
        : list;

      // Upstream's selection is a `wxTreeItemId`, which survives the removal
      // above; ours is an index, so it is clamped to what is left.
      const selected = sel && sel.i < cleaned.length ? sel : null;
      const target = selected ? cleaned[selected.i] : undefined;

      if (selected && target?.type === 'TB_GROUP' && selected.j === null && entry.action) {
        // "Insert into the end of the group".
        const kids = [...(target.group_items ?? []), item];
        cleaned[selected.i] = { ...target, group_items: kids };
        setSel({ i: selected.i, j: kids.length - 1 });
      } else if (selected && selected.j !== null && entry.action) {
        const g = cleaned[selected.i];
        if (g?.group_items) {
          const kids = [...g.group_items];
          kids.splice(selected.j + 1, 0, item);
          cleaned[selected.i] = { ...g, group_items: kids };
          setSel({ i: selected.i, j: selected.j + 1 });
        }
      } else {
        const at = selected ? selected.i + 1 : cleaned.length;
        cleaned.splice(at, 0, item);
        setSel({ i: at, j: null });
      }
      setStoredToolbarConfig(s, loc, cleaned);
    });

    // "Move the action to the next available one, to be nice" (`:944-946`).
    if (selAction + 1 < shown.length) setSelAction(selAction + 1);
  };

  /** `onTreeEndLabelEdit` (`:1006-1029`): groups only, and never to empty. */
  const renameGroup = (i: number, name: string): void => {
    setEditing(null);
    if (name.trim() === '') return;
    write((list) => {
      const g = list[i];
      if (g?.type === 'TB_GROUP') list[i] = { ...g, group_name: name };
    });
  };

  // ----- labels ----------------------------------------------------------------

  const toolLabel = (id: string | undefined): string | null => {
    if (id === undefined) return null;
    const b = tools.get(id);
    return b ? toolbarButtonLabel(app, id, b.title) || id : null;
  };

  /** `populateToolbarTree`'s per-type label (`:439-565`). */
  const rowLabel = (it: ToolbarItemJson): string | null => {
    switch (it.type) {
      case 'SEPARATOR':
        return 'Separator';
      case 'SPACER':
        // `wxString::Format( _( "Spacer: %i" ), item.m_Size )`.
        return `Spacer: ${it.size ?? 0}`;
      case 'CONTROL':
        return it.name !== undefined && controls.has(it.name)
          ? toolbarControlUiName(it.name)
          : null;
      case 'TOOL':
        return toolLabel(it.name);
      case 'TB_GROUP':
        return it.group_name ?? '';
    }
  };

  const enabled = custom;
  const hasToolbar = locs.includes(loc);

  const insertItems: MenuItem[] = [
    // `insertMenu->Append( ID_SPACER_MENU, _( "Insert Spacer" ) )` and
    // `ID_GROUP_MENU, _( "Insert Group" )` (`:158-159`).
    { label: 'Insert Spacer', action: onInsertSpacer },
    { label: 'Insert Group', action: onInsertGroup },
  ];

  return (
    <div className="ze-tbcust">
      <Check label="Customize toolbars" checked={custom} onChange={setCustom} />
      <hr className="ze-tbcust-rule" />

      <div className="ze-tbcust-cols">
        <div className="ze-tbcust-col">
          {/* `bToolbarSizer`: the label `wxLEFT, 5` and `m_tbChoice` at
              proportion ONE, so the choice takes the rest of the column. It is
              a wxChoice, which is the app's own Combo — never a native
              <select>, which paints the browser's chevron and its own popup. */}
          <div className="ze-tbcust-tbrow">
            <span className="lbl" id="ze-tbcust-tblabel">
              Toolbar:
            </span>
            <Combo
              value={loc}
              ariaLabel="Toolbar"
              options={locs.map((l) => ({ value: l, label: TOOLBAR_LOC_NAMES[l] }))}
              disabled={!enabled}
              onChange={(v) => {
                setLoc(v as ToolbarLoc);
                setSel(null);
                setCollapsed(new Set());
              }}
            />
          </div>

          {/* `UP_DOWN_TREE`, a wxTreeCtrl with `wxTR_DEFAULT_STYLE | wxTR_EDIT_LABELS
              | wxTR_HIDE_ROOT | wxTR_NO_LINES` (`..._base.cpp:60`).
              `wxTR_DEFAULT_STYLE` carries `wxTR_HAS_BUTTONS`, so a group row
              draws an expander and its children indent under it. Ours drew
              neither: every row started at the same x and a group was told
              apart only by its lack of an icon. */}
          <ul className="ze-tbcust-tree" aria-label="Toolbar items">
            {hasToolbar &&
              items.map((it, i) => {
                const label = rowLabel(it);
                if (label === null) return null;
                const isSel = sel?.i === i && sel.j === null;
                const icon = it.type === 'TOOL' && it.name ? toolbarIconUrl(it.name) : undefined;
                const isGroup = it.type === 'TB_GROUP';
                const open = isGroup && !collapsed.has(i);
                return (
                  // biome-ignore lint/suspicious/noArrayIndexKey: the index IS
                  // the item's identity here; two separators are equal values.
                  <li key={`${it.type}-${i}`}>
                    {/* biome-ignore lint/a11y/useKeyWithClickEvents: a wxTreeCtrl
                        row is reached with the arrow keys, which the list owns. */}
                    <div
                      className={`ze-tbcust-row${isSel ? ' sel' : ''}`}
                      onClick={() => enabled && setSel({ i, j: null })}
                      onDoubleClick={() => {
                        // `onTreeItemActivated` (`:988-1002`): a group, and only
                        // a group, starts a label edit.
                        if (enabled && isGroup) setEditing(i);
                      }}
                    >
                      {/* The expander gutter. Every row reserves it — that is
                          what lines a leaf up with a group's label — and only a
                          group draws a button in it. */}
                      {isGroup ? (
                        // biome-ignore lint/a11y/useKeyWithClickEvents: the
                        // expander is a wxTreeCtrl hit region, not a control;
                        // the keyboard opens a node with Left/Right on the row.
                        <span
                          className={`twisty expandable${open ? ' open' : ''}`}
                          onClick={(e) => {
                            e.stopPropagation();
                            setCollapsed((prev) => {
                              const next = new Set(prev);
                              if (open) next.add(i);
                              else next.delete(i);
                              return next;
                            });
                          }}
                        />
                      ) : (
                        <span className="twisty" />
                      )}
                      {icon ? <img src={icon} alt="" /> : <span className="ze-tbcust-noicon" />}
                      {editing === i ? (
                        <input
                          className="ze-search"
                          autoFocus
                          defaultValue={it.group_name ?? ''}
                          onKeyDown={(e) => {
                            e.stopPropagation();
                            if (e.key === 'Enter') renameGroup(i, e.currentTarget.value);
                            if (e.key === 'Escape') setEditing(null);
                          }}
                          onBlur={(e) => renameGroup(i, e.currentTarget.value)}
                        />
                      ) : (
                        <span>{label}</span>
                      )}
                    </div>
                    {isGroup && open && (
                      <ul>
                        {(it.group_items ?? []).map((g, j) => {
                          const childLabel = toolLabel(g.name);
                          if (childLabel === null) return null;
                          const childSel = sel?.i === i && sel.j === j;
                          const childIcon = g.name ? toolbarIconUrl(g.name) : undefined;
                          return (
                            // biome-ignore lint/suspicious/noArrayIndexKey: as above.
                            <li key={`${g.name}-${j}`}>
                              {/* biome-ignore lint/a11y/useKeyWithClickEvents: as above. */}
                              <div
                                className={`ze-tbcust-row${childSel ? ' sel' : ''}`}
                                onClick={() => enabled && setSel({ i, j })}
                              >
                                <span className="twisty" />
                                {childIcon ? (
                                  <img src={childIcon} alt="" />
                                ) : (
                                  <span className="ze-tbcust-noicon" />
                                )}
                                <span>{childLabel}</span>
                              </div>
                            </li>
                          );
                        })}
                      </ul>
                    )}
                  </li>
                );
              })}
          </ul>

          <div className="ze-tbcust-btns">
            {/* SPLIT_BUTTON: the wide half runs `onSeparatorPress`, the arrow
                half drops the two-row wxMenu (`:152-167`). */}
            <SplitButton
              label="Insert Separator"
              menuLabel="Insert"
              disabled={!enabled}
              onClick={onInsertSeparator}
              menu={insertItems}
            />
            {/* `m_btnToolMoveUp->Enable( false )` / `m_btnToolMoveDown->Enable(
                false )` in the constructor, above `// TODO (ISM): Enable
                draging` (`:188-190`). Dead upstream, so dead here. */}
            <StdBitmapButton bitmap="small_up" title="Move up" disabled onClick={() => {}} />
            <StdBitmapButton bitmap="small_down" title="Move down" disabled onClick={() => {}} />
            {/* `bSizerToolbarBtns->Add( 20, 0, 0, 0, 5 )` — the fixed gap that
                separates delete from the rest. [px] wxFormBuilder's own 20. */}
            <span className="ze-tbcust-gap" />
            <StdBitmapButton
              bitmap="small_trash"
              title="Delete"
              disabled={!enabled || !sel}
              onClick={onDelete}
            />
          </div>
        </div>

        <div className="ze-tbcust-mid">
          <StdBitmapButton
            bitmap="left"
            title="Add to toolbar"
            disabled={!enabled}
            onClick={onAdd}
          />
        </div>

        <div className="ze-tbcust-col">
          {/* `m_actionFilter` is a wxSearchCtrl:
              `ShowCancelButton( true )` and
              `SetDescriptiveText( _( "Filter actions" ) )` (`:174-176`). GTK
              draws the magnifier as the entry's own primary icon and the ✕ when
              there is text, which is the same pair the Hotkeys filter and the
              template selector already wear — one wxSearchCtrl upstream, one
              wrapper here. (The class is named after the first call site that
              needed it, not after this one.) */}
          <div className="ze-tplsel-searchwrap ze-tbcust-filter">
            <span className="mag" aria-hidden="true" />
            <input
              className="ze-tplsel-nameinput ze-bare"
              type="text"
              placeholder="Filter actions"
              aria-label="Filter actions"
              value={filter}
              disabled={!enabled}
              onChange={(e) => {
                setFilter(e.target.value);
                setSelAction(0);
              }}
              onKeyDown={(e) => e.stopPropagation()}
            />
            {filter !== '' && (
              // biome-ignore lint/a11y/useKeyWithClickEvents: a wxSearchCtrl's
              // cancel button is painted inside the entry, which owns the
              // keyboard — Escape clears it there too.
              <span className="cancel" title="Clear the filter" onClick={() => setFilter('')} />
            )}
          </div>
          <ul className="ze-tbcust-list" aria-label="Actions">
            {shown.map((e, i) => (
              <li key={e.action ?? `control:${e.control}`}>
                {/* biome-ignore lint/a11y/useKeyWithClickEvents: a wxListCtrl row
                    is reached with the arrow keys, which the list owns. */}
                <div
                  className={`ze-tbcust-row${selAction === i ? ' sel' : ''}`}
                  title={e.tooltip}
                  onClick={() => enabled && setSelAction(i)}
                  onDoubleClick={() => {
                    // `onListItemActivated` (`:1046-1050`) is `onBtnAddAction`.
                    if (enabled) {
                      setSelAction(i);
                      onAdd();
                    }
                  }}
                >
                  {e.icon && toolbarIconUrl(e.icon) ? (
                    <img src={toolbarIconUrl(e.icon)} alt="" />
                  ) : (
                    <span className="ze-tbcust-noicon" />
                  )}
                  <span>{e.label}</span>
                </div>
              </li>
            ))}
          </ul>
        </div>
      </div>
    </div>
  );
}

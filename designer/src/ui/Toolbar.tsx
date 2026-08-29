// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
import { useEffect, useRef, useState, type CSSProperties, type JSX, type ReactNode } from 'react';
import { Icon } from './icons.js';
import { toolbarIconUrl } from './toolbarIcons.js';
import { toolbarButtonLabel, toolbarButtonTooltip } from './toolbar_actions.js';
import { ContextMenu } from './MenuBar.js';
import type { MenuItem } from './menu_types.js';
import { toolbarContextMenu } from './toolbar_context_menu_registry.js';

// The data types live in toolbar_types.ts so toolbar inventory modules stay
// reachable from qa's tsconfig, which compiles .ts only. Re-exported here so
// every existing importer keeps working.
import { groupIsCheckItem, nextInGroup, toolbarButtonDisabled } from './toolbar_types.js';
import type { ToolButton, ToolGroup, ToolControl, ToolSpacer, ToolEntry } from './toolbar_types.js';
export type { ToolButton, ToolGroup, ToolControl, ToolSpacer, ToolEntry };

interface Props {
  entries: ToolEntry[];
  /**
   * Which app's TOOL_ACTIONs these ids name, for `toolbar_actions.ts`.
   *
   * A toolbar id is not globally unique: `placeText` is
   * `SCH_ACTIONS::placeSchematicText` ("Draw Text", T) in eeschema and
   * `PCB_ACTIONS::placeText` ("Add Text", Ctrl+Shift+T) in pcbnew. Omitting it
   * falls back to each button's own `title`, which is what every editor that
   * has not been transcribed yet does.
   */
  app?: string;
  orientation: 'horizontal' | 'vertical';
  side?: 'left' | 'right';
  /** id of the currently active (radio-selected) tool, for the right toolbar. */
  activeTool?: string;
  /** set of ids that are toggled on, for the left toolbar. */
  toggled?: ReadonlySet<string>;
  /** ids to grey out dynamically (e.g. hierarchy nav when there's nowhere to go),
   *  on top of a button's own static `disabled` flag. */
  disabledIds?: ReadonlySet<string>;
  onActivate?: (id: string) => void;
  /** Widgets for the `{ control }` entries, keyed by control name. */
  controls?: Record<string, ReactNode>;
  /** Rendered after the buttons, toolbar CONTROLS (choices etc.). */
  trailing?: ReactNode;
}

// The time between pressing the left mouse button and opening the palette
// (ACTION_TOOLBAR's PALETTE_OPEN_DELAY).
const PALETTE_OPEN_DELAY = 500;
// Border around the palette buttons on all sides / between adjacent buttons.
const PALETTE_BORDER = 4;
const BUTTON_BORDER = 1;

interface PaletteState {
  group: ToolGroup;
  /** Bounding rect of the group button that opened the palette. */
  anchor: DOMRect;
}

/** An open per-button context menu (`ACTION_TOOLBAR::showContextMenu`). */
interface ButtonMenuState {
  items: MenuItem[];
  x: number;
  y: number;
}

export function Toolbar({
  entries,
  app,
  orientation,
  side,
  activeTool,
  toggled,
  disabledIds,
  onActivate,
  controls,
  trailing,
}: Props): JSX.Element {
  // Selected ("default") action of each group, like ACTION_GROUP's
  // m_defaultAction: the palette pick the group button currently shows.
  const [groupSel, setGroupSel] = useState<Record<string, string>>({});
  const [palette, setPalette] = useState<PaletteState | null>(null);
  const [buttonMenu, setButtonMenu] = useState<ButtonMenuState | null>(null);
  const pressTimer = useRef<number | null>(null);
  // Swallows the click that ends the press which opened the palette.
  const suppressClick = useRef(false);

  const cancelTimer = (): void => {
    if (pressTimer.current !== null) {
      window.clearTimeout(pressTimer.current);
      pressTimer.current = null;
    }
  };
  useEffect(() => cancelTimer, []);

  // wxPopupTransientWindow: any press outside the palette (or Escape)
  // dismisses it.
  useEffect(() => {
    if (!palette) return;
    const onDown = (e: PointerEvent): void => {
      if (!(e.target as Element | null)?.closest('.ze-tb-palette')) setPalette(null);
    };
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') setPalette(null);
    };
    document.addEventListener('pointerdown', onDown, true);
    document.addEventListener('keydown', onKey, true);
    return () => {
      document.removeEventListener('pointerdown', onDown, true);
      document.removeEventListener('keydown', onKey, true);
    };
  }, [palette]);

  const isDisabled = (b: ToolButton): boolean => toolbarButtonDisabled(b, disabledIds);

  /** The action a group button currently displays and activates. */
  const displayedAction = (g: ToolGroup): ToolButton => {
    const active = g.actions.find((a) => a.id === activeTool);
    if (active) return active;
    const toggledAction = toggled ? g.actions.find((a) => toggled.has(a.id)) : undefined;
    if (toggledAction) return toggledAction;
    const sel = g.actions.find((a) => a.id === groupSel[g.group]);
    return sel ?? g.actions[0]!;
  };

  /**
   * `ACTION_TOOLBAR::showContextMenu` (`common/tool/action_toolbar.cpp:851-880`).
   *
   * `shownId` is what upstream's first step produces: "Ensure that the ID maps
   * to a proper tool ID. If right-clicked on a group item, this is needed to
   * get the ID of the currently selected action, since the event's ID is that
   * of the group." A group therefore has no menu of its own — it borrows the
   * menu of whichever action its button is displaying — which is also why
   * `AddToolContextMenu` files a *group's* registered menu under every action
   * in it (`:374-381`).
   *
   * Nothing checks whether the button is enabled: upstream pops the menu for a
   * greyed tool too.
   */
  const openButtonMenu = (shownId: string, e: { clientX: number; clientY: number }): boolean => {
    const items = toolbarContextMenu(app, shownId, (id) => onActivate?.(id), {
      // One ACTION_CONDITIONS answers for a button and for a menu row alike,
      // so a row for an action this frame has greyed out is greyed here too.
      disabled: (id) => !!disabledIds?.has(id),
    });
    if (!items) return false;
    setPalette(null);
    cancelTimer();
    setButtonMenu({ items, x: e.clientX, y: e.clientY });
    return true;
  };

  const openPalette = (g: ToolGroup, btn: HTMLElement): void => {
    cancelTimer();
    suppressClick.current = true;
    setPalette({ group: g, anchor: btn.getBoundingClientRect() });
  };

  const renderButton = (
    b: ToolButton,
    opts: { group?: ToolGroup; inPalette?: boolean } = {},
  ): JSX.Element => {
    const disabled = isDisabled(b);
    /**
     * Whether a group's button can paint checked at all — see
     * {@link groupIsCheckItem}, which is `isToggleEntry` in
     * `ACTION_TOOLBAR::AddGroup`. Without it the units button lights from
     * `toggled` membership, because `toggled` carries the CURRENT unit; the
     * action's flags never reach this decision on their own.
     */
    const groupChecks = !opts.group || groupIsCheckItem(opts.group);
    /**
     * Membership of `toggled` picks WHICH action a group button displays —
     * upstream's `doSelectAction`, driven by `SelectToolbarAction` when the
     * unit changes. It does NOT decide whether the button is checked; that is
     * `groupChecks` above. Displaying an action and being checked are two
     * decisions, and the units group is where ours had them as one.
     */
    const isActive = !opts.inPalette && groupChecks && (activeTool === b.id || toggled?.has(b.id));
    const url = toolbarIconUrl(b.id) ?? toolbarIconUrl(b.icon);
    const g = opts.group;
    return (
      <button
        key={b.id}
        className={`ze-tbtn${isActive ? ' active' : ''}${disabled ? ' disabled' : ''}${g ? ' ze-tbtn-group' : ''}`}
        /*
         * `ACTION_TOOLBAR` sets this to `aAction.GetButtonTooltip()`
         * (common/tool/action_toolbar.cpp:149) — FriendlyName, a tab and the
         * hotkey, then the action's own `.Tooltip()` on a SECOND LINE. Every
         * toolbar here used to pass one pre-joined string and so had no second
         * line at all, on every button of every editor.
         *
         * The parts come from `toolbar_actions.ts`, the shared transcription of
         * the TOOL_ACTIONs, for the same reason the icon does: KiCad writes
         * `ACTIONS::save` once in `common/` and every editor points at it.
         */
        title={toolbarButtonTooltip(app, b.id, b.title)}
        /* Not the tooltip: a tab and a newline are read aloud as punctuation,
           so the accessible name is `GetFriendlyName()` on its own. */
        aria-label={toolbarButtonLabel(app, b.id, b.title)}
        aria-pressed={isActive}
        disabled={disabled}
        onPointerDown={(e) => {
          if (!g || disabled || e.button !== 0) return;
          suppressClick.current = false;
          const btn = e.currentTarget;
          cancelTimer();
          pressTimer.current = window.setTimeout(() => openPalette(g, btn), PALETTE_OPEN_DELAY);
        }}
        onPointerLeave={(e) => {
          // Dragging off the pressed button opens the palette immediately
          // (ACTION_TOOLBAR::onItemDrag).
          if (g && pressTimer.current !== null && e.buttons & 1) openPalette(g, e.currentTarget);
          else cancelTimer();
        }}
        onPointerUp={cancelTimer}
        /*
         * `wxEVT_AUITOOLBAR_RIGHT_CLICK` (`ACTION_TOOLBAR::onRightClick`,
         * `common/tool/action_toolbar.cpp:215, 821-830`), plus the hit-tested
         * right-up a vertical bar needs (`:833-848`). A right-click is the
         * ONLY gesture that opens this menu — there is no drop-down arrow, and
         * the long press belongs to the group palette above.
         *
         * A palette row never carries one: upstream's palette is a separate
         * popup window with its own buttons, not toolbar items, so no
         * `wxAuiToolBarItem` id reaches `showContextMenu` from it.
         */
        onContextMenu={(e) => {
          if (opts.inPalette) return;
          if (openButtonMenu(b.id, e)) e.preventDefault();
        }}
        onClick={(e) => {
          if (disabled) return;
          if (suppressClick.current) {
            suppressClick.current = false;
            return;
          }
          // A click on a toggle group's button steps to the next option, the
          // way ACTION_TOOLBAR::onToolEvent does. It used to open the palette
          // instead, which left no way to *pick* anything with one click and
          // made the long press pointless, since both gestures did the same.
          if (g?.cycleOnClick && !opts.inPalette) {
            const next = nextInGroup(g, b.id);
            setGroupSel((p) => ({ ...p, [g.group]: next.id }));
            onActivate?.(next.id);
            return;
          }
          if (opts.inPalette && g) {
            setGroupSel((p) => ({ ...p, [g.group]: b.id }));
            setPalette(null);
          }
          onActivate?.(b.id);
        }}
      >
        {url ? <img src={url} alt="" /> : <Icon name={b.icon} />}
      </button>
    );
  };

  // ACTION_TOOLBAR::popupPalette: perpendicular to the toolbar, aligned with
  // the button that opened it, shifted off the toolbar by the palette border.
  const paletteStyle = (p: PaletteState): CSSProperties => {
    const pad = PALETTE_BORDER + BUTTON_BORDER;
    if (orientation === 'vertical') {
      const style: CSSProperties = { top: p.anchor.top - pad };
      if (side === 'right') style.right = window.innerWidth - p.anchor.left + PALETTE_BORDER;
      else style.left = p.anchor.right + PALETTE_BORDER;
      return style;
    }
    return { top: p.anchor.bottom + PALETTE_BORDER, left: p.anchor.left - pad };
  };

  return (
    <div className={`ze-toolbar ${orientation}${side ? ` ${side}` : ''}`} role="toolbar">
      {entries.map((e, i) => {
        if (e === 'sep') return <span key={`s${i}`} className="ze-sep" />;
        // AddSpacer( item.m_Size ): raw pixels along the bar's own axis.
        if ('spacer' in e)
          return (
            <span
              key={`sp${i}`}
              className="ze-tb-spacer"
              style={orientation === 'horizontal' ? { width: e.spacer } : { height: e.spacer }}
            />
          );
        if ('control' in e)
          return (
            <span key={e.control} className="ze-tb-control">
              {controls?.[e.control]}
            </span>
          );
        if ('group' in e) {
          const shown = displayedAction(e);
          return (
            <span
              key={e.group}
              className="ze-tb-groupwrap"
              title={toolbarButtonTooltip(app, shown.id, shown.title)}
            >
              {renderButton(shown, { group: e })}
              <span className={`ze-tb-arrow${isDisabled(shown) ? ' disabled' : ''}`} />
            </span>
          );
        }
        return renderButton(e);
      })}
      {trailing}
      {palette && (
        <div
          className={`ze-tb-palette ${orientation === 'vertical' ? 'horizontal' : 'vertical'}`}
          style={paletteStyle(palette)}
          role="menu"
          aria-label={palette.group.group}
        >
          {palette.group.actions.map((a) =>
            renderButton(a, { group: palette.group, inPalette: true }),
          )}
        </div>
      )}
      {buttonMenu && (
        <ContextMenu
          items={buttonMenu.items}
          x={buttonMenu.x}
          y={buttonMenu.y}
          onClose={() => setButtonMenu(null)}
        />
      )}
    </div>
  );
}

// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
import { useEffect, useLayoutEffect, useRef, useState, type JSX, type ReactNode } from 'react';
import { NO_ARROWS, submenuEnds } from './menu_scroll.js';

// The data types live in menu_types.ts so menu-building modules stay
// reachable from qa's tsconfig, which compiles .ts only. Re-exported here so
// every existing importer keeps working.
import type { Menu, MenuItem } from './menu_types.js';
import { useModalEscape } from './useModalEscape.js';
export type { Menu, MenuItem };

/** Case-insensitive single-character key match, as wx matches an accelerator. */
const sameKey = (a: string, b: string): boolean => a.toLowerCase() === b.toLowerCase();

/** A label with its mnemonic underlined — wx's rendering of the `&` in an
 *  ACTION_MENU string. The first occurrence wins, matched case-insensitively. */
function withMnemonic(label: string | undefined, mnemonic: string | undefined): ReactNode {
  if (!label || !mnemonic) return label;
  const i = label.toLowerCase().indexOf(mnemonic.toLowerCase());
  if (i < 0) return label;
  return (
    <>
      {label.slice(0, i)}
      <u>{label[i]}</u>
      {label.slice(i + 1)}
    </>
  );
}

/** One dropdown row: separator, plain/CHECK item, or item with a flyout submenu. */
function MenuEntry({ item, close }: { item: MenuItem; close: () => void }): JSX.Element {
  const [subOpen, setSubOpen] = useState(false);
  const rowRef = useRef<HTMLDivElement>(null);
  const subRef = useRef<HTMLDivElement>(null);
  /**
   * Where the flyout goes, in viewport coordinates.
   *
   * It is `position: fixed`, not `absolute`. An absolutely-positioned flyout is
   * still part of its ancestor's scrollable area, so the 45-row Set Language
   * menu made the whole *page* scroll — title bar and menu bar slid off the top
   * of the window. A desktop frame never scrolls; only the thing inside it
   * does. Fixed takes it out of flow, and the clamp below keeps it on screen
   * the way a WM keeps a popup on the monitor.
   */
  const [box, setBox] = useState<{ left: number; top: number } | null>(null);
  const [over, setOver] = useState<'up' | 'down' | null>(null);
  /** Which ends can still scroll: an arrow shows only when there is something
   *  that way, which is how GTK draws them — no arrow on a menu that is already
   *  at its top, none at the bottom once you have reached the end. */
  const [ends, setEnds] = useState({ up: false, down: false });

  const syncEnds = (): void => {
    const el = subRef.current?.querySelector('.ze-submenu-scroll');
    if (!el) return;
    // A menu that fits gets NO arrow at either end — GTK grows them only on a
    // menu too tall for the monitor. Two things made one appear on a three-item
    // menu and cover its first row:
    //
    //  - `clientHeight` is 0 until the pane has been laid out, and
    //    `scrollHeight - 0` then reads as a full menu's worth of "more below";
    //  - the arrows are part of this flex column, so once they were mounted the
    //    next open measured THEM instead of the rows and clamped the flyout to
    //    arrow height, which is what hid the items.
    //
    // Requiring real overflow closes both: no overflow, no arrows, and the
    // measurement sees rows again.
    setEnds(submenuEnds(el.scrollTop, el.scrollHeight, el.clientHeight));
  };

  useLayoutEffect(() => {
    if (!subOpen) {
      setBox(null);
      // Arrows must not survive the close: they are rows in this flex column, so
      // leaving them mounted makes the NEXT open measure arrow height and clamp
      // the flyout to it.
      setEnds(NO_ARROWS);
      return;
    }
    const row = rowRef.current;
    const el = subRef.current;
    if (!row || !el) return;
    const r = row.getBoundingClientRect();
    const w = el.offsetWidth;
    // `offsetHeight`, and the cap is CSS's, not ours. This used to set maxHeight
    // from `el.scrollHeight` — the flyout's own height — which is circular: the
    // element being measured already carried the previous render's clamp, so
    // every open re-clamped from the last one until the box collapsed to arrow
    // height. Measured on a ONE-row View > Panels flyout: max-height 34px, a
    // 26px row in an 8px pane, and a down arrow covering it.
    //
    // A menu is limited by the monitor and nothing else, so the cap is a
    // constant in the stylesheet and a short menu simply stays short.
    const h = el.offsetHeight;
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    // Flip to the row's left edge when the flyout would run off the right, as
    // a WM flips a popup that will not fit on the monitor.
    const left = r.right + w <= vw - 4 ? r.right : Math.max(4, r.left - w);
    const top = Math.max(4, Math.min(r.top - 4, vh - 4 - h));
    setBox({ left, top });
    // The rows are laid out by now, so the ends are knowable.
    requestAnimationFrame(syncEnds);
  }, [subOpen]);

  // GTK scrolls a too-tall menu while the pointer rests on its arrow, rather
  // than exposing a scrollbar. One step per frame-ish, stopped on leave.
  useEffect(() => {
    if (!over) return;
    const el = subRef.current?.querySelector('.ze-submenu-scroll');
    if (!el) return;
    const id = setInterval(() => {
      el.scrollTop += over === 'up' ? -12 : 12;
      syncEnds();
    }, 30);
    return () => clearInterval(id);
  }, [over]);

  if (item.sep) return <div className="ze-msep" />;
  const sub = item.submenu ?? item.items;
  const hasSub = !!sub && sub.length > 0;
  return (
    <div
      ref={rowRef}
      className={`ze-mitem${item.disabled ? ' disabled' : ''}${hasSub ? ' has-sub' : ''}`}
      style={hasSub ? { position: 'relative' } : undefined}
      title={item.tooltip}
      onMouseEnter={() => {
        if (hasSub) setSubOpen(true);
        item.onHover?.(true);
      }}
      onMouseLeave={() => {
        if (hasSub) setSubOpen(false);
        item.onHover?.(false);
      }}
      onClick={() => {
        if (item.disabled || hasSub) return;
        close();
        item.action?.();
      }}
    >
      {/* No bitmap. `appearance.use_icons_in_menus` defaults TRUE on Linux
          (common_settings.cpp:94-99 — it is off only on __WXMAC__), so KiCad
          does attach a bitmap to the item via KIUI::AddBitmapToMenuItem
          (action_menu.cpp:159). GTK3 then draws nothing: `gtk-menu-images` was
          deprecated and turned off upstream, so menu-item images do not render
          at all. [px] a real Schematic Editor File menu has an empty gutter —
          Save, Print and Plot carry icons in ours and none in KiCad's.

          The check mark stays: that is a wxITEM_CHECK item, not a bitmap, and
          GTK renders it. */}
      <span className="mico">{item.checked ? <span className="mcheck">✓</span> : null}</span>
      <span className="lbl">{withMnemonic(item.label, item.mnemonic)}</span>
      {item.shortcut && <span className="sc">{item.shortcut}</span>}
      {/* The same drawn chevron the project tree's twisty uses, rather than a
          glyph: a solid ▸ is a different weight from every other expander in
          the app, and its size is at the mercy of whichever font has it. */}
      {hasSub && <span className="twisty expandable sub-arrow" />}
      {hasSub && subOpen && !item.disabled && (
        <div
          ref={subRef}
          className="ze-dropdown ze-submenu"
          style={{
            position: 'fixed',
            left: box ? box.left : -9999,
            top: box ? box.top : 0,
            visibility: box ? 'visible' : 'hidden',
          }}
        >
          {/* A GTK menu too tall for the monitor scrolls while the pointer
              rests on an end arrow — it shows no scrollbar. The arrow itself is
              the app's own chevron, the same one the tree twisty and the
              submenu marker draw, rotated: a solid triangle would be a
              different weight from every other arrow in the app. */}
          {ends.up && (
            <div
              className="ze-submenu-arrow up"
              onMouseEnter={() => setOver('up')}
              onMouseLeave={() => setOver(null)}
            >
              <span className="twisty expandable" />
            </div>
          )}
          {/* Opted out of the overlay indicator: GTK gives a menu scroll
              arrows and never a scrollbar, so the one scroll container in the
              app that must NOT grow a bar is this one. */}
          <div className="ze-submenu-scroll" data-ze-no-overlay-scroll onScroll={syncEnds}>
            {sub!.map((s, i) => (
              <MenuEntry key={s.label ?? `s${i}`} item={s} close={close} />
            ))}
          </div>
          {ends.down && (
            <div
              className="ze-submenu-arrow down"
              onMouseEnter={() => setOver('down')}
              onMouseLeave={() => setOver(null)}
            >
              <span className="twisty expandable" />
            </div>
          )}
        </div>
      )}
    </div>
  );
}

/** A cursor-positioned popup (KiCad's TOOL_MENU shown on right-click): the
 *  same rows and styling as the menu-bar dropdowns, kept on-screen near the
 *  viewport edges, closed by an outside click or Escape. */
export function ContextMenu({
  items,
  x,
  y,
  onClose,
}: {
  items: MenuItem[];
  x: number;
  y: number;
  onClose: () => void;
}): JSX.Element {
  const ref = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState({ left: x, top: y });

  // A popped-up wxMenu grabs the keyboard, so Escape dismisses the menu before
  // the dialog under it ever sees the key. That is the modal stack's rule -
  // last mounted wins - so the menu registers there rather than running its own
  // listener beside it, which would have closed both at once. It also keeps
  // Escape off the editor's hotkey handler, which would clear the selection.
  useModalEscape(onClose);

  useEffect(() => {
    const onDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) onClose();
    };
    const onKey = (e: KeyboardEvent) => {
      // The `\tA` half of an ACTION_MENU label is a live key while the menu is
      // up, not decoration: KiCad's disambiguation menu is worked by typing the
      // row number. Only single-character hints qualify — "Ctrl+S" is a hint
      // about a global hotkey, and swallowing it here would break it.
      if (e.key.length !== 1 || e.ctrlKey || e.metaKey || e.altKey) return;
      const hit = items.find(
        (it) => !it.sep && !it.disabled && it.shortcut?.length === 1 && sameKey(it.shortcut, e.key),
      );
      if (!hit) return;
      e.preventDefault();
      e.stopPropagation();
      onClose();
      hit.action?.();
    };
    window.addEventListener('mousedown', onDown);
    window.addEventListener('keydown', onKey, true);
    return () => {
      window.removeEventListener('mousedown', onDown);
      window.removeEventListener('keydown', onKey, true);
    };
  }, [onClose, items]);

  // Whether this menu is taller than the screen. It is not styled as scrollable
  // unconditionally: a scroll container clips its overflow on *both* axes, and
  // the flyout submenus hang off the right edge, so a menu that fits must stay
  // unclipped or Grouping and Zoom would lose their submenus.
  const [tooTall, setTooTall] = useState(false);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    setTooTall(r.height > window.innerHeight - 8);
    setPos({
      left: Math.min(x, Math.max(4, window.innerWidth - r.width - 4)),
      top: Math.min(y, Math.max(4, window.innerHeight - r.height - 4)),
    });
  }, [x, y]);

  return (
    <div
      ref={ref}
      className="ze-dropdown ze-context"
      style={{
        position: 'fixed',
        left: pos.left,
        top: pos.top,
        zIndex: 1000,
        // A menu taller than the screen used to be clamped to top: 4 and then
        // simply run off the bottom, with everything past the edge unreachable
        // — and the selection menu over a symbol is 28 entries, which is taller
        // than a 1200px screen. wx scrolls a menu that does not fit; so do we.
        ...(tooTall ? { maxHeight: 'calc(100vh - 8px)', overflowY: 'auto' as const } : {}),
      }}
      onContextMenu={(e) => e.preventDefault()}
    >
      {items.map((it, i) => (
        <MenuEntry key={it.label ?? `s${i}`} item={it} close={onClose} />
      ))}
    </div>
  );
}

/** A KiCad-style menu bar with click-to-open dropdowns and hover-to-switch. */
export function MenuBar({
  menus,
  leftSlot,
  rightSlot,
  title,
}: {
  menus: Menu[];
  leftSlot?: ReactNode;
  rightSlot?: ReactNode;
  /** KiCad-style "<project>, <Editor>" shown in the bar (window-title info). */
  title?: ReactNode;
}): JSX.Element {
  const [open, setOpen] = useState<string | null>(null);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(null);
    };
    window.addEventListener('mousedown', onDown);
    return () => window.removeEventListener('mousedown', onDown);
  }, [open]);

  return (
    <div className="ze-framechrome">
      {/* The WM title bar. Upstream this is not drawn by the application at all:
          `SetTitle()` hands the string to the window manager, which paints it
          above the menu bar in "Cantarell Bold 11". A browser tab has no WM
          title bar — that carrier is browser-forced — but the row it lives in
          is not, and putting it inside the menu bar (a row KiCad has no title
          in) is what forced it down to 8pt. The home link rides here too: it
          has no KiCad counterpart, and the title bar is where a window-level
          control belongs. */}
      {(title || leftSlot) && (
        <div className="ze-titlebar">
          {leftSlot}
          {title && <div className="ze-titlebar-title">{title}</div>}
        </div>
      )}
      <div className="ze-menubar" ref={ref}>
        {menus.map((menu) => (
          <div
            key={menu.label}
            className={`ze-menu${open === menu.label ? ' open' : ''}`}
            onClick={() => setOpen((o) => (o === menu.label ? null : menu.label))}
            onMouseEnter={() => open && setOpen(menu.label)}
          >
            {menu.label}
            {open === menu.label && (
              <div className="ze-dropdown" onClick={(e) => e.stopPropagation()}>
                {menu.items.map((it, i) => (
                  <MenuEntry key={it.label ?? `s${i}`} item={it} close={() => setOpen(null)} />
                ))}
              </div>
            )}
          </div>
        ))}
        {rightSlot}
      </div>
    </div>
  );
}

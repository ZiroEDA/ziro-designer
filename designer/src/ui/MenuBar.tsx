// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
import { useEffect, useRef, useState, type JSX, type ReactNode } from 'react';
import { toolbarIconUrl } from './toolbarIcons.js';

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
  if (item.sep) return <div className="ze-msep" />;
  const sub = item.submenu ?? item.items;
  const hasSub = !!sub && sub.length > 0;
  return (
    <div
      className={`ze-mitem${item.disabled ? ' disabled' : ''}${hasSub ? ' has-sub' : ''}`}
      style={hasSub ? { position: 'relative' } : undefined}
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
      <span className="mico">
        {item.checked ? (
          <span className="mcheck">✓</span>
        ) : item.icon && toolbarIconUrl(item.icon) ? (
          <img src={toolbarIconUrl(item.icon)} alt="" />
        ) : null}
      </span>
      <span className="lbl">{withMnemonic(item.label, item.mnemonic)}</span>
      {item.shortcut && <span className="sc">{item.shortcut}</span>}
      {/* The same drawn chevron the project tree's twisty uses, rather than a
          glyph: a solid ▸ is a different weight from every other expander in
          the app, and its size is at the mercy of whichever font has it. */}
      {hasSub && <span className="twisty expandable sub-arrow" />}
      {hasSub && subOpen && !item.disabled && (
        <div
          className="ze-dropdown ze-submenu"
          style={{ position: 'absolute', left: '100%', top: -4 }}
        >
          {sub!.map((s, i) => (
            <MenuEntry key={s.label ?? `s${i}`} item={s} close={close} />
          ))}
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
    <div className="ze-menubar" ref={ref}>
      {leftSlot}
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
      {title && <div className="ze-menubar-title">{title}</div>}
      {rightSlot}
    </div>
  );
}

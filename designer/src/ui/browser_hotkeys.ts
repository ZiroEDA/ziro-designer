// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * Stop the browser acting on a key this app has already bound.
 *
 * A desktop KiCad owns its accelerator table outright: `ACTIONS::open` takes
 * Ctrl+O and nothing else in the process wants it. A tab does not. Chrome binds
 * Ctrl+O to its own file picker, Ctrl+P to print, Ctrl+F and Ctrl+G to the find
 * bar, Ctrl+D to bookmark, and unless the page says otherwise those run
 * *alongside* whatever the page does - so pressing Ctrl+G in the project
 * manager opened Chrome's find-next while the Gerber Viewer did or did not
 * open, depending on whether anything here had bound it.
 *
 * `preventDefault()` on a keydown suppresses the browser's action for every
 * shortcut it is willing to yield, which is most of them. This installs one
 * capture-phase listener that does that for exactly the combos the app claims,
 * and nothing else - a page that swallowed every Ctrl chord would break
 * bookmarking, zooming and view-source for no reason.
 *
 * ## The ones no page can have
 *
 * A handful are reserved by the browser and cannot be intercepted from a normal
 * tab at all: the keydown is either not delivered or `preventDefault()` is
 * ignored on it. They are the ones that create or destroy browsing contexts -
 * Ctrl+N, Ctrl+T, Ctrl+W and their Shift variants, Ctrl+Q, and the Ctrl+Tab
 * pair. This is deliberate on the browser's part: a page that could swallow
 * Ctrl+W could refuse to be closed.
 *
 * That matters here because **Ctrl+N is `ACTIONS::newProject`**. In a tab, both
 * things happen: the New Project dialog opens and Chrome opens a new window.
 * There is no page-side fix. {@link BROWSER_RESERVED} names them so the rest of
 * the app can say so rather than appear broken, and so this module does not
 * waste a `preventDefault()` that will be ignored.
 *
 * ## The one way to get them anyway
 *
 * The Keyboard Lock API (`navigator.keyboard.lock()`) does capture them, and is
 * the mechanism browsers offer for exactly this case. It is Chromium-only and
 * it only holds **while the document is fullscreen**, which is the trade: the
 * app can have Ctrl+N and Ctrl+W when it is the whole screen and the user can
 * always leave with Esc. {@link lockReservedKeys} engages it; nothing calls it
 * automatically, because silently taking Ctrl+W from someone who did not ask is
 * the behaviour the reservation exists to prevent.
 */
import { comboFromEvent, type KeyLike } from '../editors/schematic/hotkey_bindings.js';

/**
 * Combos a page cannot take, whatever it does.
 *
 * Chromium's `IsReservedCommandOrKey`, and the equivalent in the other engines:
 * anything that opens or closes a window or a tab, plus tab cycling. Firefox
 * and Safari reserve the same set with minor differences, so this is the union
 * rather than one browser's list.
 */
export const BROWSER_RESERVED: readonly string[] = [
  'Ctrl+N',
  'Ctrl+Shift+N',
  'Ctrl+T',
  'Ctrl+Shift+T',
  'Ctrl+W',
  'Ctrl+Shift+W',
  'Ctrl+Q',
  'Ctrl+Tab',
  'Ctrl+Shift+Tab',
];

const RESERVED = new Set(BROWSER_RESERVED.map((c) => c.toLowerCase()));

/** Whether a combo is one the browser keeps for itself. */
export const isBrowserReserved = (combo: string): boolean => RESERVED.has(combo.toLowerCase());

/**
 * The bit of an event target that decides whether the user is typing into it.
 *
 * Structural rather than `HTMLElement` so the rule can be exercised without a
 * DOM - this workspace's tests run in node, and a rule about which fields keep
 * their keys is worth testing whether or not a browser is present.
 */
export interface FocusLike {
  tagName?: string;
  isContentEditable?: boolean;
  type?: string;
}

/** Input types that are not somewhere you type, so a hotkey still works. */
const NON_TEXT_INPUTS = [
  'checkbox',
  'radio',
  'button',
  'submit',
  'reset',
  'range',
  'color',
  'file',
];

/**
 * Whether the event is going to somewhere the user is typing.
 *
 * Ctrl+C, Ctrl+X, Ctrl+V, Ctrl+A and Ctrl+Z are all combos this app binds
 * somewhere, and all of them are also how a text field works. Claiming them
 * while a field has focus would break copying out of a project name box to fix
 * a shortcut nobody pressed. This is the one place the port deliberately parts
 * with wx, whose accelerator table fires regardless of focus - a browser user
 * expects the field to win, and the project manager's own Edit menu greys out
 * cut/copy/paste for exactly this reason.
 */
export function isTypingTarget(target: FocusLike | null | undefined): boolean {
  if (!target) return false;
  if (target.isContentEditable) return true;
  const tag = target.tagName;
  if (tag === 'TEXTAREA' || tag === 'SELECT') return true;
  if (tag !== 'INPUT') return false;
  return !NON_TEXT_INPUTS.includes(target.type ?? 'text');
}

/** What the page took, and what it could not, for anything that wants to report it. */
export interface ClaimResult {
  /** Combos this listener will suppress the browser's action for. */
  claimed: string[];
  /** Combos the app binds that the browser will not give up. */
  reserved: string[];
}

/**
 * Work out which of `combos` the page can take, without touching anything.
 *
 * Split from the listener so the rule is exercisable in a workspace whose
 * tests run in node: what a page may claim is a fact about browsers, not about
 * whether one happens to be running.
 */
export function planClaim(combos: Iterable<string>): ClaimResult & { lookup: ReadonlySet<string> } {
  const claimed = new Set<string>();
  const reserved: string[] = [];

  for (const combo of combos) {
    if (combo === '') continue;
    // A gesture, not a keystroke - "Ctrl+Click", "Shift+Wheel", "Double-click".
    if (/click|wheel|drag/i.test(combo)) continue;
    if (isBrowserReserved(combo)) reserved.push(combo);
    else claimed.add(combo.toLowerCase());
  }

  return { claimed: [...claimed], reserved: [...new Set(reserved)], lookup: claimed };
}

/**
 * Suppress the browser's own action for each of `combos`.
 *
 * Capture phase, so the decision is made before any of the app's own handlers
 * run and cannot be skipped by one of them calling `stopPropagation` first.
 * Only `preventDefault` is called - the event still reaches the app, because
 * this module's job is to stop the *browser*, not to dispatch anything.
 *
 * Returns the split of what it took, and a function to remove the listener.
 * Safe to call with no `window`, where it plans and installs nothing.
 */
export function claimBrowserHotkeys(
  combos: Iterable<string>,
): ClaimResult & { release: () => void } {
  const plan = planClaim(combos);

  if (typeof window === 'undefined') {
    return { claimed: plan.claimed, reserved: plan.reserved, release: () => undefined };
  }

  const onKey = (e: KeyboardEvent): void => {
    if (isTypingTarget(e.target as FocusLike | null)) return;
    if (!plan.lookup.has(comboFromEvent(e as unknown as KeyLike).toLowerCase())) return;
    // Not stopPropagation: the app's handlers still need to see it.
    e.preventDefault();
  };

  window.addEventListener('keydown', onKey, true);

  return {
    claimed: plan.claimed,
    reserved: plan.reserved,
    release: () => window.removeEventListener('keydown', onKey, true),
  };
}

/** Whether this browser offers the Keyboard Lock API at all. */
export const keyboardLockAvailable = (): boolean =>
  typeof navigator !== 'undefined' && 'keyboard' in navigator;

interface KeyboardLockAPI {
  lock: (keyCodes?: string[]) => Promise<void>;
  unlock: () => void;
}

const keyboardAPI = (): KeyboardLockAPI | undefined =>
  (navigator as unknown as { keyboard?: KeyboardLockAPI }).keyboard;

/**
 * Take the reserved combos, by going fullscreen and locking the keyboard.
 *
 * `navigator.keyboard.lock()` only holds while the document is fullscreen, so
 * this requests fullscreen first; leaving fullscreen releases the lock on the
 * browser's own initiative. Both steps need a user gesture, so call this from a
 * click.
 *
 * Resolves to whether the lock is now held. `false` covers every failure the
 * caller cannot do anything about - Firefox and Safari have no such API, and
 * the fullscreen request can be refused - and none of them are errors worth
 * throwing over.
 */
export async function lockReservedKeys(): Promise<boolean> {
  const keyboard = keyboardAPI();
  if (!keyboard) return false;

  try {
    if (!document.fullscreenElement) await document.documentElement.requestFullscreen();
    // The codes, not the combos: lock() speaks KeyboardEvent.code.
    await keyboard.lock(['KeyN', 'KeyT', 'KeyW', 'KeyQ', 'Tab']);
    return true;
  } catch {
    return false;
  }
}

/** Give the reserved combos back. Leaving fullscreen does this anyway. */
export function unlockReservedKeys(): void {
  keyboardAPI()?.unlock();
}

/**
 * Hold the lock for as long as the app is fullscreen, however it got there.
 *
 * The lock is only permitted while the document is fullscreen, so the two
 * states may as well be the same state: anything that puts the app fullscreen
 * gets Ctrl+N and Ctrl+W with it, and leaving gives them straight back. That
 * keeps the bargain the reservation exists to protect - the keys are only ever
 * taken while the app fills the screen and Esc is the documented way out.
 *
 * Note this is the Fullscreen *API*, not the browser's own F11: pressing F11
 * does not set `document.fullscreenElement`, so it does not engage this. The
 * app has to ask.
 *
 * Returns a function that stops watching and releases.
 */
export function lockReservedKeysWhileFullscreen(): () => void {
  if (typeof document === 'undefined' || !keyboardAPI()) return () => undefined;

  const onChange = (): void => {
    if (document.fullscreenElement) {
      // lock() speaks KeyboardEvent.code, not our combo spelling.
      void keyboardAPI()
        ?.lock(['KeyN', 'KeyT', 'KeyW', 'KeyQ', 'Tab'])
        .catch(() => undefined);
    } else {
      unlockReservedKeys();
    }
  };

  document.addEventListener('fullscreenchange', onChange);
  onChange();

  return () => {
    document.removeEventListener('fullscreenchange', onChange);
    unlockReservedKeys();
  };
}

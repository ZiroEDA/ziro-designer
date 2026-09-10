// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
/**
 * The support chat, embedded from another origin on purpose.
 *
 * ### Why an iframe and not the vendor's script
 *
 * The marketing site loads Crisp's `l.js` directly, which is fine on a page
 * that holds nothing. This app is not that page: the sign-in screen has the
 * account password in a field, and once signed in the master key that decrypts
 * every project is in memory (`cloud/crypto.ts`, `docs/encryption-design.md`).
 * A third-party script in THIS origin can read both — not because the vendor is
 * hostile, but because a bad release or a compromised CDN would be enough, and
 * "we ship the JavaScript" is the one real limit of browser-side end-to-end
 * encryption. Shipping someone else's script beside the password field would
 * quietly undo the guarantee the product is being built on.
 *
 * Loading the same widget from `ziroeda.com` inside an iframe keeps the chat
 * exactly as usable and puts the vendor's code in a different origin, where the
 * same-origin policy stops it reading this page. That is enforced by the
 * browser rather than promised by us.
 *
 * ### What crosses the boundary
 *
 * Only what support actually needs to triage, and never the user's work:
 *
 *   - `screen`  — which frame they were on (`pcb`, `signup`, ...), so a report
 *                 arrives with context instead of "it broke".
 *   - `email`   — once signed in, so nobody has to ask "which account?".
 *   - `version` — the build.
 *
 * **Not the project uid or its name.** We are about to tell people we cannot
 * read their designs; sending identifiers for those designs to a chat vendor
 * cuts against that, and the frame name is enough to triage.
 *
 * ### Why the frame is the whole viewport
 *
 * Crisp lays out for a phone — full-bleed panel, no corners, no close button —
 * in any window narrower than a desktop one, and refuses to load at all under
 * 280px. Two smaller frames were tried and both looked wrong. So the frame is
 * the viewport, Crisp renders exactly as on the site, and a `clip-path` keeps
 * only the bubble (or, open, the panel) clickable: pointer events are not
 * dispatched outside an element's clip, so the app underneath keeps working.
 *
 * ### Dragging
 *
 * The bubble can be put anywhere. Clicks on it land in the other origin, so a
 * transparent handle of ours sits over it: a drag moves the whole frame (the
 * bubble and, with it, where the panel opens), a plain click asks the frame to
 * toggle the chat. The bubble may be pushed off any edge until only a sliver
 * is left to grab it back by. Opening clamps the frame so the panel stays on
 * screen wherever the bubble is; closing puts it back. The position is kept
 * in localStorage, like every other preference.
 */
import { useCallback, useEffect, useRef, useState, type JSX, type PointerEvent } from 'react';
import { useAuth } from '../auth/AuthProvider.js';
import type { Route } from '../nav/route.js';
import { useRoute } from '../nav/useRoute.js';

/**
 * Where the widget page is served from. Unset — a self-hosted build, or a dev
 * server without it — renders no widget at all rather than a broken frame.
 */
const WIDGET_URL: string | undefined = import.meta.env.VITE_CHAT_WIDGET_URL;

/** The build, for the data panel beside the conversation. */
const VERSION: string = import.meta.env.VITE_APP_VERSION ?? 'dev';

const POS_KEY = 'ziro.chat.pos';

/**
 * Crisp's geometry inside the frame, all [data] from the widget as it renders
 * on the site, sampled off a 1905x1200 window: its default launcher, 24px in
 * from the right and 20px up from the bottom. (The site's own CSS asks for
 * 34px; that selector matches nothing, and the bubble sits at the default.)
 * The handle and the clip in shell.css assume the same numbers; if Crisp's
 * launcher changes, they change together.
 */
const BUBBLE = 54; // launcher diameter
const INSET_X = 24; // launcher inset from the frame's right edge
const INSET_Y = 20; // launcher inset from the frame's bottom edge
const PANEL_W = 460; // the open panel with its margins, from the right edge
const PANEL_H = 860; // the open panel plus the close button under it, from the bottom

/** How much of the bubble must stay on screen, so it can be pulled back. */
const PEEK = 12;

/** A drag shorter than this is a click. */
const CLICK_SLOP = 4;

/** The frame the user is looking at. Deliberately never the project itself. */
function screenName(route: Route): string {
  switch (route.kind) {
    case 'auth':
      return route.step;
    case 'project':
      return route.view;
    case 'tool':
      return route.tool;
    case 'demo':
      return 'demo';
    default:
      return 'home';
  }
}

type Pos = { x: number; y: number };

function loadPos(): Pos {
  try {
    const raw = localStorage.getItem(POS_KEY);
    if (raw) {
      const p = JSON.parse(raw) as Pos;
      if (Number.isFinite(p.x) && Number.isFinite(p.y)) return p;
    }
  } catch {
    // no storage, or garbage in it: the corner
  }
  return { x: 0, y: 0 };
}

/**
 * Keep PEEK of the bubble on screen on every side. At translate 0 the bubble
 * spans [w - INSET_X - BUBBLE, w - INSET_X]; it may leave by the right until
 * PEEK remains, and by the left likewise.
 */
function clampToViewport(p: Pos, host: HTMLElement | null): Pos {
  const w = host?.clientWidth ?? window.innerWidth;
  const h = host?.clientHeight ?? window.innerHeight;
  return {
    x: Math.min(INSET_X + BUBBLE - PEEK, Math.max(INSET_X + PEEK - w, p.x)),
    y: Math.min(INSET_Y + BUBBLE - PEEK, Math.max(INSET_Y + PEEK - h, p.y)),
  };
}

export function ChatWidget(): JSX.Element | null {
  const { session } = useAuth();
  const { route } = useRoute();
  const frame = useRef<HTMLIFrameElement>(null);
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState<Pos>(loadPos);
  const drag = useRef<{ start: Pos; origin: Pos; moved: boolean } | null>(null);

  const email = session?.user?.email ?? '';
  const screen = screenName(route);

  const origin = WIDGET_URL ? new URL(WIDGET_URL, window.location.href).origin : '';

  // The iframe tells us when the conversation opens and closes, because only
  // it knows; that decides what is clickable and whether the panel must fit.
  useEffect(() => {
    if (!origin) return;
    const onMessage = (e: MessageEvent): void => {
      // The origin check is the whole point of the exercise: without it any
      // frame on the page could drive this one.
      if (e.origin !== origin) return;
      const data = e.data as { type?: string; state?: string } | null;
      if (data?.type !== 'ziro-chat') return;
      setOpen(data.state === 'opened');
    };
    window.addEventListener('message', onMessage);
    return () => window.removeEventListener('message', onMessage);
  }, [origin]);

  // Identify on load and whenever the account or the frame changes, so a
  // conversation started five minutes in still says where it started.
  const identify = useCallback(() => {
    if (!origin) return;
    frame.current?.contentWindow?.postMessage(
      { type: 'ziro-chat-identify', email, screen, version: VERSION },
      origin,
    );
  }, [origin, email, screen]);

  useEffect(identify, [identify]);

  // The address is fixed on first render on purpose. `screen` changes every
  // time the user moves between frames, and a changed src RELOADS the iframe,
  // which would throw away a conversation in progress on the way from the
  // schematic to the board. Later screens travel over postMessage instead.
  const [src] = useState(
    () =>
      `${WIDGET_URL}?source=designer&screen=${encodeURIComponent(screen)}&v=${encodeURIComponent(VERSION)}`,
  );

  const onPointerDown = (e: PointerEvent<HTMLDivElement>): void => {
    if (e.button !== 0) return;
    e.currentTarget.setPointerCapture(e.pointerId);
    drag.current = { start: { x: e.clientX, y: e.clientY }, origin: pos, moved: false };
  };
  const onPointerMove = (e: PointerEvent<HTMLDivElement>): void => {
    const d = drag.current;
    if (!d) return;
    const dx = e.clientX - d.start.x;
    const dy = e.clientY - d.start.y;
    if (!d.moved && Math.hypot(dx, dy) < CLICK_SLOP) return;
    d.moved = true;
    setPos(clampToViewport({ x: d.origin.x + dx, y: d.origin.y + dy }, frame.current));
  };
  const onPointerUp = (e: PointerEvent<HTMLDivElement>): void => {
    const d = drag.current;
    drag.current = null;
    if (!d) return;
    e.currentTarget.releasePointerCapture(e.pointerId);
    if (d.moved) {
      try {
        localStorage.setItem(POS_KEY, JSON.stringify(pos));
      } catch {
        // no storage: the position lasts the session
      }
      return;
    }
    if (origin) frame.current?.contentWindow?.postMessage({ type: 'ziro-chat-toggle' }, origin);
  };

  if (!WIDGET_URL) return null;

  // Open, the panel rises from the bubble; if the bubble was dragged past
  // where the panel fits - up, left, or off an edge - slide the frame just
  // enough that it does.
  let shown = pos;
  if (open) {
    const w = frame.current?.clientWidth ?? window.innerWidth;
    const h = frame.current?.clientHeight ?? window.innerHeight;
    shown = {
      x: Math.min(0, Math.max(pos.x, PANEL_W - w)),
      y: Math.min(0, Math.max(pos.y, PANEL_H - h)),
    };
  }
  const translate = `translate(${shown.x}px, ${shown.y}px)`;

  return (
    <>
      <iframe
        ref={frame}
        title="ZiroEDA support chat"
        src={src}
        onLoad={identify}
        className={`ze-chat-frame${open ? ' open' : ''}`}
        style={{ transform: translate }}
        // Only what the widget needs: scripts and its own storage to run at all,
        // popups for the links it shows, forms for the message box. Nothing else
        // -- a frame from another origin is given nothing it does not need.
        sandbox="allow-scripts allow-same-origin allow-popups allow-forms"
      />
      {/* Over the bubble, in the app's origin, so it can be dragged and its
          click can be seen. Hidden while the panel is open: Crisp's close
          button is there then, and it must get the click. */}
      {!open && (
        <div
          className="ze-chat-handle"
          style={{ transform: translate }}
          title="Chat with us (drag to move)"
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
          onPointerCancel={() => {
            drag.current = null;
          }}
        />
      )}
    </>
  );
}

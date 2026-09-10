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
 * ### Why the collapsed frame is wider than the bubble
 *
 * Crisp's loader refuses to run in a window narrower than 280px (`l.js`,
 * `this.m=280`), so an iframe the size of a bubble never gets a chatbox at all
 * — that is how the first version shipped with nothing visible. So the frame
 * stays 300px wide even when only the bubble shows, and a `clip-path` circle
 * around the bubble makes the rest of it click-through: pointer events are not
 * dispatched outside an element's clip. Crisp draws everything — its launcher,
 * its panel, its close button, its unread badge — exactly as on the site. The
 * frame only reports opened / closed so this side can size it.
 */
import { useCallback, useEffect, useRef, useState, type JSX } from 'react';
import { useAuth } from '../auth/AuthProvider.js';
import { useRoute } from '../nav/useRoute.js';
import type { Route } from '../nav/route.js';

/**
 * Where the widget page is served from. Unset — a self-hosted build, or a dev
 * server without it — renders no widget at all rather than a broken frame.
 */
const WIDGET_URL: string | undefined = import.meta.env.VITE_CHAT_WIDGET_URL;

/** The build, for the data panel beside the conversation. */
const VERSION: string = import.meta.env.VITE_APP_VERSION ?? 'dev';

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

export function ChatWidget(): JSX.Element | null {
  const { session } = useAuth();
  const { route } = useRoute();
  const frame = useRef<HTMLIFrameElement>(null);
  const [open, setOpen] = useState(false);

  const email = session?.user?.email ?? '';
  const screen = screenName(route);

  const origin = WIDGET_URL ? new URL(WIDGET_URL, window.location.href).origin : '';

  // The iframe tells us when the conversation opens, because only it knows —
  // and it cannot resize itself.
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

  if (!WIDGET_URL) return null;

  return (
    <iframe
      ref={frame}
      title="ZiroEDA support chat"
      src={src}
      onLoad={identify}
      className={`ze-chat-frame${open ? ' open' : ''}`}
      // Only what the widget needs: scripts and its own storage to run at all,
      // popups for the links it shows, forms for the message box. Nothing else
      // -- a frame from another origin is given nothing it does not need.
      sandbox="allow-scripts allow-same-origin allow-popups allow-forms"
    />
  );
}

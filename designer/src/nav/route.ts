// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * What the address bar says, as data.
 *
 * The app had no addresses at all: every page was the bare domain, and which
 * project was open and which editor you were in lived only in the page's
 * memory. So a refresh could not put you back (it restored the *view* and then
 * opened whichever project was top of Recent), two tabs could not hold two
 * projects, Back left the app, and nothing could be linked to -- which is why
 * sharing had to invent `?p=` and carry it across a sign-in by hand.
 *
 * ### Why the path and not the fragment
 *
 * `#/p/<uid>` is what EasyEDA Pro does and it needs no server support, which is
 * a real advantage. It is not available to us: `detectSessionInUrl` reads the
 * auth fragment on load and then rewrites the address bar -- the bare `#` left
 * behind after signing in is that -- so a route kept there sits in territory
 * the auth client owns and clears.
 *
 * The path costs one rewrite rule on the host (`vercel.json`), without which
 * every deep link is a request for a file that does not exist.
 *
 * ### Why this file is pure
 *
 * No DOM, and deliberately **no `import.meta.env`**: reaching for it is exactly
 * what makes a module unreachable from `qa`'s typecheck, which is the boundary
 * `cloud/supabaseBackend.ts` documents and works around. The base path is
 * passed in by the caller, which is DOM-bound anyway. The shape is the one
 * `cloud/invites.ts` uses -- a pure parser plus a thin caller -- so the half
 * with decisions in it is testable.
 */

/** Which frame a project is open in. `manager` is the project window itself. */
export type ProjectView = 'manager' | 'schematic' | 'pcb' | 'symbols' | 'footprints';

/** The standalone tools, which need no project. */
export type ToolName = 'calculator' | 'image-converter' | 'gerber' | 'drawing-sheet';

export type Route =
  | { kind: 'home' }
  | {
      kind: 'project';
      /**
       * `projects.uid` -- the one identity. Not the local IndexedDB id: that is
       * a name for a file in one browser, while this means the same project in
       * every account, which is what a link has to survive. Every project has
       * one from the moment it is created (`projectStore.newCloudUid`), so this
       * works signed out and before a first push.
       */
      uid: string;
      view: ProjectView;
      /** A project-relative file to open in that frame, KiCad's MAIL_* target. */
      file?: string;
    }
  | { kind: 'demo'; id: string }
  | { kind: 'tool'; tool: ToolName };

/** The frame names as they appear in a path, and the view each one means. */
const VIEW_SEGMENTS: Record<string, ProjectView> = {
  schematic: 'schematic',
  pcb: 'pcb',
  symbols: 'symbols',
  footprints: 'footprints',
};

const TOOL_SEGMENTS: Record<string, ToolName> = {
  calculator: 'calculator',
  'image-converter': 'image-converter',
  gerber: 'gerber',
  'drawing-sheet': 'drawing-sheet',
};

const SEGMENT_FOR_VIEW: Record<ProjectView, string> = {
  manager: '',
  schematic: 'schematic',
  pcb: 'pcb',
  symbols: 'symbols',
  footprints: 'footprints',
};

/** A project uid, shape-checked the way `cloud/invites.ts` checks one. */
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * A demo id, as `designer/public/demos/index.json` writes them -- short slugs
 * like `ecc83`. Checked rather than trusted: it goes into a URL for a fetch.
 */
const DEMO_ID = /^[a-z0-9][a-z0-9._-]{0,63}$/i;

/**
 * The query parameters the router owns, and therefore the ones `routeHref`
 * writes rather than carries.
 *
 * `f` is the route's own. `p` is the share link this replaces, kept working but
 * never re-emitted. `join` is an invitation token, which `cloud/invites.ts`
 * strips from the address on purpose -- carrying it forward would put a secret
 * back into every URL the app writes.
 */
const OWNED_PARAMS = ['p', 'f', 'join'];

export const HOME: Route = { kind: 'home' };

/** Strip the app's base path, so a deploy under a subpath parses the same. */
function withoutBase(pathname: string, base: string): string {
  const b = base.endsWith('/') ? base.slice(0, -1) : base;
  if (b && b !== '/' && pathname.startsWith(b)) return pathname.slice(b.length) || '/';
  return pathname;
}

/**
 * The route an address names.
 *
 * Anything unrecognised is `home` rather than an error: an address is user
 * input, it arrives from bookmarks and chat messages and typos, and the app
 * still has to start. A wrong path should land you on the home screen, not on a
 * blank page.
 */
export function parseRoute(href: string, base = '/'): Route {
  let url: URL;
  try {
    url = new URL(href);
  } catch {
    return HOME;
  }

  // The share link this replaces. Recognised so that links already sent keep
  // working; `routeHref` never writes one back.
  const legacy = url.searchParams.get('p');
  if (legacy && UUID.test(legacy)) return { kind: 'project', uid: legacy, view: 'manager' };

  const parts = withoutBase(url.pathname, base).split('/').filter(Boolean);
  if (parts.length === 0) return HOME;

  const [head, second, third] = parts;

  if (head === 'p') {
    if (!second || !UUID.test(second)) return HOME;
    const view = third === undefined ? 'manager' : VIEW_SEGMENTS[third];
    if (!view) return HOME;
    const file = url.searchParams.get('f');
    return { kind: 'project', uid: second, view, ...(file ? { file } : {}) };
  }

  if (head === 'demo') {
    return second && DEMO_ID.test(second) ? { kind: 'demo', id: second } : HOME;
  }

  const tool = TOOL_SEGMENTS[head!];
  return tool ? { kind: 'tool', tool } : HOME;
}

/**
 * The address for a route.
 *
 * `carry` is the search string the app is currently on, and everything in it
 * that the router does not own comes along: `?perf=1` is read by
 * `SchematicCanvas` and `GerberCanvas`, and losing it on the first navigation
 * would break the perf overlay in a way that looks like the overlay's fault.
 */
export function routeHref(route: Route, base = '/', carry = ''): string {
  const b = base.endsWith('/') ? base : `${base}/`;
  const params = new URLSearchParams(carry);
  for (const p of OWNED_PARAMS) params.delete(p);

  let path = '';
  if (route.kind === 'project') {
    const seg = SEGMENT_FOR_VIEW[route.view];
    path = seg ? `p/${route.uid}/${seg}` : `p/${route.uid}`;
    if (route.file) params.set('f', route.file);
  } else if (route.kind === 'demo') {
    path = `demo/${route.id}`;
  } else if (route.kind === 'tool') {
    path = route.tool;
  }

  const query = params.toString();
  return `${b}${path}${query ? `?${query}` : ''}`;
}

/**
 * Whether two routes name the same thing.
 *
 * Used to decide whether a navigation is worth a history entry at all -- React
 * re-renders far more often than the address changes, and pushing the address
 * you are already on fills the Back button with duplicates of one page.
 */
export function sameRoute(a: Route, b: Route): boolean {
  if (a.kind !== b.kind) return false;
  if (a.kind === 'project' && b.kind === 'project') {
    return a.uid === b.uid && a.view === b.view && (a.file ?? '') === (b.file ?? '');
  }
  if (a.kind === 'demo' && b.kind === 'demo') return a.id === b.id;
  if (a.kind === 'tool' && b.kind === 'tool') return a.tool === b.tool;
  return true;
}

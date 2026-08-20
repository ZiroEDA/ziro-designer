// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * Paths in the account's own tree.
 *
 * The file chooser's breadcrumb is one button per ancestor, so a path has to
 * split and rejoin without surprises. These are the POSIX rules `wxFileName`
 * follows on Linux, narrowed to what this tree can actually contain: one root,
 * forward slashes, no drive letters, no `..` traversal.
 *
 * `..` is rejected rather than resolved on purpose. Upstream a file dialog sits
 * over a real filesystem where `..` is meaningful and bounded by permissions;
 * here it is a way to address someone else's space, so a path containing one is
 * not a path we normalise — it is a path we refuse.
 */

/** The root of the user's own tree. Every path starts here. */
export const ROOT = '/';

/**
 * The parts of a path, root excluded — `/a/b` is `['a', 'b']`, `/` is `[]`.
 *
 * Empty segments are dropped, so `//a//b/` reads as `['a','b']`: a trailing
 * slash means the same folder, and a doubled one is a typo rather than an
 * empty-named child.
 */
export function segments(path: string): string[] {
  return path.split('/').filter((s) => s.length > 0);
}

/** `['a','b']` back to `/a/b`, and `[]` back to `/`. */
export function fromSegments(parts: readonly string[]): string {
  const kept = parts.filter((s) => s.length > 0);
  return kept.length === 0 ? ROOT : `/${kept.join('/')}`;
}

/** A path with its redundancy removed: `//a//b/` becomes `/a/b`. */
export function normalize(path: string): string {
  return fromSegments(segments(path));
}

/** The last part of a path — the file or folder's own name. `/` has none. */
export function basename(path: string): string {
  return segments(path).at(-1) ?? '';
}

/** The folder containing a path. The root contains itself. */
export function dirname(path: string): string {
  return fromSegments(segments(path).slice(0, -1));
}

/**
 * A child of a folder.
 *
 * This cannot enforce that `name` is one part — `join('/a', 'b/c')` and
 * `join('/a/b', 'c')` are the same string, and no path syntax distinguishes
 * them. Callers taking a name from the user validate it with
 * {@link isValidName} first; that is where a smuggled separator is caught.
 */
export function join(dir: string, name: string): string {
  return fromSegments([...segments(dir), name]);
}

/**
 * Whether `path` is `parent` or sits beneath it.
 *
 * Segment-wise rather than by string prefix, because `/abc` starts with `/ab`
 * as text and is not inside it.
 */
export function isWithin(parent: string, path: string): boolean {
  const p = segments(parent);
  const c = segments(path);
  return p.length <= c.length && p.every((s, i) => c[i] === s);
}

/**
 * The ancestors of a path, root first, ending with the path itself — what the
 * breadcrumb draws a button for.
 *
 * `/a/b` gives `/`, `/a`, `/a/b`.
 */
export function ancestors(path: string): string[] {
  const parts = segments(path);
  const out = [ROOT];
  for (let i = 1; i <= parts.length; i++) out.push(fromSegments(parts.slice(0, i)));
  return out;
}

/**
 * Whether a name may be given to a file or folder.
 *
 * Deliberately stricter than a filesystem, because this one is synced and
 * addressed by name rather than by inode:
 *
 *  - empty, `.` and `..` are not names;
 *  - `/` cannot appear, since that is what separates names;
 *  - control characters cannot, since they do not survive a round trip through
 *    a URL or a header and would make a file unfetchable rather than merely
 *    ugly;
 *  - leading and trailing whitespace is refused rather than trimmed, so that
 *    two files cannot differ by something invisible.
 */
export function isValidName(name: string): boolean {
  if (name.length === 0 || name === '.' || name === '..') return false;
  if (name.includes('/')) return false;
  // biome-ignore lint/suspicious/noControlCharactersInRegex: refusing them is the point
  if (/[\u0000-\u001f\u007f]/.test(name)) return false;
  return name.trim() === name;
}

/**
 * Whether a path is one we will act on.
 *
 * Absolute, and no part of it a traversal. See the note at the top for why `..`
 * is refused rather than resolved.
 */
export function isValidPath(path: string): boolean {
  if (!path.startsWith('/')) return false;
  return segments(path).every(isValidName);
}

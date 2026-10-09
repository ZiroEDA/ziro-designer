// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
/**
 * A GitHub project's id and address (#640), apart from the fetch in
 * github_source.ts so the router can parse `/gh/...` without importing it.
 */

/** Which repository, and optionally which ref and which folder or project in it. */
export interface GithubSpec {
  owner: string;
  repo: string;
  /** A branch, tag or commit. One path segment; absent is the default branch. */
  ref?: string;
  /** A folder, or a `.kicad_pro`, inside the repository. */
  path?: string;
}

/** GitHub's own rules for the two names, close enough to refuse nonsense. */
const NAME = /^[A-Za-z0-9_.-]{1,100}$/;
const REF = /^[A-Za-z0-9_.\-]{1,250}$/;

/** The app's id for a GitHub project: the address path, without the leading slash. */
export function githubIdFor(spec: GithubSpec): string {
  let id = `gh/${spec.owner}/${spec.repo}`;
  if (spec.ref || spec.path) id += `/tree/${spec.ref ?? 'HEAD'}`;
  if (spec.path) id += `/${spec.path}`;
  return id;
}

/** Whether a demo id names a GitHub project. */
export const isGithubId = (id: string): boolean => id.startsWith('gh/');

/** The spec an id (or an address path's segments joined) names, or null. */
export function githubSpecFromId(id: string): GithubSpec | null {
  const parts = id.split('/');
  if (parts[0] !== 'gh') return null;
  const [, owner, repo, tree, ref, ...rest] = parts;
  if (!owner || !repo || !NAME.test(owner) || !NAME.test(repo)) return null;
  if (tree === undefined) return { owner, repo };
  if (tree !== 'tree' || !ref || !REF.test(ref)) return null;
  // No `..`, no empty segment: the path is a place in the repository, nothing more.
  if (rest.some((p) => p === '' || p === '.' || p === '..')) return null;
  return { owner, repo, ref, ...(rest.length ? { path: rest.join('/') } : {}) };
}

/**
 * A pasted GitHub link: `https://github.com/<o>/<r>`, `.../tree/<ref>/<path>`,
 * or `.../blob/<ref>/<path>` (a link to the `.kicad_pro` itself). Null for
 * anything else.
 */
export function githubSpecFromUrl(text: string): GithubSpec | null {
  let url: URL;
  try {
    url = new URL(text.trim());
  } catch {
    return null;
  }
  if (url.hostname !== 'github.com' && url.hostname !== 'www.github.com') return null;
  const parts = url.pathname.split('/').filter(Boolean);
  if (parts[3] === undefined && parts[2] === undefined) {
    const repo = parts[1]?.replace(/\.git$/, '');
    return githubSpecFromId(`gh/${parts[0]}/${repo}`);
  }
  if (parts[2] === 'blob') parts[2] = 'tree';
  return githubSpecFromId(['gh', ...parts].join('/'));
}

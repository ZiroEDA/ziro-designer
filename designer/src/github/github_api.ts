// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
/**
 * The few GitHub REST endpoints the project's Git loop needs.
 *
 * KiCad's loop runs libgit2 against a working tree on disk and talks to the
 * remote over git's smart-HTTP protocol (`common/git/libgit_backend.cpp`). A
 * browser can do neither: there is no working tree, and `github.com`'s git
 * endpoints do not answer a page's cross-origin request. `api.github.com` does,
 * and its Git database API (blobs, trees, commits, refs) builds the same
 * objects a `git commit` + `git push` would, one request at a time - so that is
 * the transport here, and the repository on GitHub is the only repository.
 *
 * Every call takes the `fetch` to use. The app passes the GitHub session's,
 * which adds the token and refreshes it (github_auth.ts); a test passes a fake
 * shaped like GitHub's answers. Nothing here sees a token.
 */
import { base64ToBytes, bytesToBase64 } from '../cloud/crypto.js';

export const GITHUB_API = 'https://api.github.com';

/** A `fetch`: the session's (with the token) in the app, a fake in a test. */
export type GithubFetch = (url: string, init?: RequestInit) => Promise<Response>;

/** What GitHub said, in its own words, with the status it said it with. */
export class GithubApiError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

/**
 * GitHub's error body as one line: `message`, then each of `errors[]`, which is
 * where the useful half usually is ("name already exists on this account").
 */
export function githubMessage(body: unknown, status: number): string {
  const b = (body ?? {}) as { message?: unknown; errors?: unknown };
  const head = typeof b.message === 'string' && b.message ? b.message : `HTTP ${status}`;
  const details = Array.isArray(b.errors)
    ? b.errors
        .map((e: unknown) =>
          typeof e === 'string'
            ? e
            : e && typeof e === 'object'
              ? String(
                  (e as { message?: unknown; code?: unknown }).message ??
                    (e as { code?: unknown }).code ??
                    '',
                )
              : '',
        )
        .filter((s) => s !== '')
    : [];
  return details.length > 0 ? `${head} (${details.join('; ')})` : head;
}

const enc = (s: string): string => encodeURIComponent(s);
/** A branch name in a ref path: its slashes are path separators, each part escaped. */
const refPath = (branch: string): string => branch.split('/').map(enc).join('/');
const repoPath = (owner: string, repo: string): string => `/repos/${enc(owner)}/${enc(repo)}`;

async function call<T>(f: GithubFetch, method: string, path: string, body?: unknown): Promise<T> {
  const res = await f(`${GITHUB_API}${path}`, {
    method,
    // GitHub answers reads with `Cache-Control: private, max-age=60`, and the browser obeyed it:
    // a Pull within a minute of reading the branch head said "Already up to date" over a newer
    // commit, and a branch made a moment ago was missing from Switch to Branch (end-to-end test
    // 11-19). Git state is read fresh, every time.
    cache: 'no-store',
    headers: {
      Accept: 'application/vnd.github+json',
      ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  const text = res.status === 204 ? '' : await res.text();
  let json: unknown = {};
  try {
    json = text ? JSON.parse(text) : {};
  } catch {
    json = {};
  }
  if (!res.ok) throw new GithubApiError(res.status, githubMessage(json, res.status));
  return json as T;
}

// --- the account -------------------------------------------------------------

export interface GithubUser {
  login: string;
  name?: string | null;
}

export const getAuthenticatedUser = (f: GithubFetch): Promise<GithubUser> =>
  call<GithubUser>(f, 'GET', '/user');

export interface GithubRepo {
  name: string;
  full_name: string;
  owner: { login: string };
  private: boolean;
  default_branch?: string;
}

/**
 * `POST /user/repos`, empty: `auto_init: false`, so the first commit on it is
 * the project's own and not a README GitHub wrote.
 */
export const createUserRepo = (
  f: GithubFetch,
  name: string,
  isPrivate: boolean,
): Promise<GithubRepo> =>
  call<GithubRepo>(f, 'POST', '/user/repos', { name, private: isPrivate, auto_init: false });

/** At most this many pages of 100: a chooser of more than a thousand rows is not one. */
const MAX_REPO_PAGES = 10;

/**
 * Every repository the account can push to or read, private ones included,
 * most recently pushed first - the order a person looking for "the one I was
 * just working on" wants.
 */
export async function listUserRepos(f: GithubFetch): Promise<GithubRepo[]> {
  const out: GithubRepo[] = [];
  for (let page = 1; page <= MAX_REPO_PAGES; page++) {
    const batch = await call<GithubRepo[]>(
      f,
      'GET',
      `/user/repos?per_page=100&sort=pushed&page=${page}`,
    );
    out.push(...batch);
    if (batch.length < 100) break;
  }
  return out;
}

// --- refs, commits, trees, blobs --------------------------------------------

/** A branch's head commit, or null when there is no such branch (or no commit at all yet). */
export async function getBranchHead(
  f: GithubFetch,
  owner: string,
  repo: string,
  branch: string,
): Promise<string | null> {
  try {
    const ref = await call<{ object: { sha: string } }>(
      f,
      'GET',
      `${repoPath(owner, repo)}/git/ref/heads/${refPath(branch)}`,
    );
    return ref.object.sha;
  } catch (e) {
    // 404: no such branch. 409: "Git Repository is empty".
    if (e instanceof GithubApiError && (e.status === 404 || e.status === 409)) return null;
    throw e;
  }
}

export interface GithubBranch {
  name: string;
  commit: { sha: string };
}

export async function listBranches(
  f: GithubFetch,
  owner: string,
  repo: string,
): Promise<GithubBranch[]> {
  try {
    return await call<GithubBranch[]>(f, 'GET', `${repoPath(owner, repo)}/branches?per_page=100`);
  } catch (e) {
    if (e instanceof GithubApiError && e.status === 409) return [];
    throw e;
  }
}

export interface GithubCommit {
  sha: string;
  tree: { sha: string };
  parents: { sha: string }[];
}

export const getCommit = (
  f: GithubFetch,
  owner: string,
  repo: string,
  sha: string,
): Promise<GithubCommit> =>
  call<GithubCommit>(f, 'GET', `${repoPath(owner, repo)}/git/commits/${enc(sha)}`);

/** One entry of a recursive tree listing. */
export interface GitTreeItem {
  path: string;
  mode: string;
  type: 'blob' | 'tree' | 'commit';
  sha: string;
  size?: number;
}

/**
 * A whole tree, recursively, by its sha. A listing GitHub cut short
 * (`truncated`: more than 100 000 entries or 7 MB) is refused rather than
 * used: a partial view would read every file it left out as deleted.
 */
export async function getTree(
  f: GithubFetch,
  owner: string,
  repo: string,
  treeSha: string,
): Promise<GitTreeItem[]> {
  const t = await call<{ tree: GitTreeItem[]; truncated?: boolean }>(
    f,
    'GET',
    `${repoPath(owner, repo)}/git/trees/${enc(treeSha)}?recursive=1`,
  );
  if (t.truncated)
    throw new GithubApiError(
      413,
      `${owner}/${repo} is too large for GitHub to list in one piece, so it cannot be synced from here.`,
    );
  return t.tree;
}

/** A blob's bytes, exactly (`GET /git/blobs`, base64 - private repositories too). */
export async function getBlob(
  f: GithubFetch,
  owner: string,
  repo: string,
  sha: string,
): Promise<Uint8Array> {
  const b = await call<{ content: string; encoding: string }>(
    f,
    'GET',
    `${repoPath(owner, repo)}/git/blobs/${enc(sha)}`,
  );
  if (b.encoding !== 'base64') return new TextEncoder().encode(b.content); // 'utf-8': GitHub's other encoding
  return base64ToBytes(b.content.replace(/\s+/g, ''));
}

export async function createBlob(
  f: GithubFetch,
  owner: string,
  repo: string,
  bytes: Uint8Array,
): Promise<string> {
  const b = await call<{ sha: string }>(f, 'POST', `${repoPath(owner, repo)}/git/blobs`, {
    content: bytesToBase64(bytes),
    encoding: 'base64',
  });
  return b.sha;
}

/**
 * One entry of `POST /git/trees`: a file given by `content` (GitHub writes the
 * blob), by `sha` (a blob already there), or `sha: null` - delete it.
 */
export type GitTreeEntry =
  | { path: string; mode: '100644'; type: 'blob'; content: string }
  | { path: string; mode: '100644'; type: 'blob'; sha: string | null };

export async function createTree(
  f: GithubFetch,
  owner: string,
  repo: string,
  entries: readonly GitTreeEntry[],
  baseTree?: string,
): Promise<string> {
  const t = await call<{ sha: string }>(f, 'POST', `${repoPath(owner, repo)}/git/trees`, {
    ...(baseTree ? { base_tree: baseTree } : {}),
    tree: entries,
  });
  return t.sha;
}

/** `parents: []` is a root commit - the first one on a branch. */
export async function createCommit(
  f: GithubFetch,
  owner: string,
  repo: string,
  message: string,
  tree: string,
  parents: readonly string[],
): Promise<string> {
  const c = await call<{ sha: string }>(f, 'POST', `${repoPath(owner, repo)}/git/commits`, {
    message,
    tree,
    parents,
  });
  return c.sha;
}

/**
 * Move a branch. `force: false` is `git push` without `--force`: GitHub
 * refuses unless the new commit has the old head as an ancestor.
 */
export async function updateBranch(
  f: GithubFetch,
  owner: string,
  repo: string,
  branch: string,
  sha: string,
  force: boolean,
): Promise<void> {
  await call(f, 'PATCH', `${repoPath(owner, repo)}/git/refs/heads/${refPath(branch)}`, {
    sha,
    force,
  });
}

export async function createBranch(
  f: GithubFetch,
  owner: string,
  repo: string,
  branch: string,
  sha: string,
): Promise<void> {
  await call(f, 'POST', `${repoPath(owner, repo)}/git/refs`, {
    ref: `refs/heads/${branch}`,
    sha,
  });
}

/**
 * `PUT /contents/{path}`: one file, one commit, on the default branch.
 *
 * The only write that works on an EMPTY repository. The Git database API
 * answers 409 "Git Repository is empty" there, and GitHub's refs docs say it
 * outright: "You are unable to create new references for empty repositories".
 * So the first push writes one file this way to give the repository a branch,
 * and builds the real first commit after (github_project.ts).
 */
export async function putFile(
  f: GithubFetch,
  owner: string,
  repo: string,
  path: string,
  bytes: Uint8Array,
  message: string,
): Promise<{ commit: string }> {
  const r = await call<{ commit: { sha: string } }>(
    f,
    'PUT',
    `${repoPath(owner, repo)}/contents/${path.split('/').map(enc).join('/')}`,
    { message, content: bytesToBase64(bytes) },
  );
  return { commit: r.commit.sha };
}

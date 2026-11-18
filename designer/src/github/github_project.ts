// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * A project and the GitHub repository it is linked to: the first push, a
 * commit, a pull, a branch switch and a clone, each over the REST API
 * (github_api.ts).
 *
 * ## The model
 *
 * There is no local repository. The project in the account is the working
 * tree, the branch on GitHub is both the local and the remote branch, and the
 * link remembers which commit the project last agreed with - `HEAD`, in effect.
 * So a commit here is KiCad's Commit Project... and Push in one step, and a
 * pull is always a fast-forward of the branch; what can collide is a file
 * changed in the project AND on GitHub since that commit.
 *
 * Every comparison is per file, by git's own blob id (`gitBlobSha`): what the
 * project holds against the tree of the last-synced commit is "my changes",
 * that tree against the branch head is "their changes". A pull takes theirs
 * wherever the project has not changed the file - libgit2's
 * `GIT_CHECKOUT_SAFE`, which KiCad's fast-forward uses
 * (`LIBGIT_BACKEND::handleFastForward`) - and refuses the whole pull, changing
 * nothing, when any file changed on both sides.
 *
 * ## What is synced
 *
 * The same rule on both sides, or the two views disagree about what exists and
 * a file one side never looked at reads as deleted:
 *
 *  - not tooling (`isToolingPath`: a dot-folder - `.git`, `.github`, `.history`);
 *  - not a dotfile (`.gitignore`, and our own link file);
 *  - not one of the KiCad-generated paths KiCad's own `.gitignore` seed names
 *    (`KICAD_GITIGNORE`).
 *
 * A repository file outside that rule is never fetched, never changed and
 * never deleted: each commit's tree is built on the previous one
 * (`base_tree`), so it rides along untouched.
 *
 * ## The link
 *
 * Kept in the project as `.ziroeda-git.json`, a dotfile at the project root.
 * Not under a dot-folder: `isToolingPath` files are dropped from the cloud push
 * (cloudStore's cloudUpsert), and the link has to travel with the files it
 * describes - a second device that pulled the project's files from the
 * account with a stale commit id would read the other device's commit as
 * local edits and refuse every pull as a conflict. A dotfile is hidden from
 * the tree (`isHiddenFile`) and, by the rule above, never pushed to GitHub.
 */
import { isToolingPath } from '../home/project_picker.js';
import { kicadProjectsIn } from '../home/github_source.js';
import { treeFileType } from '../home/file_activation.js';
import { mapLimit } from '../map_limit.js';
import { base64ToBytes, bytesToBase64 } from '../cloud/crypto.js';
import { headFiles } from './git_status.js';
import { _ } from '@ziroeda/wx/translation.js';
import { wxFormat } from '@ziroeda/wx/wxstring.js';
import {
  type GitTreeEntry,
  type GitTreeItem,
  type GithubFetch,
  type GithubRepo,
  GithubApiError,
  createBlob,
  createBranch,
  createCommit,
  createTree,
  createUserRepo,
  getBlob,
  getBranchHead,
  getCommit,
  getTree,
  listBranches,
  putFile,
  updateBranch,
} from './github_api.js';

/** Why a Git operation stopped, in words for the person who asked for it. */
export class GitSyncError extends Error {}

// --- the link ----------------------------------------------------------------

/** The project's link to its repository, at the project root. */
export const GIT_LINK_FILE = '.ziroeda-git.json';

export interface GitLink {
  v: 1;
  owner: string;
  repo: string;
  branch: string;
  /** The project's folder in the repository: '' at its root, else `hw/` (with the slash). */
  dir: string;
  /** The commit the project last agreed with. */
  commit: string;
  /** That commit's tree, which the next commit is built on. */
  tree: string;
  /**
   * That commit's synced files (under `dir`, by their path in the project) and their blob ids:
   * what the tree's Git status compares the project with, without asking GitHub. Absent on a link
   * written before it was kept; then the tree is fetched.
   */
  files?: Record<string, string>;
  /** Commits made here and not pushed yet, oldest first (Commit Project... records them). */
  pending?: PendingCommit[];
}

/** One change of a commit not pushed yet: a file's new content, or its deletion (`sha` null). */
export interface PendingChange {
  path: string;
  /** The new content's blob id; null deletes the file. */
  sha: string | null;
  /** The content, as text when it is text (`inlineText`), else base64. */
  text?: string;
  base64?: string;
}

/** A commit Commit Project... made, kept in the project until Push sends it to GitHub. */
export interface PendingCommit {
  message: string;
  /** Who made it: the GitHub account, and its id for the commit's noreply address. */
  author: { login: string; id?: number };
  /** When (ISO 8601): the commit's own date on GitHub. */
  at: string;
  /** What it changes against the commit before it - the files that changed and nothing else. */
  changes: PendingChange[];
}

const utf8 = new TextEncoder();

export function gitLinkBytes(link: GitLink): Uint8Array {
  return utf8.encode(`${JSON.stringify(link, null, 2)}\n`);
}

const isStr = (v: unknown): v is string => typeof v === 'string';

/** The link a file holds, or null for anything that is not one. */
export function parseGitLink(bytes: Uint8Array | string | undefined): GitLink | null {
  if (bytes === undefined) return null;
  try {
    const o = JSON.parse(typeof bytes === 'string' ? bytes : new TextDecoder().decode(bytes)) as
      | Partial<GitLink>
      | undefined;
    if (
      !o ||
      o.v !== 1 ||
      !isStr(o.owner) ||
      !isStr(o.repo) ||
      !isStr(o.branch) ||
      !isStr(o.dir) ||
      !isStr(o.commit) ||
      !isStr(o.tree)
    )
      return null;
    const files =
      o.files && typeof o.files === 'object' && Object.values(o.files).every(isStr)
        ? { ...o.files }
        : undefined;
    const pending = Array.isArray(o.pending)
      ? o.pending.filter(
          (c): c is PendingCommit =>
            !!c && isStr(c.message) && isStr(c.at) && Array.isArray(c.changes) && !!c.author,
        )
      : undefined;
    return {
      v: 1,
      owner: o.owner,
      repo: o.repo,
      branch: o.branch,
      dir: o.dir,
      commit: o.commit,
      tree: o.tree,
      ...(files ? { files } : {}),
      ...(pending && pending.length > 0 ? { pending } : {}),
    };
  } catch {
    return null;
  }
}

/** The link among a project's files (as stored, or as the tree holds them). */
export function gitLinkOf(
  files: readonly { name: string; bytes?: Uint8Array; text?: string }[] | null | undefined,
): GitLink | null {
  const f = files?.find((x) => x.name === GIT_LINK_FILE);
  if (!f) return null;
  return parseGitLink(f.bytes && f.bytes.length > 0 ? f.bytes : f.text);
}

/** `git status`'s "origin/main": what KiCad's Push and Pull rows name. */
export const upstreamOf = (link: GitLink): string => `origin/${link.branch}`;

// --- which files -------------------------------------------------------------

/**
 * `ensureProjectGitignore`'s `kicadEntries` (common/git/git_init_handler.cpp:
 * 42-45): what KiCad writes into a new repository's `.gitignore` as "should
 * never be committed". Data, mirrored from KiCad's table.
 */
export const KICAD_GITIGNORE: readonly string[] = [
  '.history/',
  '*-backups/',
  '_autosave-*',
  'fp-info-cache',
  '~*.lck',
  '*.kicad_prl',
];

/** The file itself, as KiCad writes it when there was none (git_init_handler.cpp:90-95). */
export const KICAD_GITIGNORE_TEXT = `# KiCad-generated files and directories.\n${KICAD_GITIGNORE.join('\n')}\n`;

const escapeRe = (s: string): string => s.replace(/[.+?^${}()|[\]\\]/g, '\\$&');
const IGNORE_RULES = KICAD_GITIGNORE.map((pat) => {
  const dirOnly = pat.endsWith('/');
  const glob = dirOnly ? pat.slice(0, -1) : pat;
  return { dirOnly, re: new RegExp(`^${glob.split('*').map(escapeRe).join('[^/]*')}$`) };
});

/**
 * Whether one of {@link KICAD_GITIGNORE} matches the path, as git reads them:
 * a pattern with no slash matches a name at any depth, and one ending in `/`
 * matches only a directory - so `x-backups/` hides everything under it and a
 * file named `x-backups` is kept.
 */
export function isKicadIgnored(path: string): boolean {
  const parts = path.split('/');
  const dirs = parts.slice(0, -1);
  return IGNORE_RULES.some(({ dirOnly, re }) => (dirOnly ? dirs : parts).some((p) => re.test(p)));
}

/** Whether a project-relative path is part of what syncs with the repository. */
export function isSyncedPath(path: string): boolean {
  const base = path.slice(path.lastIndexOf('/') + 1);
  return base !== '' && !base.startsWith('.') && !isToolingPath(path) && !isKicadIgnored(path);
}

const normalize = (name: string): string => name.replace(/\\/g, '/').replace(/^\/+/, '');

// --- blob ids ----------------------------------------------------------------

/** git's id for a file: SHA-1 of `blob <length>\0` and the bytes. */
export async function gitBlobSha(bytes: Uint8Array): Promise<string> {
  const header = utf8.encode(`blob ${bytes.length}\0`);
  const all = new Uint8Array(header.length + bytes.length);
  all.set(header, 0);
  all.set(bytes, header.length);
  const digest = new Uint8Array(await crypto.subtle.digest('SHA-1', all));
  return Array.from(digest, (b) => b.toString(16).padStart(2, '0')).join('');
}

/** A project file as the store returns it. */
export interface ProjectFile {
  name: string;
  bytes: Uint8Array;
}

export interface LocalEntry {
  sha: string;
  bytes: Uint8Array;
}

export interface RemoteEntry {
  sha: string;
  size?: number;
}

/** The project's synced files by path, each with its blob id. */
export async function localView(files: readonly ProjectFile[]): Promise<Map<string, LocalEntry>> {
  const out = new Map<string, LocalEntry>();
  for (const f of files) {
    const path = normalize(f.name);
    if (!isSyncedPath(path)) continue;
    out.set(path, { sha: await gitBlobSha(f.bytes), bytes: f.bytes });
  }
  return out;
}

/**
 * A repository tree as the project sees it: the files under `dir`, by their
 * path below it, filtered by the same rule as {@link localView}. Symbolic links
 * (mode 120000) and submodules are not files a project holds.
 */
export function remoteView(tree: readonly GitTreeItem[], dir: string): Map<string, RemoteEntry> {
  const out = new Map<string, RemoteEntry>();
  for (const e of tree) {
    if (e.type !== 'blob' || e.mode === '120000' || !e.path.startsWith(dir)) continue;
    const rel = e.path.slice(dir.length);
    if (!isSyncedPath(rel)) continue;
    out.set(rel, e.size === undefined ? { sha: e.sha } : { sha: e.sha, size: e.size });
  }
  return out;
}

export type ChangeStatus = 'new' | 'modified' | 'deleted';

/** One row of DIALOG_GIT_COMMIT's list: a path and its status. */
export interface Change {
  path: string;
  status: ChangeStatus;
}

const byCodepoint = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);

/** What the project changed since `base`, in path order. */
export function changesBetween(
  local: ReadonlyMap<string, { sha: string }>,
  base: ReadonlyMap<string, { sha: string }>,
): Change[] {
  const out: Change[] = [];
  for (const [path, l] of local) {
    const b = base.get(path);
    if (!b) out.push({ path, status: 'new' });
    else if (b.sha !== l.sha) out.push({ path, status: 'modified' });
  }
  for (const path of base.keys()) if (!local.has(path)) out.push({ path, status: 'deleted' });
  return out.sort((a, b) => byCodepoint(a.path, b.path));
}

// --- writing a tree ----------------------------------------------------------

const TEXT = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true });

/**
 * The file as a string GitHub can write byte-for-byte, or null when it cannot
 * be one (not UTF-8, or holds a NUL) and has to go up as a base64 blob.
 *
 * A tree entry's `content` creates its blob in the same request, so a project
 * of text files - which a KiCad project almost entirely is - costs one request
 * rather than one per file. That matters beyond speed: GitHub allows no more
 * than 80 content-creating requests a minute, and a project of a few hundred
 * footprints posted blob by blob would hit it.
 */
export function inlineText(bytes: Uint8Array): string | null {
  if (bytes.includes(0)) return null;
  try {
    return TEXT.decode(bytes);
  } catch {
    return null;
  }
}

/** Inline content per tree request: a larger project is written as a chain of trees. */
export const TREE_CHUNK_BYTES = 4 * 1024 * 1024;

/** A file to write at a repository path, or null to delete it. */
interface TreeWrite {
  path: string;
  bytes: Uint8Array | null;
}

async function writeTree(
  f: GithubFetch,
  owner: string,
  repo: string,
  writes: readonly TreeWrite[],
  baseTree?: string,
): Promise<string> {
  const entries = await mapLimit(writes, 3, async (w): Promise<[GitTreeEntry, number]> => {
    if (w.bytes === null) return [{ path: w.path, mode: '100644', type: 'blob', sha: null }, 0];
    const text = inlineText(w.bytes);
    if (text !== null)
      return [{ path: w.path, mode: '100644', type: 'blob', content: text }, w.bytes.length];
    const sha = await createBlob(f, owner, repo, w.bytes);
    return [{ path: w.path, mode: '100644', type: 'blob', sha }, 0];
  });
  let base = baseTree;
  let chunk: GitTreeEntry[] = [];
  let weight = 0;
  for (const [entry, size] of entries) {
    if (chunk.length > 0 && weight + size > TREE_CHUNK_BYTES) {
      base = await createTree(f, owner, repo, chunk, base);
      chunk = [];
      weight = 0;
    }
    chunk.push(entry);
    weight += size;
  }
  if (chunk.length > 0) base = await createTree(f, owner, repo, chunk, base);
  if (!base) throw new GitSyncError(_('This project has no files to push.'));
  return base;
}

/**
 * Read the new tree back and compare it, file by file, with what was meant -
 * before anything points at it. A text file GitHub re-encoded, or a chunk that
 * went missing, stops here with the branch untouched.
 */
async function verifyTree(
  f: GithubFetch,
  owner: string,
  repo: string,
  tree: string,
  dir: string,
  expected: ReadonlyMap<string, string>,
): Promise<void> {
  const got = remoteView(await getTree(f, owner, repo, tree), dir);
  for (const [path, sha] of expected) {
    if (got.get(path)?.sha !== sha)
      throw new GitSyncError(
        wxFormat(_('GitHub did not store %s as this project has it, so nothing was pushed.'), path),
      );
  }
  for (const path of got.keys())
    if (!expected.has(path))
      throw new GitSyncError(
        wxFormat(_('GitHub kept %s, which this project deleted, so nothing was pushed.'), path),
      );
}

// --- Push to GitHub... --------------------------------------------------------

/** GitHub's rule for a repository name: letters, digits, `.`, `-`, `_`; at most 100. */
export function isValidRepoName(name: string): boolean {
  return /^[A-Za-z0-9._-]{1,100}$/.test(name) && name !== '.' && name !== '..';
}

/**
 * The name the Push to GitHub dialog offers: the project's, with every run of
 * characters GitHub does not take turned into one `-`, as GitHub's own form
 * does when it suggests a name.
 */
export function repoNameFor(projectName: string): string {
  const name = projectName
    .replace(/[^A-Za-z0-9._-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 100);
  return isValidRepoName(name) ? name : 'kicad-project';
}

export const INITIAL_COMMIT_MESSAGE = 'Initial commit';

/**
 * GitHub would not create the repository with the access the App has: the installation is likely
 * limited to chosen repositories. Said in words, never GitHub's "Resource not accessible by
 * integration", and the caller offers the link to change the access.
 */
export class GithubAccessError extends GitSyncError {}

/**
 * Fill an EMPTY repository with the project, as its first commit.
 *
 * An empty repository has no branch, and the Git database API will not write
 * to one (see `putFile`). So `.gitignore` - KiCad's own seed, which its "Add
 * Project to Version Control..." writes into every new repository - goes up
 * first through the Contents API, which gives the repository its default
 * branch. The real first commit is then built as a ROOT commit holding that
 * `.gitignore` and every project file, and the branch is moved onto it, so the
 * history starts with one commit that is the whole project.
 */
async function seedEmptyRepository(
  f: GithubFetch,
  owner: string,
  name: string,
  branch: string,
  local: ReadonlyMap<string, LocalEntry>,
): Promise<GitLink> {
  const gitignore = utf8.encode(KICAD_GITIGNORE_TEXT);
  const seed = await putFile(f, owner, name, '.gitignore', gitignore, INITIAL_COMMIT_MESSAGE);
  const tree = await writeTree(f, owner, name, [
    { path: '.gitignore', bytes: gitignore },
    ...[...local].map(([path, e]) => ({ path, bytes: e.bytes })),
  ]);
  await verifyTree(f, owner, name, tree, '', new Map([...local].map(([path, e]) => [path, e.sha])));
  const commit = await createCommit(f, owner, name, INITIAL_COMMIT_MESSAGE, tree, []);
  // The force replaces the one-file commit the Contents API just made, and nothing else: the
  // branch is checked to be still on it, in a repository that had no commit before it.
  if ((await getBranchHead(f, owner, name, branch)) !== seed.commit)
    throw new GitSyncError(
      wxFormat(
        _('Someone else pushed to %s while ZiroEDA was filling it, so nothing was overwritten.'),
        `${owner}/${name}`,
      ),
    );
  await updateBranch(f, owner, name, branch, commit, true);
  return {
    v: 1,
    owner,
    repo: name,
    branch,
    dir: '',
    commit,
    tree,
    files: Object.fromEntries([...local].map(([p, e]) => [p, e.sha])),
  };
}

const unfinished = (full: string, e: unknown): GitSyncError =>
  new GitSyncError(
    wxFormat(
      _('%s was created on GitHub, but the push did not finish: %s'),
      full,
      e instanceof Error ? e.message : String(e),
    ),
  );

/**
 * Push to GitHub... > Create a new repository: the repository under the signed-in account, and
 * every synced file of the project as its first commit.
 */
export async function pushNewRepository(
  f: GithubFetch,
  name: string,
  isPrivate: boolean,
  files: readonly ProjectFile[],
): Promise<{ link: GitLink; repo: GithubRepo }> {
  const local = await localView(files);
  if (local.size === 0) throw new GitSyncError(_('This project has no files to push.'));

  let repo: GithubRepo;
  try {
    repo = await createUserRepo(f, name, isPrivate);
  } catch (e) {
    // 403 "Resource not accessible by integration" (or a 404 hiding it): not a name problem.
    if (e instanceof GithubApiError && (e.status === 403 || e.status === 404))
      throw new GithubAccessError(
        _(
          'GitHub did not let ZiroEDA create a repository. ZiroEDA may be limited to the repositories you chose for it: give it access to all repositories on GitHub, or create the repository there, give ZiroEDA access to it, and choose Use an existing repository.',
        ),
      );
    throw e;
  }
  const owner = repo.owner.login;
  try {
    const link = await seedEmptyRepository(
      f,
      owner,
      repo.name,
      repo.default_branch || 'main',
      local,
    );
    return { link, repo };
  } catch (e) {
    throw unfinished(`${owner}/${repo.name}`, e);
  }
}

/**
 * Push to GitHub... > Use an existing repository: one the App may use, and only an EMPTY one. A
 * repository with commits holds somebody's history; pushing a project over it would need a force
 * push, and joining the two is what File > Open Project from GitHub... is for.
 */
export async function pushToExistingRepository(
  f: GithubFetch,
  repo: Pick<GithubRepo, 'name' | 'owner' | 'default_branch'>,
  files: readonly ProjectFile[],
): Promise<{ link: GitLink }> {
  const local = await localView(files);
  if (local.size === 0) throw new GitSyncError(_('This project has no files to push.'));
  const owner = repo.owner.login;
  const full = `${owner}/${repo.name}`;
  if ((await listBranches(f, owner, repo.name)).length > 0)
    throw new GitSyncError(
      wxFormat(
        _(
          '%s already has commits, and Push to GitHub... fills only an empty repository. Choose an empty one or create a new repository; to work on the project that is in it, open it with File > Open Project from GitHub... instead.',
        ),
        full,
      ),
    );
  try {
    return {
      link: await seedEmptyRepository(f, owner, repo.name, repo.default_branch || 'main', local),
    };
  } catch (e) {
    throw new GitSyncError(
      wxFormat(
        _('The push to %s did not finish: %s'),
        full,
        e instanceof Error ? e.message : String(e),
      ),
    );
  }
}

// --- Commit Project... and Push ----------------------------------------------------

/**
 * KiCad's Commit and Push are two steps, and so are these. Commit Project... records a commit
 * HERE - the account is the local repository - with its message, author, time and the content
 * of every file it changes, on top of the commits not pushed yet (or the synced commit). Push
 * then writes them to GitHub, oldest first, each as itself, and moves the branch once.
 *
 * They are kept in the link file (`pending`): it syncs with the project to the account, so a
 * commit made on one device can be pushed from another, and it is neither in the tree nor ever
 * pushed as a file. A commit stores only the files it changes, as text when they are text.
 */

/** At most this much file content (bytes) waits in commits not pushed yet: push to commit more. */
export const MAX_PENDING_BYTES = 16 * 1024 * 1024;

/** The commits not pushed yet. */
export const pendingOf = (link: Pick<GitLink, 'pending'>): readonly PendingCommit[] =>
  link.pending ?? [];

const changeBytes = (c: PendingChange): number =>
  c.text !== undefined ? utf8.encode(c.text).length : c.base64 ? (c.base64.length * 3) / 4 : 0;

/** The bytes a pending change holds. */
function bytesOfChange(c: PendingChange): Uint8Array {
  if (c.text !== undefined) return utf8.encode(c.text);
  return base64ToBytes(c.base64 ?? '');
}

/** What Commit Project... would record: the project's changes against HEAD. */
export interface LocalCommitPlan {
  changes: Change[];
  local: ReadonlyMap<string, LocalEntry>;
}

/**
 * The changes a commit would record, against HEAD - the synced commit's files with the commits
 * not pushed yet laid over them. `synced` is the synced commit's files (`syncedFilesOf`).
 */
export async function planLocalCommit(
  link: GitLink,
  synced: ReadonlyMap<string, string>,
  files: readonly ProjectFile[],
): Promise<LocalCommitPlan> {
  const { head } = headFiles(synced, link.pending);
  const local = await localView(files);
  const base = new Map([...head].map(([p, sha]) => [p, { sha }]));
  return { changes: changesBetween(local, base), local };
}

/**
 * Record the plan as a commit not pushed yet: the link with it at the end of `pending`. Nothing
 * reaches GitHub. Refused with nothing to record, and when the waiting commits would hold more
 * than {@link MAX_PENDING_BYTES}.
 */
export function recordLocalCommit(
  link: GitLink,
  plan: LocalCommitPlan,
  message: string,
  author: PendingCommit['author'],
  at: Date,
): GitLink {
  if (plan.changes.length === 0) throw new GitSyncError(_('There are no changes to commit.'));
  const changes: PendingChange[] = plan.changes.map((c) => {
    if (c.status === 'deleted') return { path: c.path, sha: null };
    const e = plan.local.get(c.path)!;
    const text = inlineText(e.bytes);
    return text !== null
      ? { path: c.path, sha: e.sha, text }
      : { path: c.path, sha: e.sha, base64: bytesToBase64(e.bytes) };
  });
  const commit: PendingCommit = { message, author, at: at.toISOString(), changes };
  const pending = [...pendingOf(link), commit];
  const held = pending.reduce((n, p) => n + p.changes.reduce((m, c) => m + changeBytes(c), 0), 0);
  if (held > MAX_PENDING_BYTES)
    throw new GitSyncError(
      wxFormat(
        _('The commits not pushed yet would hold more than %d MB of files. Push them first.'),
        MAX_PENDING_BYTES / (1024 * 1024),
      ),
    );
  return { ...link, pending };
}

/**
 * The branch moved on GitHub since the project last synced: pushing over it would need a force
 * push, which is not what Push asks for. `git push`'s own answer - pull first.
 */
export class GitBehindError extends GitSyncError {}

const behindMessage = (link: GitLink): string =>
  wxFormat(
    _('%s has commits on %s that this project does not have yet. Pull them first, then push.'),
    `${link.owner}/${link.repo}`,
    link.branch,
  );

/** A commit's author as GitHub takes it: the account's noreply address, and the commit's time. */
const commitAuthor = (
  c: PendingCommit,
): { name: string; email: string; date: string } | undefined =>
  c.author.id === undefined
    ? undefined
    : {
        name: c.author.login,
        email: `${c.author.id}+${c.author.login}@users.noreply.github.com`,
        date: c.at,
      };

/**
 * Push: every commit not pushed yet, oldest first, each with its own message, author and time,
 * on the synced commit; then the branch moves to the last one, without force. Every tree is read
 * back before anything points at it. The new link has no pending commits.
 */
export async function pushPending(
  f: GithubFetch,
  link: GitLink,
  synced: ReadonlyMap<string, string>,
): Promise<GitLink> {
  const pending = pendingOf(link);
  if (pending.length === 0) throw new GitSyncError(_('There are no commits to push.'));
  const head = await getBranchHead(f, link.owner, link.repo, link.branch);
  if (head !== link.commit) throw new GitBehindError(behindMessage(link));
  let parent = link.commit;
  let tree = link.tree;
  const files = new Map(synced);
  for (const c of pending) {
    const writes: TreeWrite[] = [];
    for (const ch of c.changes) {
      if (ch.sha === null) {
        writes.push({ path: link.dir + ch.path, bytes: null });
        files.delete(ch.path);
        continue;
      }
      const bytes = bytesOfChange(ch);
      if ((await gitBlobSha(bytes)) !== ch.sha)
        throw new GitSyncError(
          wxFormat(_('The commit "%s" holds a damaged copy of %s.'), c.message, ch.path),
        );
      writes.push({ path: link.dir + ch.path, bytes });
      files.set(ch.path, ch.sha);
    }
    tree = await writeTree(f, link.owner, link.repo, writes, tree);
    await verifyTree(f, link.owner, link.repo, tree, link.dir, files);
    parent = await createCommit(
      f,
      link.owner,
      link.repo,
      c.message,
      tree,
      [parent],
      commitAuthor(c),
    );
  }
  try {
    await updateBranch(f, link.owner, link.repo, link.branch, parent, false);
  } catch (e) {
    // Someone pushed between the check and here: not a fast-forward any more.
    if (e instanceof GithubApiError && e.status === 422)
      throw new GitBehindError(behindMessage(link));
    throw e;
  }
  const { pending: _sent, ...rest } = link;
  return { ...rest, commit: parent, tree, files: Object.fromEntries(files) };
}

/**
 * The commits not pushed yet, moved onto a new synced commit (a pull's): each change that the new
 * base - with the commits before it - already holds as it is falls away, as does each change to a
 * path in `drop` (Use Remote's conflicting files). A commit left with nothing is dropped. Returns
 * the commits, and what was taken out of which commit, so nothing goes unsaid.
 */
export function rebasePending(
  pending: readonly PendingCommit[],
  newBase: ReadonlyMap<string, string>,
  drop: ReadonlySet<string> = new Set(),
): {
  pending: PendingCommit[];
  trimmed: { message: string; paths: string[] }[];
  dropped: string[];
} {
  const state = new Map(newBase);
  const out: PendingCommit[] = [];
  const trimmed: { message: string; paths: string[] }[] = [];
  const dropped: string[] = [];
  for (const c of pending) {
    const kept: PendingChange[] = [];
    const gone: string[] = [];
    for (const ch of c.changes) {
      if (drop.has(ch.path)) {
        gone.push(ch.path);
        continue;
      }
      if ((state.get(ch.path) ?? null) === ch.sha) continue;
      kept.push(ch);
      if (ch.sha === null) state.delete(ch.path);
      else state.set(ch.path, ch.sha);
    }
    if (gone.length > 0) trimmed.push({ message: c.message, paths: gone });
    if (kept.length === 0) dropped.push(c.message);
    else out.push(kept.length === c.changes.length ? c : { ...c, changes: kept });
  }
  return { pending: out, trimmed, dropped };
}

// --- the tree's Git status --------------------------------------------------------

const blobMap = (view: ReadonlyMap<string, RemoteEntry>): Map<string, string> =>
  new Map([...view].map(([p, e]) => [p, e.sha]));

/** The synced commit's files: the link's own record, or - a link older than it - its tree. */
export async function syncedFilesOf(f: GithubFetch, link: GitLink): Promise<Map<string, string>> {
  if (link.files) return new Map(Object.entries(link.files));
  return blobMap(remoteView(await getTree(f, link.owner, link.repo, link.tree), link.dir));
}

/**
 * The remote check `onGitSyncTimer` makes (a fetch, there): the branch's head on GitHub and its
 * files, read fresh. Null when the branch is gone.
 */
export async function remoteFilesOf(
  f: GithubFetch,
  link: GitLink,
): Promise<{ head: string; files: Map<string, string> } | null> {
  const head = await getBranchHead(f, link.owner, link.repo, link.branch);
  if (!head) return null;
  if (head === link.commit) return { head, files: await syncedFilesOf(f, link) };
  const commit = await getCommit(f, link.owner, link.repo, head);
  return {
    head,
    files: blobMap(remoteView(await getTree(f, link.owner, link.repo, commit.tree.sha), link.dir)),
  };
}

// --- Pull / Switch to Branch ----------------------------------------------------

export interface PullPlan {
  /** The link as it is once the pull lands. */
  link: GitLink;
  upToDate: boolean;
  /** Changed on GitHub only: taken as they are. */
  take: string[];
  /** Deleted on GitHub, unchanged here: deleted here. */
  drop: string[];
  /** Changed here AND on GitHub, differently. */
  conflicts: string[];
  /** The branch head's files, for fetching what is taken. */
  target: ReadonlyMap<string, RemoteEntry>;
}

/**
 * What pulling `branch` (the linked one, or another for Switch to Branch)
 * would do to the project.
 *
 * A file is only ever written or deleted where the project still holds what
 * the last-synced commit held, so nothing the person changed is overwritten,
 * and a file the repository lacks is deleted only when it was in that commit
 * and has not been touched since. A file the project has that neither commit
 * knows is not the repository's business and is left alone.
 */
export async function planPull(
  f: GithubFetch,
  link: GitLink,
  files: readonly ProjectFile[],
  branch: string = link.branch,
): Promise<PullPlan> {
  // GIT_BRANCH_HANDLER refuses to switch over work it would lose; commits not pushed yet are that
  // work here (they belong to this branch), so they go first.
  if (branch !== link.branch && pendingOf(link).length > 0)
    throw new GitSyncError(
      _(
        'This project has commits that are not pushed yet. Push them first, then switch to another branch.',
      ),
    );
  const head = await getBranchHead(f, link.owner, link.repo, branch);
  if (!head)
    throw new GitSyncError(
      wxFormat(_('There is no branch %s in %s on GitHub.'), branch, `${link.owner}/${link.repo}`),
    );
  if (head === link.commit)
    return {
      link: { ...link, branch },
      upToDate: true,
      take: [],
      drop: [],
      conflicts: [],
      target: new Map(),
    };
  const commit = await getCommit(f, link.owner, link.repo, head);
  const [baseTree, headTree] = await Promise.all([
    getTree(f, link.owner, link.repo, link.tree),
    getTree(f, link.owner, link.repo, commit.tree.sha),
  ]);
  const base = remoteView(baseTree, link.dir);
  const target = remoteView(headTree, link.dir);
  const local = await localView(files);

  const take: string[] = [];
  const drop: string[] = [];
  const conflicts: string[] = [];
  const paths = [...new Set([...base.keys(), ...target.keys()])].sort(byCodepoint);
  // HEAD: what the commits not pushed yet made of each file. One of them that changed a file GitHub
  // changed too, to something else, is as much a collision as an edit not committed.
  const { head: headMap, ahead } = headFiles(
    new Map([...base].map(([p, e]) => [p, e.sha])),
    link.pending,
  );
  for (const path of paths) {
    const b = base.get(path)?.sha;
    const t = target.get(path)?.sha;
    if (b === t) continue; // not changed on GitHub
    if (ahead.has(path)) {
      if (headMap.get(path) !== t) conflicts.push(path);
      continue;
    }
    const l = local.get(path)?.sha;
    if (l === t) continue; // the project already has it as GitHub does
    if (l !== b) conflicts.push(path);
    else if (t === undefined) drop.push(path);
    else take.push(path);
  }
  return {
    link: {
      ...link,
      branch,
      commit: head,
      tree: commit.tree.sha,
      files: Object.fromEntries([...target].map(([p, e]) => [p, e.sha])),
    },
    upToDate: false,
    take,
    drop,
    conflicts,
    target,
  };
}

/**
 * The files a pull writes and the paths it deletes. With conflicts it refuses,
 * unless `useRemote` - "Use Remote (discard my changes)" - which takes GitHub's
 * side of each conflicting file and keeps every other change of the project's.
 */
export async function fetchPull(
  f: GithubFetch,
  plan: PullPlan,
  useRemote: boolean,
  onProgress?: (done: number, total: number) => void,
): Promise<{
  writes: ProjectFile[];
  deletes: string[];
  link: GitLink;
  /** What Use Remote took out of the commits not pushed yet, and the ones left empty. */
  trimmed: { message: string; paths: string[] }[];
  dropped: string[];
}> {
  if (plan.conflicts.length > 0 && !useRemote)
    throw new GitSyncError(
      _(
        'Your local changes and the remote changes conflict, so the pull was cancelled and nothing was changed.',
      ),
    );
  const take = [...plan.take];
  const deletes = [...plan.drop];
  if (useRemote)
    for (const path of plan.conflicts) (plan.target.has(path) ? take : deletes).push(path);
  const writes = await fetchBlobs(f, plan.link, take, plan.target, onProgress);
  // The commits not pushed yet go on top of the pulled commit (a rebase): none of them touches a
  // file GitHub changed, or the pull would have been refused - except, under Use Remote, the
  // conflicting files, whose changes come out of them.
  const rebased = rebasePending(
    pendingOf(plan.link),
    new Map([...plan.target].map(([p, e]) => [p, e.sha])),
    useRemote ? new Set(plan.conflicts) : new Set(),
  );
  const { pending: _old, ...rest } = plan.link;
  const link: GitLink = rebased.pending.length > 0 ? { ...rest, pending: rebased.pending } : rest;
  return { writes, deletes, link, trimmed: rebased.trimmed, dropped: rebased.dropped };
}

const FETCH_CONCURRENCY = 6;

async function fetchBlobs(
  f: GithubFetch,
  where: { owner: string; repo: string },
  paths: readonly string[],
  entries: ReadonlyMap<string, RemoteEntry>,
  onProgress?: (done: number, total: number) => void,
): Promise<ProjectFile[]> {
  const total = paths.reduce((n, p) => n + (entries.get(p)?.size ?? 0), 0);
  let done = 0;
  return mapLimit(paths, FETCH_CONCURRENCY, async (path) => {
    const e = entries.get(path)!;
    const bytes = await getBlob(f, where.owner, where.repo, e.sha);
    // The blob id is a checksum: what arrived is what git holds, or nothing is written.
    if ((await gitBlobSha(bytes)) !== e.sha)
      throw new GitSyncError(wxFormat(_('%s arrived damaged from GitHub.'), path));
    done += e.size ?? 0;
    onProgress?.(done, total);
    return { name: path, bytes };
  });
}

/**
 * `KIGIT_COMMON::GetBranchNames`: the repository's branches, the current one
 * first (KiCad's quick-switch rows skip the first for that reason).
 */
export async function branchNames(f: GithubFetch, link: GitLink): Promise<string[]> {
  const names = (await listBranches(f, link.owner, link.repo)).map((b) => b.name);
  return [link.branch, ...names.filter((n) => n !== link.branch).sort(byCodepoint)];
}

/**
 * A name git would take for a branch (`git check-ref-format --branch`, the
 * rules a person can trip over): no spaces or control characters, none of
 * `~^:?*[\`, no `..` or `@{`, no `/` at either end or twice in a row, no part
 * starting with `.` or ending in `.lock`.
 */
export function isValidBranchName(name: string): boolean {
  if (name === '' || name === '@' || name.startsWith('-')) return false;
  // biome-ignore lint/suspicious/noControlCharactersInRegex: git refuses control characters in a ref
  if (/[\x00-\x20\x7f~^:?*[\\]/.test(name) || name.includes('..') || name.includes('@{'))
    return false;
  if (name.startsWith('/') || name.endsWith('/') || name.includes('//') || name.endsWith('.'))
    return false;
  return name.split('/').every((part) => !part.startsWith('.') && !part.endsWith('.lock'));
}

/** DIALOG_GIT_SWITCH's Add: a new branch at the project's commit, now the linked one. */
export async function addBranch(f: GithubFetch, link: GitLink, name: string): Promise<GitLink> {
  await createBranch(f, link.owner, link.repo, name, link.commit);
  return { ...link, branch: name };
}

// --- which repositories hold a KiCad project ------------------------------------

/** A path without its extension: the stem a project and its root schematic share. */
const stemOf = (path: string): string => {
  const dot = path.lastIndexOf('.');
  return dot > path.lastIndexOf('/') ? path.slice(0, dot) : path;
};

/**
 * The projects of a repository tree, likeliest first, never in a tooling folder:
 *
 *  - every `.kicad_pro` (`kicadProjectsIn`, the order the GitHub open already uses);
 *  - then every KiCad 4/5 project: a file the project tree classes `LEGACY_PROJECT` (`.pro`) with a
 *    `LEGACY_SCHEMATIC` (`.sch`) of the same stem beside it - the root sheet KiCad opens with it -
 *    unless a `.kicad_pro` of that stem says it has been migrated already. A `.pro` with no sheet
 *    is some other program's (Qt's, among others).
 */
export function projectsInTree(tree: readonly GitTreeItem[]): string[] {
  const blobs = tree.filter((e) => e.type === 'blob' && !isToolingPath(e.path)).map((e) => e.path);
  const modern = kicadProjectsIn(blobs.map((path) => ({ path, type: 'blob' as const })));
  const migrated = new Set(modern.map(stemOf));
  const sheets = new Set(blobs.filter((p) => treeFileType(p) === 'LEGACY_SCHEMATIC').map(stemOf));
  const depth = (p: string): number => p.split('/').length;
  const legacy = blobs
    .filter((p) => treeFileType(p) === 'LEGACY_PROJECT')
    .filter((p) => sheets.has(stemOf(p)) && !migrated.has(stemOf(p)))
    .sort((a, b) => depth(a) - depth(b) || byCodepoint(a, b));
  return [...modern, ...legacy];
}

/**
 * What is known about which projects each repository holds, for this session: by repository, its
 * default branch and when it was last pushed, so a push since makes it ask again. `null` is a
 * repository GitHub would not list.
 */
export type KicadScanCache = Map<string, readonly string[] | null>;
export const sessionKicadScan: KicadScanCache = new Map();

type ScannedRepo = Pick<
  GithubRepo,
  'name' | 'full_name' | 'owner' | 'default_branch' | 'pushed_at'
>;

const scanKey = (r: Pick<GithubRepo, 'full_name' | 'default_branch' | 'pushed_at'>): string =>
  `${r.full_name}#${r.default_branch ?? ''}#${r.pushed_at ?? ''}`;

/**
 * The KiCad projects on a repository's default branch (`projectsInTree`). An empty repository has
 * none. One GitHub would not list - `truncated`, or refused - is `null`: it cannot be ruled out,
 * and hiding a person's project is worse than showing a repository that turns out to have none.
 * A project on another branch is not looked for; a branch's link opens it.
 */
export async function kicadProjectsOf(
  f: GithubFetch,
  repo: ScannedRepo,
  cache: KicadScanCache = sessionKicadScan,
): Promise<readonly string[] | null> {
  const key = scanKey(repo);
  if (cache.has(key)) return cache.get(key)!;
  let projects: readonly string[] | null;
  try {
    projects = projectsInTree(
      await getTree(f, repo.owner.login, repo.name, repo.default_branch || 'HEAD'),
    );
  } catch (e) {
    if (!(e instanceof GithubApiError)) throw e;
    projects = e.status === 404 || e.status === 409 ? [] : null;
  }
  cache.set(key, projects);
  return projects;
}

/** A repository that holds KiCad projects (or may: `projects` null), and which. */
export interface RepoProjects<R extends ScannedRepo = GithubRepo> {
  repo: R;
  projects: readonly string[] | null;
}

/** How many repositories are looked into at once: a person with hundreds waits, GitHub is spared. */
export const KICAD_SCAN_CONCURRENCY = 4;

/**
 * The repositories, in their order, that hold a KiCad project, each with its projects. `onEach`
 * reports each repository as it is answered (from the cache or from GitHub) - with what it holds,
 * or null for none - so a list can grow while the rest are looked into.
 */
export async function findKicadProjects<R extends ScannedRepo>(
  f: GithubFetch,
  repos: readonly R[],
  onEach?: (done: number, total: number, found: RepoProjects<R> | null) => void,
  cache: KicadScanCache = sessionKicadScan,
): Promise<RepoProjects<R>[]> {
  let done = 0;
  const found = await mapLimit(repos, KICAD_SCAN_CONCURRENCY, async (repo) => {
    const projects = await kicadProjectsOf(f, repo, cache);
    const hit = projects === null || projects.length > 0 ? { repo, projects } : null;
    done += 1;
    onEach?.(done, repos.length, hit);
    return hit;
  });
  return found.filter((x): x is RepoProjects<R> => x !== null);
}

// --- Open Project from GitHub...: one of the person's repositories ----------------

/** More files than this is not a project; it is a monorepo, and one fetch per file. */
export const MAX_CLONE_FILES = 2000;

/**
 * A repository's KiCad project as a new project's files, and the link that
 * makes it one linked to that repository. `choose` picks among several
 * projects (null cancels: the result is then null).
 *
 * Every synced file under the project's folder is fetched - not only what a
 * KiCad project reads, as the read-only GitHub open does - because a file left
 * behind here would read as deleted at the next commit.
 *
 * Git LFS files arrive as their pointers and stay that way. Resolving one
 * would make the project's copy differ from the blob git holds, so the next
 * commit would push the whole file over the pointer and take it out of LFS.
 */
export async function cloneRepository(
  f: GithubFetch,
  repo: Pick<GithubRepo, 'name' | 'owner' | 'default_branch'>,
  choose: (projects: readonly string[]) => Promise<string | null>,
  onProgress?: (done: number, total: number) => void,
  /**
   * Asked with the project's name once it is chosen and BEFORE any file is fetched: a reason not
   * to clone (a project of that name already exists here), or null. Refusing after the download,
   * as Clone did, made a person wait through every file to be told no (end-to-end test, 11-19).
   */
  refuse?: (aProjectName: string) => string | null,
  /**
   * The project to open, by its path in the repository, when the person chose it already (a row
   * of the repository's projects): no "Open which one?". It has to be one the tree still holds.
   */
  project?: string,
): Promise<{ files: ProjectFile[]; link: GitLink; project: string } | null> {
  const owner = repo.owner.login;
  const branch = repo.default_branch || 'main';
  const head = await getBranchHead(f, owner, repo.name, branch);
  if (!head)
    throw new GitSyncError(
      wxFormat(_('%s is empty: there is no project in it yet.'), `${owner}/${repo.name}`),
    );
  const commit = await getCommit(f, owner, repo.name, head);
  const tree = await getTree(f, owner, repo.name, commit.tree.sha);
  const projects = projectsInTree(tree);
  if (projects.length === 0)
    throw new GitSyncError(_('No project files were found in the repository.'));
  if (project !== undefined && !projects.includes(project))
    throw new GitSyncError(wxFormat(_('%s is no longer in %s.'), project, `${owner}/${repo.name}`));
  const pro = project ?? (projects.length > 1 ? await choose(projects) : projects[0]!);
  if (!pro) return null;
  const refusal = refuse?.(pro.slice(pro.lastIndexOf('/') + 1).replace(/\.kicad_pro$/i, ''));
  if (refusal) throw new GitSyncError(refusal);
  const slash = pro.lastIndexOf('/');
  const dir = slash < 0 ? '' : pro.slice(0, slash + 1);
  const view = remoteView(tree, dir);
  if (view.size > MAX_CLONE_FILES)
    throw new GitSyncError(
      wxFormat(
        _('That project has %d files; more than %d cannot be opened from GitHub yet.'),
        view.size,
        MAX_CLONE_FILES,
      ),
    );
  const files = await fetchBlobs(f, { owner, repo: repo.name }, [...view.keys()], view, onProgress);
  return {
    files,
    link: {
      v: 1,
      owner,
      repo: repo.name,
      branch,
      dir,
      commit: head,
      tree: commit.tree.sha,
      files: Object.fromEntries([...view].map(([p, e]) => [p, e.sha])),
    },
    project: pro.slice(dir.length),
  };
}

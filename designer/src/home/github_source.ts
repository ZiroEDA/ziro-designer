// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
/**
 * A public GitHub repository's KiCad project, opened read-only like a demo
 * (#640): `/gh/<owner>/<repo>`, or `/gh/<owner>/<repo>/tree/<ref>/<path>`.
 *
 * In the app a GitHub project IS a demo whose id is that path (`gh/...`), so it
 * takes the demo's whole road - fetched by the manager, never persisted, the
 * read-only strip, Save a copy - and only the fetch differs.
 *
 * The fetch is the one KiCanvas makes, measured from a browser origin
 * (2026-09-27, again 10-10):
 *  - `api.github.com/repos/<o>/<r>/git/trees/<ref>?recursive=1` answers any
 *    origin, but counts against 60 requests an hour per visitor IP without a
 *    login - so it is called ONCE per open, for the file list.
 *  - `raw.githubusercontent.com/<o>/<r>/<ref>/<path>` answers any origin and is
 *    not counted. One per file.
 *  - The repository zip (`codeload.github.com`) does not allow our origin, so
 *    the one-request open a demo has is out without a proxy.
 *
 * Only what a KiCad project reads is fetched - its own files, the library
 * tables and the project's libraries, under the `.kicad_pro`'s folder. 3D
 * models, gerbers, PDFs and images are left on GitHub: they are most of a
 * repository's bytes and nothing shows a schematic or a board with them.
 */
import type { PickedHomeFile } from './files.js';
import type { DemoMeta } from './demos.js';
import { mapLimit } from '../map_limit.js';
import { githubIdFor, type GithubSpec } from './github_id.js';

export { githubIdFor, githubSpecFromId, githubSpecFromUrl, isGithubId } from './github_id.js';
export type { GithubSpec } from './github_id.js';

/** One entry of the git tree. */
export interface TreeEntry {
  path: string;
  type: 'blob' | 'tree' | 'commit';
  size?: number;
}

/**
 * Every `.kicad_pro` in the tree, the likeliest first: shallowest, then a whole
 * project (its `.kicad_sch` AND `.kicad_pcb` beside it) before a partial one,
 * then by path. kaminaris/GigaESC-TOLT keeps `CardInterfaces-preview.kicad_pro`
 * (a board only) beside `GigaTOLT.kicad_pro`; by path alone the preview won.
 */
export function kicadProjectsIn(tree: readonly TreeEntry[]): string[] {
  const blobs = new Set(tree.filter((e) => e.type === 'blob').map((e) => e.path));
  const depth = (p: string): number => p.split('/').length;
  const whole = (p: string): number => {
    const stem = p.slice(0, -'.kicad_pro'.length);
    return blobs.has(`${stem}.kicad_sch`) && blobs.has(`${stem}.kicad_pcb`) ? 0 : 1;
  };
  return [...blobs]
    .filter((p) => p.endsWith('.kicad_pro'))
    .sort((a, b) => depth(a) - depth(b) || whole(a) - whole(b) || (a < b ? -1 : a > b ? 1 : 0));
}

/**
 * The project to open. A path that is a `.kicad_pro` is that one; a path that
 * is a folder is the shallowest project under it; no path is the shallowest in
 * the repository. (Choosing among several is stage 2's chooser.)
 */
export function pickProject(projects: readonly string[], path?: string): string | null {
  if (!path) return projects[0] ?? null;
  if (path.endsWith('.kicad_pro')) return projects.includes(path) ? path : null;
  const under = `${path.replace(/\/$/, '')}/`;
  return projects.find((p) => p.startsWith(under)) ?? null;
}

/** What a KiCad project reads: its own files, the lib tables, its libraries. */
const WANTED =
  /\.(kicad_pro|kicad_prl|kicad_sch|kicad_pcb|kicad_sym|kicad_mod|kicad_dru|kicad_wks|lib|dcm)$|(^|\/)(sym-lib-table|fp-lib-table)$/;

/** At most this many files: a fetch per file, and a repository can hold thousands. */
export const MAX_FILES = 600;

/**
 * The tree entries to fetch for a project: wanted files under its folder, but
 * no OTHER project's `.kicad_pro`/`.kicad_prl` - the manager opens the one
 * project file it is given, and a second beside it was the one it opened.
 */
export function filesForProject(tree: readonly TreeEntry[], proPath: string): TreeEntry[] {
  const slash = proPath.lastIndexOf('/');
  const dir = slash < 0 ? '' : proPath.slice(0, slash + 1);
  const stem = proPath.slice(0, -'.kicad_pro'.length);
  return tree.filter(
    (e) =>
      e.type === 'blob' &&
      e.path.startsWith(dir) &&
      WANTED.test(e.path) &&
      (!/\.kicad_pr[ol]$/.test(e.path) || e.path.slice(0, -'.kicad_pro'.length) === stem),
  );
}

/** A Git LFS pointer: what raw.githubusercontent serves for an LFS file. */
export function isLfsPointer(text: string): boolean {
  return text.startsWith('version https://git-lfs.github.com/spec/v1');
}

/** Why an open failed, in words for the person who pasted the link. */
export class GithubOpenError extends Error {}

const dec = new TextDecoder();
const FETCH_CONCURRENCY = 8;

const encodePath = (p: string): string => p.split('/').map(encodeURIComponent).join('/');

/** "after 14:05", from GitHub's X-RateLimit-Reset (epoch seconds). */
function retryAt(res: Response): string {
  const reset = Number(res.headers.get('x-ratelimit-reset'));
  if (!reset) return 'in an hour';
  const at = new Date(reset * 1000);
  return `after ${at.getHours().toString().padStart(2, '0')}:${at.getMinutes().toString().padStart(2, '0')}`;
}

/**
 * Fetch a GitHub project, whole, as the files a demo opens with, and the
 * `DemoMeta` that stands for it.
 */
export async function openGithubProject(
  spec: GithubSpec,
  onProgress?: (done: number, total: number, file: string) => void,
  fetchFn: typeof fetch = (...a) => fetch(...a),
): Promise<{ files: PickedHomeFile[]; meta: DemoMeta }> {
  const ref = spec.ref ?? 'HEAD';
  const where = `${spec.owner}/${spec.repo}`;
  const treeRes = await fetchFn(
    `https://api.github.com/repos/${encodeURIComponent(spec.owner)}/${encodeURIComponent(spec.repo)}/git/trees/${encodeURIComponent(ref)}?recursive=1`,
    { headers: { Accept: 'application/vnd.github+json' } },
  );
  if (treeRes.status === 403 || treeRes.status === 429) {
    if (treeRes.headers.get('x-ratelimit-remaining') === '0')
      throw new GithubOpenError(
        `GitHub allows 60 project opens an hour from one address, and this one has used them. Try again ${retryAt(treeRes)}.`,
      );
  }
  if (treeRes.status === 404 || treeRes.status === 409 || treeRes.status === 422)
    throw new GithubOpenError(
      spec.ref
        ? `No public repository ${where} with a branch, tag or commit "${spec.ref}" on GitHub.`
        : `No public repository ${where} on GitHub. Private repositories cannot be opened yet.`,
    );
  if (!treeRes.ok) throw new GithubOpenError(`GitHub answered ${treeRes.status} for ${where}.`);
  const tree = ((await treeRes.json()) as { tree?: TreeEntry[] }).tree ?? [];

  const pro = pickProject(kicadProjectsIn(tree), spec.path);
  if (!pro)
    throw new GithubOpenError(
      spec.path
        ? `There is no KiCad project (.kicad_pro) at ${spec.path} in ${where}.`
        : `${where} has no KiCad project (.kicad_pro) in it.`,
    );
  const wanted = filesForProject(tree, pro);
  if (wanted.length > MAX_FILES)
    throw new GithubOpenError(
      `That project has ${wanted.length} files to fetch; more than ${MAX_FILES} cannot be opened from GitHub yet.`,
    );

  const slash = pro.lastIndexOf('/');
  const dir = slash < 0 ? '' : pro.slice(0, slash + 1);
  // The project's folder name, as a demo's `base` is: the repository's name
  // when the project sits at its root.
  const base = dir ? dir.slice(0, -1).split('/').pop()! : spec.repo;
  const raw = (p: string): string =>
    `https://raw.githubusercontent.com/${encodeURIComponent(spec.owner)}/${encodeURIComponent(spec.repo)}/${encodeURIComponent(ref)}/${encodePath(p)}`;
  const lfs = (p: string): string =>
    `https://media.githubusercontent.com/media/${encodeURIComponent(spec.owner)}/${encodeURIComponent(spec.repo)}/${encodeURIComponent(ref)}/${encodePath(p)}`;

  let done = 0;
  const files = await mapLimit(wanted, FETCH_CONCURRENCY, async (e) => {
    let res = await fetchFn(raw(e.path));
    if (!res.ok)
      throw new GithubOpenError(`Could not fetch ${e.path} from GitHub (${res.status}).`);
    let bytes = new Uint8Array(await res.arrayBuffer());
    // An LFS-tracked file comes back as its pointer; the bytes are on the media host.
    if (bytes.length < 1024 && isLfsPointer(dec.decode(bytes))) {
      res = await fetchFn(lfs(e.path));
      if (!res.ok)
        throw new GithubOpenError(`Could not fetch ${e.path} from GitHub's LFS (${res.status}).`);
      bytes = new Uint8Array(await res.arrayBuffer());
    }
    done += 1;
    onProgress?.(done, wanted.length, e.path);
    const file: PickedHomeFile = {
      name: `${base}/${e.path.slice(dir.length)}`,
      text: dec.decode(bytes),
      bytes,
    };
    return file;
  });

  const id = githubIdFor(spec);
  const meta: DemoMeta = {
    id,
    base,
    title: spec.path ? `${where}/${spec.path}` : where,
    description: `https://github.com/${where}`,
    files: files.map((f) => f.name.slice(base.length + 1)),
  };
  return { files, meta };
}

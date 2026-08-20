// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * The account's tree, over the project store we already have.
 *
 * `FileSystem` is what the chooser is written against; this is the only
 * implementation of it today. The store is keyed by project id and holds each
 * project as a flat list of relative paths, so the work here is the two
 * translations between that and a tree: an id becomes a folder at the root, and
 * the folders inside a project are re-derived from its paths by `dirLevel`.
 *
 * ## Two projects with the same name
 *
 * The store does not require names to be unique — nothing ever stopped a
 * person from saving `Blinky` twice — but a directory does. Newer duplicates
 * are shown as `Blinky (2)`, `Blinky (3)` in creation order, and the project's
 * stored name is left alone: this is how the tree *displays* an ambiguity that
 * already exists, not a rename behind the user's back. Going forward the
 * ambiguity cannot be created here, because `mkproject` refuses a name that is
 * taken.
 */

import {
  type ProjectMeta,
  deleteProject,
  deleteProjectPath,
  listEmptyFolders,
  listProjectFiles,
  listProjects,
  readProjectFile,
  renameProject,
  renameProjectPath,
  saveProject,
  setEmptyFolders,
  updateProjectFiles,
} from '../home/projectStore.js';
import {
  type Entry,
  type FileSystem,
  type FlatFile,
  FsError,
  FsErrorCode,
  dirLevel,
} from './filesystem.js';
import { ROOT, dirname, isValidName, isValidPath, join, normalize, segments } from './path.js';

/** A project, and how far into it a path reaches. */
interface Resolved {
  readonly meta: ProjectMeta;
  /** Project-relative, `''` for the project folder itself. */
  readonly rel: string;
  /** Absolute path of the project folder. */
  readonly base: string;
}

/**
 * Every project, keyed by the name the tree shows for it.
 *
 * Oldest first, so the project that has been called `Blinky` the longest keeps
 * the bare name and a later namesake takes the suffix. Sorting the other way
 * would move an existing project's path whenever a new one was saved.
 */
async function byDisplayName(): Promise<Map<string, ProjectMeta>> {
  const all = [...(await listProjects())].sort((a, b) => a.createdAt - b.createdAt);
  const out = new Map<string, ProjectMeta>();
  for (const p of all) {
    let name = p.name;
    for (let n = 2; out.has(name); n++) name = `${p.name} (${n})`;
    out.set(name, p);
  }
  return out;
}

function entryForProject(name: string, p: ProjectMeta): Entry {
  return {
    name,
    path: join(ROOT, name),
    kind: 'project',
    // A project is a folder, and a folder shows no size.
    size: null,
    modified: p.updatedAt,
  };
}

/**
 * The project a path belongs to, or null.
 *
 * The chooser hands back a path, and everything a launcher does with a project
 * — open it, rename it, delete it — is keyed by id. This is the one place that
 * translation is written, so a caller never has to know that the root segment
 * is a project name with duplicates disambiguated.
 */
export async function projectAt(path: string): Promise<ProjectMeta | null> {
  const name = segments(normalize(path))[0];
  if (name === undefined) return null;
  return (await byDisplayName()).get(name) ?? null;
}

export function projectStoreFileSystem(): FileSystem {
  const resolve = async (path: string): Promise<Resolved> => {
    if (!isValidPath(path)) throw new FsError(FsErrorCode.INVALID, path);
    const parts = segments(path);
    const projectName = parts[0];
    if (projectName === undefined) throw new FsError(FsErrorCode.NOT_IN_PROJECT, path);
    const meta = (await byDisplayName()).get(projectName);
    if (!meta) throw new FsError(FsErrorCode.NOT_FOUND, path);
    return { meta, rel: parts.slice(1).join('/'), base: join(ROOT, projectName) };
  };

  /** A project's files and its empty folders, as one level of a tree. */
  const levelOf = async (r: Resolved, at: string): Promise<Entry[]> => {
    const files = await listProjectFiles(r.meta.id);
    if (!files) throw new FsError(FsErrorCode.NOT_FOUND, r.base);
    const flat: FlatFile[] = files.map((f) => ({
      name: f.name,
      size: f.size,
      modified: f.modified,
    }));
    const entries = dirLevel(flat, r.rel, at);

    // The folders no file implies. They are listed at the same level and
    // carry the project's own time, having no file of their own to date them.
    const prefix = r.rel === '' ? '' : `${r.rel}/`;
    const seen = new Set(entries.map((e) => e.name));
    for (const folder of await listEmptyFolders(r.meta.id)) {
      if (!folder.startsWith(prefix)) continue;
      const name = folder.slice(prefix.length).split('/')[0];
      if (!name || seen.has(name)) continue;
      seen.add(name);
      entries.push({
        name,
        path: join(at, name),
        kind: 'folder',
        size: null,
        modified: r.meta.updatedAt,
      });
    }
    return entries;
  };

  const fs: FileSystem = {
    async list(dir) {
      const path = normalize(dir);
      if (path === ROOT) {
        const out: Entry[] = [];
        for (const [name, p] of await byDisplayName()) out.push(entryForProject(name, p));
        return out;
      }
      const r = await resolve(path);
      return levelOf(r, path);
    },

    async stat(path) {
      const p = normalize(path);
      if (p === ROOT)
        return { name: '', path: ROOT, kind: 'folder', size: null, modified: Date.now() };
      const parent = dirname(p);
      const name = segments(p).at(-1);
      const siblings = await fs.list(parent).catch(() => [] as Entry[]);
      return siblings.find((e) => e.name === name) ?? null;
    },

    async read(path) {
      const r = await resolve(normalize(path));
      if (r.rel === '') throw new FsError(FsErrorCode.NOT_A_DIRECTORY, path);
      const bytes = await readProjectFile(r.meta.id, r.rel);
      if (!bytes) throw new FsError(FsErrorCode.NOT_FOUND, path);
      return bytes;
    },

    async write(path, bytes) {
      const p = normalize(path);
      // Two different refusals share this shape, and saying which is which is
      // the point: `/Board` names a project, so writing to it is writing to a
      // directory, while `/loose.txt` is the root rule — upstream a file
      // belongs to the project directory it sits in, and this tree has no
      // other place. Resolving first would report both as "no such project",
      // which is true of one of them and the reason for neither.
      if (segments(p).length <= 1) {
        const known = (await byDisplayName()).has(segments(p)[0] ?? '');
        throw new FsError(known ? FsErrorCode.NOT_A_DIRECTORY : FsErrorCode.NOT_IN_PROJECT, p);
      }
      const r = await resolve(p);
      await updateProjectFiles(r.meta.id, [{ name: r.rel, bytes }]);
      // Whatever folder this file landed in is no longer empty, and neither is
      // any folder above it inside the project.
      const empty = await listEmptyFolders(r.meta.id);
      if (empty.length > 0) {
        const kept = empty.filter((d) => !(r.rel === d || r.rel.startsWith(`${d}/`)));
        if (kept.length !== empty.length) await setEmptyFolders(r.meta.id, kept);
      }
    },

    async mkdir(path) {
      const p = normalize(path);
      // Same rule as `write`: a folder at the root would be a project that is
      // not one, and `mkproject` is how a folder gets made there. An existing
      // project's own path is a folder that already exists.
      if (segments(p).length <= 1) {
        const known = (await byDisplayName()).has(segments(p)[0] ?? '');
        throw new FsError(known ? FsErrorCode.EXISTS : FsErrorCode.NOT_IN_PROJECT, p);
      }
      const r = await resolve(p);
      if (await fs.stat(p)) throw new FsError(FsErrorCode.EXISTS, p);
      const empty = await listEmptyFolders(r.meta.id);
      await setEmptyFolders(r.meta.id, [...empty, r.rel]);
    },

    async mkproject(path) {
      const p = normalize(path);
      const name = segments(p).at(-1);
      if (!name || !isValidName(name) || dirname(p) !== ROOT)
        throw new FsError(FsErrorCode.INVALID, p);
      if ((await byDisplayName()).has(name)) throw new FsError(FsErrorCode.EXISTS, p);
      await saveProject(name, []);
    },

    async rename(path, name) {
      const p = normalize(path);
      if (!isValidName(name)) throw new FsError(FsErrorCode.INVALID, name);
      const target = join(dirname(p), name);
      if (target !== p && (await fs.stat(target))) throw new FsError(FsErrorCode.EXISTS, target);
      const r = await resolve(p);
      if (r.rel === '') {
        await renameProject(r.meta.id, name);
        return;
      }
      const to = r.rel.includes('/') ? `${r.rel.slice(0, r.rel.lastIndexOf('/'))}/${name}` : name;
      if (!(await renameProjectPath(r.meta.id, r.rel, to)))
        throw new FsError(FsErrorCode.NOT_FOUND, p);
    },

    async remove(path) {
      const p = normalize(path);
      const r = await resolve(p);
      if (r.rel === '') {
        await deleteProject(r.meta.id);
        return;
      }
      await deleteProjectPath(r.meta.id, r.rel);
    },
  };

  return fs;
}

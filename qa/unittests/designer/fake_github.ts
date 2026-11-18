// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
/**
 * An in-memory GitHub for the Git loop's tests: the REST endpoints
 * designer/src/github/github_api.ts calls, answering as GitHub's documentation
 * and behaviour say they do.
 *
 * - Blob ids are git's real ones (SHA-1 of `blob <n>\0` + bytes), computed here
 *   with node:crypto - independently of `gitBlobSha` under test.
 * - An empty repository (created with `auto_init: false`) has no branch, and
 *   every Git-database write and ref read answers 409 "Git Repository is
 *   empty."; only `PUT /contents` gives it its first commit.
 * - `PATCH /git/refs` without `force` refuses (422) anything but a
 *   fast-forward.
 * - `base_tree` + `sha: null` deletes; deleting a path that is not there is
 *   an error, as GitHub documents.
 *
 * Trees and commits get opaque ids (a SHA-1 of their content); nothing under
 * test may assume more of them than that they are stable.
 */
import { createHash } from 'node:crypto';

export interface FakeCommit {
  tree: string;
  parents: string[];
  message: string;
}

export interface FakeRepo {
  owner: string;
  name: string;
  private: boolean;
  default_branch: string;
  refs: Map<string, string>;
  blobs: Map<string, Uint8Array>;
  /** Flat: full path -> blob id. */
  trees: Map<string, Map<string, string>>;
  commits: Map<string, FakeCommit>;
}

export interface Logged {
  method: string;
  path: string;
  body: unknown;
}

const sha1 = (data: string | Uint8Array): string => createHash('sha1').update(data).digest('hex');

export const gitBlobId = (bytes: Uint8Array): string =>
  sha1(Buffer.concat([Buffer.from(`blob ${bytes.length}\0`), Buffer.from(bytes)]));

const json = (status: number, body: unknown): Response =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });

const enc = new TextEncoder();

export class FakeGithub {
  readonly repos = new Map<string, FakeRepo>();
  readonly log: Logged[] = [];
  login = 'octo';
  /** Every Authorization header seen. */
  readonly auth: string[] = [];

  repo(owner: string, name: string): FakeRepo {
    const r = this.repos.get(`${owner}/${name}`);
    if (!r) throw new Error(`no repo ${owner}/${name}`);
    return r;
  }

  addRepo(name: string, opts: { private?: boolean; default_branch?: string } = {}): FakeRepo {
    const r: FakeRepo = {
      owner: this.login,
      name,
      private: opts.private ?? true,
      default_branch: opts.default_branch ?? 'main',
      refs: new Map(),
      blobs: new Map(),
      trees: new Map(),
      commits: new Map(),
    };
    this.repos.set(`${this.login}/${name}`, r);
    return r;
  }

  putBlob(r: FakeRepo, bytes: Uint8Array): string {
    const id = gitBlobId(bytes);
    r.blobs.set(id, bytes);
    return id;
  }

  putTree(r: FakeRepo, files: Map<string, string>): string {
    const id = sha1(
      `tree\n${[...files]
        .sort()
        .map(([p, s]) => `${p} ${s}`)
        .join('\n')}`,
    );
    r.trees.set(id, new Map(files));
    return id;
  }

  putCommit(r: FakeRepo, c: FakeCommit): string {
    const id = sha1(`commit\n${c.tree}\n${c.parents.join(',')}\n${c.message}\n${r.commits.size}`);
    r.commits.set(id, c);
    return id;
  }

  /** A commit on `branch` holding exactly these files (text), on top of its head. */
  commitFiles(
    r: FakeRepo,
    branch: string,
    files: Record<string, string | Uint8Array>,
    message = 'remote change',
  ): string {
    const map = new Map<string, string>();
    for (const [p, v] of Object.entries(files))
      map.set(p, this.putBlob(r, typeof v === 'string' ? enc.encode(v) : v));
    const head = r.refs.get(branch);
    const id = this.putCommit(r, {
      tree: this.putTree(r, map),
      parents: head ? [head] : [],
      message,
    });
    r.refs.set(branch, id);
    return id;
  }

  /** The files of a branch's head, decoded as text. */
  filesAt(r: FakeRepo, branch: string): Record<string, string> {
    const head = r.refs.get(branch)!;
    const tree = r.trees.get(r.commits.get(head)!.tree)!;
    const out: Record<string, string> = {};
    for (const [p, s] of tree) out[p] = new TextDecoder().decode(r.blobs.get(s)!);
    return out;
  }

  private isAncestor(r: FakeRepo, ancestor: string, of: string): boolean {
    const seen = new Set<string>();
    const stack = [of];
    while (stack.length) {
      const c = stack.pop()!;
      if (c === ancestor) return true;
      if (seen.has(c)) continue;
      seen.add(c);
      stack.push(...(r.commits.get(c)?.parents ?? []));
    }
    return false;
  }

  readonly fetch = async (
    input: string | URL | Request,
    init: RequestInit = {},
  ): Promise<Response> => {
    const url = new URL(String(input));
    const method = (init.method ?? 'GET').toUpperCase();
    const body = init.body ? JSON.parse(String(init.body)) : undefined;
    const auth = new Headers(init.headers).get('Authorization');
    if (auth) this.auth.push(auth);
    this.log.push({ method, path: url.pathname + url.search, body });
    if (url.origin !== 'https://api.github.com') return json(404, { message: 'Not Found' });
    return this.route(method, url, body);
  };

  /** The requests that write something, in order. */
  writes(): Logged[] {
    return this.log.filter((l) => l.method !== 'GET');
  }

  private route(method: string, url: URL, body: any): Response {
    const p = url.pathname.split('/').filter(Boolean).map(decodeURIComponent);
    if (method === 'GET' && url.pathname === '/user') return json(200, { login: this.login });
    if (method === 'POST' && url.pathname === '/user/repos') {
      if (this.repos.has(`${this.login}/${body.name}`))
        return json(422, {
          message: 'Repository creation failed.',
          errors: [
            {
              resource: 'Repository',
              code: 'custom',
              message: 'name already exists on this account',
            },
          ],
        });
      const r = this.addRepo(body.name, { private: body.private });
      return json(201, {
        name: r.name,
        full_name: `${r.owner}/${r.name}`,
        owner: { login: r.owner },
        private: r.private,
        default_branch: r.default_branch,
      });
    }
    if (method === 'GET' && url.pathname === '/user/repos') {
      const page = Number(url.searchParams.get('page') ?? '1');
      const all = [...this.repos.values()].map((r) => ({
        name: r.name,
        full_name: `${r.owner}/${r.name}`,
        owner: { login: r.owner },
        private: r.private,
        default_branch: r.default_branch,
      }));
      return json(200, all.slice((page - 1) * 100, page * 100));
    }
    if (p[0] !== 'repos' || p.length < 4) return json(404, { message: 'Not Found' });
    const r = this.repos.get(`${p[1]}/${p[2]}`);
    if (!r) return json(404, { message: 'Not Found' });
    const empty = r.refs.size === 0;
    const rest = p.slice(3);

    if (rest[0] === 'contents' && method === 'PUT') {
      const path = rest.slice(1).join('/');
      const branch: string = body.branch ?? r.default_branch;
      const bytes = new Uint8Array(Buffer.from(body.content, 'base64'));
      const head = r.refs.get(branch);
      const files = new Map(head ? r.trees.get(r.commits.get(head)!.tree)! : []);
      files.set(path, this.putBlob(r, bytes));
      const tree = this.putTree(r, files);
      const commit = this.putCommit(r, {
        tree,
        parents: head ? [head] : [],
        message: body.message,
      });
      r.refs.set(branch, commit);
      return json(201, { content: { path }, commit: { sha: commit, tree: { sha: tree } } });
    }
    if (rest[0] === 'branches' && method === 'GET') {
      if (empty) return json(200, []);
      return json(
        200,
        [...r.refs].map(([name, sha]) => ({ name, commit: { sha } })),
      );
    }
    if (rest[0] !== 'git') return json(404, { message: 'Not Found' });
    if (empty) return json(409, { message: 'Git Repository is empty.' });

    const kind = rest[1];
    if (kind === 'ref' && method === 'GET') {
      const branch = rest.slice(3).join('/');
      const sha = r.refs.get(branch);
      return sha ? json(200, { object: { sha } }) : json(404, { message: 'Not Found' });
    }
    if (kind === 'refs' && method === 'PATCH') {
      const branch = rest.slice(3).join('/');
      const old = r.refs.get(branch);
      if (!old) return json(422, { message: 'Reference does not exist' });
      if (!r.commits.has(body.sha)) return json(422, { message: 'Object does not exist' });
      if (!body.force && !this.isAncestor(r, old, body.sha))
        return json(422, { message: 'Update is not a fast forward' });
      r.refs.set(branch, body.sha);
      return json(200, { object: { sha: body.sha } });
    }
    if (kind === 'refs' && method === 'POST') {
      const branch = String(body.ref).replace(/^refs\/heads\//, '');
      if (r.refs.has(branch)) return json(422, { message: 'Reference already exists' });
      r.refs.set(branch, body.sha);
      return json(201, { object: { sha: body.sha } });
    }
    if (kind === 'commits' && method === 'GET') {
      const c = r.commits.get(rest[2]!);
      if (!c) return json(404, { message: 'Not Found' });
      return json(200, {
        sha: rest[2],
        tree: { sha: c.tree },
        parents: c.parents.map((sha) => ({ sha })),
      });
    }
    if (kind === 'commits' && method === 'POST') {
      if (!r.trees.has(body.tree)) return json(422, { message: 'Tree SHA does not exist' });
      const id = this.putCommit(r, {
        tree: body.tree,
        parents: body.parents,
        message: body.message,
      });
      return json(201, { sha: id });
    }
    if (kind === 'trees' && method === 'GET') {
      const t = r.trees.get(rest[2]!);
      if (!t) return json(404, { message: 'Not Found' });
      const dirs = new Set<string>();
      for (const path of t.keys()) {
        const parts = path.split('/');
        for (let i = 1; i < parts.length; i++) dirs.add(parts.slice(0, i).join('/'));
      }
      return json(200, {
        sha: rest[2],
        tree: [
          ...[...dirs].map((path) => ({ path, mode: '040000', type: 'tree', sha: sha1(path) })),
          ...[...t].map(([path, sha]) => ({
            path,
            mode: '100644',
            type: 'blob',
            sha,
            size: r.blobs.get(sha)!.length,
          })),
        ],
        truncated: false,
      });
    }
    if (kind === 'trees' && method === 'POST') {
      const files = new Map<string, string>();
      if (body.base_tree) {
        const base = r.trees.get(body.base_tree);
        if (!base) return json(422, { message: 'base_tree is not a valid tree oid' });
        for (const [k, v] of base) files.set(k, v);
      }
      for (const e of body.tree) {
        if ('content' in e && 'sha' in e) return json(422, { message: 'content and sha both set' });
        if ('content' in e) files.set(e.path, this.putBlob(r, enc.encode(e.content)));
        else if (e.sha === null) {
          if (!files.has(e.path)) return json(422, { message: `${e.path} does not exist` });
          files.delete(e.path);
        } else {
          if (!r.blobs.has(e.sha)) return json(422, { message: 'sha does not exist' });
          files.set(e.path, e.sha);
        }
      }
      return json(201, { sha: this.putTree(r, files) });
    }
    if (kind === 'blobs' && method === 'POST') {
      const bytes = new Uint8Array(
        Buffer.from(body.content, body.encoding === 'base64' ? 'base64' : 'utf8'),
      );
      return json(201, { sha: this.putBlob(r, bytes) });
    }
    if (kind === 'blobs' && method === 'GET') {
      const b = r.blobs.get(rest[2]!);
      if (!b) return json(404, { message: 'Not Found' });
      // GitHub wraps its base64 at 60 columns.
      const b64 = Buffer.from(b)
        .toString('base64')
        .replace(/(.{60})/g, '$1\n');
      return json(200, { content: b64, encoding: 'base64', size: b.length });
    }
    return json(404, { message: 'Not Found' });
  }
}

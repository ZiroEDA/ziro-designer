// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
/**
 * Open from GitHub (#640): a public repository's KiCad project, opened
 * read-only as a demo whose id is its address path. The fetch runs against a
 * stubbed `fetch` shaped like GitHub's answers; a real open of
 * kaminaris/GigaESC-TOLT was checked in headless Chrome
 * (qa/probes/gh_open_probe.mjs): board and strip, signed out.
 */
import { describe, expect, it } from 'vitest';
import {
  GithubOpenCancelled,
  GithubOpenError,
  filesForProject,
  githubIdFor,
  githubSpecFromId,
  githubSpecFromUrl,
  isLfsPointer,
  kicadProjectsIn,
  openGithubProject,
  pickProject,
  type TreeEntry,
} from '@ziroeda/designer/src/home/github_source.js';
import { parseRoute, routeHref } from '@ziroeda/designer/src/nav/route.js';
import { explorerMayVisit } from '@ziroeda/designer/src/auth/explore.js';

const AT = 'https://designer.ziroeda.com';
const blob = (path: string): TreeEntry => ({ path, type: 'blob' });

describe('the GitHub id and address', () => {
  it('parses the repository, a ref and a path', () => {
    expect(githubSpecFromId('gh/kaminaris/GigaESC-TOLT')).toEqual({
      owner: 'kaminaris',
      repo: 'GigaESC-TOLT',
    });
    expect(githubSpecFromId('gh/o/r/tree/main/hw/board')).toEqual({
      owner: 'o',
      repo: 'r',
      ref: 'main',
      path: 'hw/board',
    });
    expect(githubSpecFromId('gh/o/r/tree/v1.2')).toEqual({ owner: 'o', repo: 'r', ref: 'v1.2' });
  });

  it('refuses what is not a place in a repository', () => {
    for (const bad of [
      'gh/o',
      'gh/o/r/blob/main',
      'gh/o/r/tree',
      'gh/o/r/tree/main/../x',
      'gh/o/r/tree/main//x',
      'gh/a b/r',
      'demo/o/r',
    ])
      expect(githubSpecFromId(bad), bad).toBeNull();
  });

  it('the id is the address path, and comes back the same', () => {
    for (const id of ['gh/o/r', 'gh/o/r/tree/main', 'gh/o/r/tree/main/hw/board.kicad_pro'])
      expect(githubIdFor(githubSpecFromId(id)!)).toBe(id);
  });

  it('a pasted GitHub link: the repository, a tree, a blob of the .kicad_pro, a .git clone URL', () => {
    expect(githubSpecFromUrl('https://github.com/kaminaris/GigaESC-TOLT')).toEqual({
      owner: 'kaminaris',
      repo: 'GigaESC-TOLT',
    });
    expect(githubSpecFromUrl('https://github.com/o/r.git')).toEqual({ owner: 'o', repo: 'r' });
    expect(githubSpecFromUrl('https://github.com/o/r/tree/main/hw')).toMatchObject({
      ref: 'main',
      path: 'hw',
    });
    expect(githubSpecFromUrl('https://github.com/o/r/blob/main/hw/a.kicad_pro')).toMatchObject({
      ref: 'main',
      path: 'hw/a.kicad_pro',
    });
    expect(githubSpecFromUrl('https://gitlab.com/o/r')).toBeNull();
    expect(githubSpecFromUrl('not a url')).toBeNull();
  });

  it('/gh/... is a demo route whose id is its path; a frame sits behind /-/', () => {
    expect(parseRoute(`${AT}/gh/kaminaris/GigaESC-TOLT`)).toEqual({
      kind: 'demo',
      id: 'gh/kaminaris/GigaESC-TOLT',
    });
    // A folder called pcb is a path, not a frame.
    expect(parseRoute(`${AT}/gh/o/r/tree/main/pcb`)).toEqual({
      kind: 'demo',
      id: 'gh/o/r/tree/main/pcb',
    });
    expect(parseRoute(`${AT}/gh/o/r/-/pcb/3d`)).toEqual({
      kind: 'demo',
      id: 'gh/o/r',
      view: 'pcb',
      child: '3d',
    });
    expect(parseRoute(`${AT}/gh/o/r/-/nonsense`)).toEqual({ kind: 'home' });
    expect(parseRoute(`${AT}/gh/o`)).toEqual({ kind: 'home' });
  });

  it('round-trips through routeHref', () => {
    for (const path of [
      '/gh/o/r',
      '/gh/o/r/tree/main/hw',
      '/gh/o/r/-/schematic',
      '/gh/o/r/tree/v2/x/-/pcb/3d',
    ]) {
      expect(routeHref(parseRoute(`${AT}${path}`))).toBe(path);
    }
    // A demo's own address is unchanged.
    expect(routeHref({ kind: 'demo', id: 'cm5_minima', view: 'pcb' })).toBe('/demo/cm5_minima/pcb');
  });

  it('opens signed out: a link people share must not meet a wall', () => {
    expect(explorerMayVisit(parseRoute(`${AT}/gh/o/r/-/pcb`))).toBe(true);
  });
});

describe('which project, which files', () => {
  it('kaminaris/GigaESC-TOLT: the whole project, not the board-only preview beside it', () => {
    const tree = [
      blob('CardInterfaces-preview.kicad_pro'),
      blob('CardInterfaces-preview.kicad_pcb'),
      blob('GigaTOLT.kicad_pro'),
      blob('GigaTOLT.kicad_sch'),
      blob('GigaTOLT.kicad_pcb'),
    ];
    expect(kicadProjectsIn(tree)[0]).toBe('GigaTOLT.kicad_pro');
  });

  it('shallowest first; then by path', () => {
    const tree = [
      blob('b/x.kicad_pro'),
      blob('a/y.kicad_pro'),
      blob('deep/er/z.kicad_pro'),
      blob('top.kicad_pro'),
    ];
    expect(kicadProjectsIn(tree)).toEqual([
      'top.kicad_pro',
      'a/y.kicad_pro',
      'b/x.kicad_pro',
      'deep/er/z.kicad_pro',
    ]);
  });

  it('a path picks a project file, or the first project under a folder', () => {
    const projects = ['top.kicad_pro', 'hw/a.kicad_pro', 'hw/b/c.kicad_pro'];
    expect(pickProject(projects)).toBe('top.kicad_pro');
    expect(pickProject(projects, 'hw')).toBe('hw/a.kicad_pro');
    expect(pickProject(projects, 'hw/b/c.kicad_pro')).toBe('hw/b/c.kicad_pro');
    expect(pickProject(projects, 'nope')).toBeNull();
    expect(pickProject(projects, 'hw/missing.kicad_pro')).toBeNull();
  });

  it('fetches what a project reads under its folder, no other project file, no 3D or gerbers', () => {
    const tree: TreeEntry[] = [
      blob('hw/a.kicad_pro'),
      blob('hw/a.kicad_prl'),
      blob('hw/a.kicad_sch'),
      blob('hw/sub.kicad_sch'),
      blob('hw/a.kicad_pcb'),
      blob('hw/other.kicad_pro'),
      blob('hw/other.kicad_prl'),
      blob('hw/sym-lib-table'),
      blob('hw/fp-lib-table'),
      blob('hw/lib.pretty/R.kicad_mod'),
      blob('hw/lib.kicad_sym'),
      blob('hw/3d/R.step'),
      blob('hw/gerbers/a-F_Cu.gbr'),
      blob('hw/a.pdf'),
      blob('README.md'),
      blob('elsewhere/x.kicad_sch'),
      { path: 'hw/lib.pretty', type: 'tree' },
    ];
    expect(filesForProject(tree, 'hw/a.kicad_pro').map((e) => e.path)).toEqual([
      'hw/a.kicad_pro',
      'hw/a.kicad_prl',
      'hw/a.kicad_sch',
      'hw/sub.kicad_sch',
      'hw/a.kicad_pcb',
      'hw/sym-lib-table',
      'hw/fp-lib-table',
      'hw/lib.pretty/R.kicad_mod',
      'hw/lib.kicad_sym',
    ]);
  });

  it('recognises a Git LFS pointer', () => {
    expect(
      isLfsPointer('version https://git-lfs.github.com/spec/v1\noid sha256:abc\nsize 12\n'),
    ).toBe(true);
    expect(isLfsPointer('(kicad_pcb (version 20241229))')).toBe(false);
  });
});

/** A `fetch` that answers like GitHub, from a table of URL -> response. */
function github(routes: Record<string, Response | (() => Response)>): {
  fetch: typeof fetch;
  asked: string[];
} {
  const asked: string[] = [];
  const f = (async (input: RequestInfo | URL) => {
    const url = String(input);
    asked.push(url);
    const r = routes[url];
    if (!r) return new Response('not found', { status: 404 });
    return typeof r === 'function' ? r() : r.clone();
  }) as typeof fetch;
  return { fetch: f, asked };
}
const json = (v: unknown, init: ResponseInit = {}) =>
  new Response(JSON.stringify(v), { status: 200, ...init });
const TREE = 'https://api.github.com/repos/o/r/git/trees/HEAD?recursive=1';
const RAW = 'https://raw.githubusercontent.com/o/r/HEAD/';

describe('openGithubProject', () => {
  it('one tree call, a raw fetch per file, named under the project folder as a demo is', async () => {
    const gh = github({
      [TREE]: json({ tree: [blob('hw/a.kicad_pro'), blob('hw/a.kicad_sch'), blob('docs/x.pdf')] }),
      [`${RAW}hw/a.kicad_pro`]: new Response('{}'),
      [`${RAW}hw/a.kicad_sch`]: new Response('(kicad_sch)'),
    });
    const { files, meta } = await openGithubProject({ owner: 'o', repo: 'r' }, undefined, gh.fetch);
    expect(files.map((f) => [f.name, f.text])).toEqual([
      ['hw/a.kicad_pro', '{}'],
      ['hw/a.kicad_sch', '(kicad_sch)'],
    ]);
    expect(meta).toMatchObject({ id: 'gh/o/r', base: 'hw', title: 'o/r' });
    expect(gh.asked.filter((u) => u.startsWith('https://api.github.com'))).toHaveLength(1);
  });

  it("a project at the repository's root is named after the repository", async () => {
    const gh = github({
      [TREE]: json({ tree: [blob('a.kicad_pro')] }),
      [`${RAW}a.kicad_pro`]: new Response('{}'),
    });
    const { files, meta } = await openGithubProject({ owner: 'o', repo: 'r' }, undefined, gh.fetch);
    expect(meta.base).toBe('r');
    expect(files[0]!.name).toBe('r/a.kicad_pro');
  });

  it('an LFS pointer is followed to the media host', async () => {
    const gh = github({
      [TREE]: json({ tree: [blob('a.kicad_pro'), blob('a.kicad_pcb')] }),
      [`${RAW}a.kicad_pro`]: new Response('{}'),
      [`${RAW}a.kicad_pcb`]: new Response(
        'version https://git-lfs.github.com/spec/v1\noid sha256:1\nsize 9\n',
      ),
      'https://media.githubusercontent.com/media/o/r/HEAD/a.kicad_pcb': new Response('(kicad_pcb)'),
    });
    const { files } = await openGithubProject({ owner: 'o', repo: 'r' }, undefined, gh.fetch);
    expect(files.find((f) => f.name.endsWith('.kicad_pcb'))!.text).toBe('(kicad_pcb)');
  });

  it('the rate limit is said plainly, with when to retry', async () => {
    const reset = Math.floor(new Date(2026, 9, 10, 14, 5).getTime() / 1000);
    const gh = github({
      [TREE]: new Response('{}', {
        status: 403,
        headers: { 'x-ratelimit-remaining': '0', 'x-ratelimit-reset': String(reset) },
      }),
    });
    const err = await openGithubProject({ owner: 'o', repo: 'r' }, undefined, gh.fetch).catch(
      (e) => e,
    );
    expect(err).toBeInstanceOf(GithubOpenError);
    expect(err.message).toContain('60 project opens an hour');
    expect(err.message).toContain('after 14:05');
  });

  it('no such public repository, and no project in one', async () => {
    const missing = await openGithubProject(
      { owner: 'o', repo: 'r' },
      undefined,
      github({}).fetch,
    ).catch((e) => e);
    expect(missing).toBeInstanceOf(GithubOpenError);
    expect(missing.message).toMatch(/No public repository o\/r/);
    const empty = await openGithubProject(
      { owner: 'o', repo: 'r' },
      undefined,
      github({ [TREE]: json({ tree: [blob('README.md')] }) }).fetch,
    ).catch((e) => e);
    expect(empty).toBeInstanceOf(GithubOpenError);
    expect(empty.message).toMatch(/has no KiCad project/);
  });
});

describe('the board editor starts the zstd codec before it parses', () => {
  it('a KiCad 9 board with embedded files opens (it failed: "InitCodec() has not completed")', async () => {
    const { readFileSync } = await import('node:fs');
    const src = readFileSync(
      new URL('../../../pcbnew/pcb_edit_frame_ui.tsx', import.meta.url),
      'utf8',
    );
    const init = src.indexOf('await EMBEDDED_FILES.InitCodec();');
    const parse = src.indexOf('ParseBoard(textRef.current)');
    expect(init).toBeGreaterThan(-1);
    expect(parse).toBeGreaterThan(init);
    // The only place the editor parses the board it opens.
    expect(src.split('ParseBoard(textRef.current)').length - 1).toBe(1);
  });
});

describe('several projects in one repository: the chooser', () => {
  const two = () =>
    github({
      [TREE]: json({ tree: [blob('a/x.kicad_pro'), blob('b/y.kicad_pro')] }),
      [`${RAW}a/x.kicad_pro`]: new Response('{}'),
      [`${RAW}b/y.kicad_pro`]: new Response('{}'),
    });

  it('asks, with every project, likeliest first; the choice goes into the id', async () => {
    let offered: readonly string[] = [];
    const { files, meta } = await openGithubProject(
      { owner: 'o', repo: 'r' },
      undefined,
      two().fetch,
      async (p) => {
        offered = p;
        return 'b/y.kicad_pro';
      },
    );
    expect(offered).toEqual(['a/x.kicad_pro', 'b/y.kicad_pro']);
    expect(files.map((f) => f.name)).toEqual(['b/y.kicad_pro']);
    // A reload, or the link passed on, opens that project without asking.
    expect(meta.id).toBe('gh/o/r/tree/HEAD/b/y.kicad_pro');
    // ...and App can still match it to the request for the repository.
    expect(meta.requestedAs).toBe('gh/o/r');
  });

  it('Cancel opens nothing', async () => {
    const err = await openGithubProject(
      { owner: 'o', repo: 'r' },
      undefined,
      two().fetch,
      async () => null,
    ).catch((e) => e);
    expect(err).toBeInstanceOf(GithubOpenCancelled);
  });

  it('does not ask when there is one project, or a path picked one', async () => {
    let asked = 0;
    const ask = async () => {
      asked++;
      return null;
    };
    const one = github({
      [TREE]: json({ tree: [blob('a/x.kicad_pro')] }),
      [`${RAW}a/x.kicad_pro`]: new Response('{}'),
    });
    const single = await openGithubProject({ owner: 'o', repo: 'r' }, undefined, one.fetch, ask);
    expect(single.meta.requestedAs).toBeUndefined();
    const tree2 = 'https://api.github.com/repos/o/r/git/trees/main?recursive=1';
    const pathed = github({
      [tree2]: json({ tree: [blob('a/x.kicad_pro'), blob('b/y.kicad_pro')] }),
      'https://raw.githubusercontent.com/o/r/main/b/y.kicad_pro': new Response('{}'),
    });
    const picked = await openGithubProject(
      { owner: 'o', repo: 'r', ref: 'main', path: 'b' },
      undefined,
      pathed.fetch,
      ask,
    );
    expect(picked.files.map((f) => f.name)).toEqual(['b/y.kicad_pro']);
    expect(asked).toBe(0);
  });
});

describe('App takes a chosen project as the open it asked for', () => {
  it('matches its pending request against requestedAs too, or every return home re-downloads', async () => {
    const { readFileSync } = await import('node:fs');
    const src = readFileSync(new URL('../../../designer/src/App.tsx', import.meta.url), 'utf8');
    const fn = src.slice(src.indexOf('const onDemoStateChange = useCallback('));
    const body = fn.slice(0, fn.indexOf('applyDemoFrame('));
    expect(body).toMatch(/id === demo\.requestedAs/);
    expect(body).toContain('setDemoRequest((r) => (isThis(r?.id) ? null : r));');
    expect(body).toContain('isThis(pending.id)');
  });
});

// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
/**
 * The project <-> GitHub repository loop (designer/src/github/github_project.ts) against an
 * in-memory GitHub (fake_github.ts) that answers as the REST API does - including the parts that
 * shaped the design: an empty repository refuses every Git-database write, and a branch update
 * without `force` must be a fast-forward.
 *
 * Expectations are file contents and request shapes, never values read back out of the module.
 */
import { describe, expect, it } from 'vitest';
import {
  GIT_LINK_FILE,
  GitBehindError,
  addBranch,
  branchNames,
  GitSyncError,
  KICAD_GITIGNORE_TEXT,
  type GitLink,
  type ProjectFile,
  changesBetween,
  cloneRepository,
  fetchPull,
  gitBlobSha,
  gitLinkBytes,
  gitLinkOf,
  isKicadIgnored,
  isSyncedPath,
  isValidBranchName,
  isValidRepoName,
  parseGitLink,
  planCommit,
  planPull,
  pushNewRepository,
  repoNameFor,
  runCommit,
} from '@ziroeda/designer/src/github/github_project.js';
import { FakeGithub, gitBlobId } from './fake_github.js';

const enc = new TextEncoder();
const dec = new TextDecoder();
const file = (name: string, text: string | Uint8Array): ProjectFile => ({
  name,
  bytes: typeof text === 'string' ? enc.encode(text) : text,
});

describe("git's blob id", () => {
  // Constants from `git hash-object`, not from any code here.
  it('is the id git gives the empty file and "hello\\n"', async () => {
    expect(await gitBlobSha(new Uint8Array(0))).toBe('e69de29bb2d1d6434b8b29ae775ad8c2e48c5391');
    expect(await gitBlobSha(enc.encode('hello\n'))).toBe(
      'ce013625030ba8dba906f756967f9e9ca394464a',
    );
  });
});

describe('which paths sync with the repository', () => {
  it("leaves out tooling folders, dotfiles and KiCad's own .gitignore seed", () => {
    for (const p of [
      '.git/config',
      '.history/1/board.kicad_pcb',
      '.github/workflows/ci.yml',
      '.gitignore',
      GIT_LINK_FILE,
      'sub/.DS_Store',
      'board-backups/board-2026.zip',
      'deep/x-backups/y.kicad_sch',
      '_autosave-board.kicad_pcb',
      'fp-info-cache',
      '~board.kicad_sch.lck',
      'board.kicad_prl',
    ])
      expect(isSyncedPath(p), p).toBe(false);
  });

  it('keeps the project, its libraries and its other files', () => {
    for (const p of [
      'board.kicad_pro',
      'board.kicad_sch',
      'board.kicad_pcb',
      'sym-lib-table',
      'lib.pretty/R_0603.kicad_mod',
      '3d/part.step',
      'README.md',
      // A FILE named like the backups folder is not the folder (`*-backups/` is dir-only).
      'notes-backups',
    ])
      expect(isSyncedPath(p), p).toBe(true);
  });

  it('reads the dir-only patterns as git does', () => {
    expect(isKicadIgnored('a/proj-backups/b.zip')).toBe(true);
    expect(isKicadIgnored('proj-backups')).toBe(false);
    expect(isKicadIgnored('x/_autosave-y.kicad_sch')).toBe(true);
  });

  it("writes KiCad's seed as KiCad writes it into a new repository", () => {
    // common/git/git_init_handler.cpp:42-45 and :90-95.
    expect(KICAD_GITIGNORE_TEXT).toBe(
      '# KiCad-generated files and directories.\n.history/\n*-backups/\n_autosave-*\nfp-info-cache\n~*.lck\n*.kicad_prl\n',
    );
  });
});

describe('the link file', () => {
  const link: GitLink = {
    v: 1,
    owner: 'o',
    repo: 'r',
    branch: 'main',
    dir: '',
    commit: 'c1',
    tree: 't1',
  };
  it('round-trips, and is found among the project files', () => {
    expect(parseGitLink(gitLinkBytes(link))).toEqual(link);
    expect(
      gitLinkOf([file('a.kicad_sch', ''), { name: GIT_LINK_FILE, bytes: gitLinkBytes(link) }]),
    ).toEqual(link);
    expect(gitLinkOf([file('a.kicad_sch', '')])).toBeNull();
  });
  it('refuses anything that is not one', () => {
    expect(parseGitLink('{"v":1,"owner":"o"}')).toBeNull();
    // A version this build does not know is not read as this one.
    expect(parseGitLink(JSON.stringify({ ...link, v: 2 }))).toBeNull();
    expect(parseGitLink('not json')).toBeNull();
    expect(parseGitLink(undefined)).toBeNull();
  });
});

describe('names', () => {
  it("offers the project's name as GitHub would take it", () => {
    expect(repoNameFor('My Board v2')).toBe('My-Board-v2');
    expect(repoNameFor('amp_ecc83-pp')).toBe('amp_ecc83-pp');
    expect(repoNameFor('  ')).toBe('kicad-project');
    expect(isValidRepoName('a b')).toBe(false);
    expect(isValidRepoName('..')).toBe(false);
    expect(isValidRepoName('ok.name-1_x')).toBe(true);
  });
  it('takes the branch names git takes', () => {
    for (const ok of ['main', 'feature/rev-b', 'v1.2'])
      expect(isValidBranchName(ok), ok).toBe(true);
    for (const bad of ['', 'a b', 'a..b', '-x', 'x/', 'x.lock', '.x', 'a~1', 'a:b', 'a@{1}'])
      expect(isValidBranchName(bad), bad).toBe(false);
  });
});

const PROJECT: ProjectFile[] = [
  file('board.kicad_pro', '{"meta":{"filename":"board.kicad_pro"}}\n'),
  file('board.kicad_sch', '(kicad_sch (version 20250114))\r\n'),
  file('board.kicad_pcb', '(kicad_pcb (version 20250216))\n'),
  file('lib.pretty/R.kicad_mod', '(footprint "R")\n'),
  file('3d/part.wrz', new Uint8Array([0x1f, 0x8b, 0x08, 0x00, 0xff, 0x00, 0x10])),
  // Never pushed:
  file('board.kicad_prl', '{}'),
  file('.history/x', 'h'),
  file('board-backups/b.zip', 'z'),
  file(GIT_LINK_FILE, '{}'),
];

const PUSHED = [
  '.gitignore',
  '3d/part.wrz',
  'board.kicad_pcb',
  'board.kicad_pro',
  'board.kicad_sch',
  'lib.pretty/R.kicad_mod',
];

describe('Push to GitHub... on a project with no repository', () => {
  it('creates the repository and makes every synced file its first commit, on an EMPTY repository', async () => {
    const gh = new FakeGithub();
    const { link, repo } = await pushNewRepository(gh.fetch, 'board', true, PROJECT);
    const r = gh.repo('octo', 'board');

    expect(repo.full_name).toBe('octo/board');
    expect(r.private).toBe(true);
    expect(gh.log[0]).toMatchObject({
      method: 'POST',
      path: '/user/repos',
      body: { name: 'board', private: true, auto_init: false },
    });
    // The empty repository takes the Contents API first; the fake answers any Git-database
    // write before that with 409, as GitHub does, so getting here at all proves the order.
    expect(gh.writes()[1]).toMatchObject({
      method: 'PUT',
      path: '/repos/octo/board/contents/.gitignore',
    });

    // One commit, a root, holding exactly the synced files with their exact bytes.
    const head = r.refs.get('main')!;
    expect(r.commits.get(head)!.parents).toEqual([]);
    expect(r.commits.get(head)!.message).toBe('Initial commit');
    const files = gh.filesAt(r, 'main');
    expect(Object.keys(files).sort()).toEqual(PUSHED);
    expect(files['.gitignore']).toBe(KICAD_GITIGNORE_TEXT);
    expect(files['board.kicad_sch']).toBe('(kicad_sch (version 20250114))\r\n');
    const tree = r.trees.get(r.commits.get(head)!.tree)!;
    expect(tree.get('3d/part.wrz')).toBe(gitBlobId(PROJECT[4]!.bytes));

    expect(link).toEqual({
      v: 1,
      owner: 'octo',
      repo: 'board',
      branch: 'main',
      dir: '',
      commit: head,
      tree: r.commits.get(head)!.tree,
    });
  });

  it('sends text inline in the tree and a binary file as a base64 blob', async () => {
    const gh = new FakeGithub();
    await pushNewRepository(gh.fetch, 'board', false, PROJECT);
    const blobs = gh.writes().filter((w) => w.path.endsWith('/git/blobs'));
    expect(blobs).toHaveLength(1);
    expect(blobs[0]!.body).toEqual({
      content: Buffer.from(PROJECT[4]!.bytes).toString('base64'),
      encoding: 'base64',
    });
    const trees = gh.writes().filter((w) => w.path.endsWith('/git/trees'));
    const entries = trees.flatMap(
      (t) => (t.body as { tree: { path: string; content?: string }[] }).tree,
    );
    expect(entries.find((e) => e.path === 'board.kicad_pcb')?.content).toBe(
      '(kicad_pcb (version 20250216))\n',
    );
  });

  it('reads the new tree back, and moves no branch when GitHub stored a file differently', async () => {
    const gh = new FakeGithub();
    // e.g. line endings normalised on the way in: the CRLF schematic would come back changed.
    gh.mangle = (c) => c.replace(/\r\n/g, '\n');
    await expect(pushNewRepository(gh.fetch, 'board', true, PROJECT)).rejects.toThrow(
      'GitHub did not store board.kicad_sch as this project has it, so nothing was pushed.',
    );
    // Only the Contents API's one-file commit: the project's commit never became the branch.
    expect(Object.keys(gh.filesAt(gh.repo('octo', 'board'), 'main'))).toEqual(['.gitignore']);
  });

  it("says GitHub's own words when the name is taken", async () => {
    const gh = new FakeGithub();
    gh.addRepo('board');
    await expect(pushNewRepository(gh.fetch, 'board', true, PROJECT)).rejects.toThrow(
      'name already exists on this account',
    );
  });

  it('refuses a project with nothing to push', async () => {
    const gh = new FakeGithub();
    await expect(
      pushNewRepository(gh.fetch, 'x', true, [file('.history/a', 'a')]),
    ).rejects.toBeInstanceOf(GitSyncError);
    expect(gh.log).toEqual([]);
  });
});

/** A repository with one commit and a project linked to it. */
async function linked(extraRemote: Record<string, string> = {}) {
  const gh = new FakeGithub();
  const r = gh.addRepo('board');
  const base = {
    'board.kicad_pro': '{}\n',
    'board.kicad_sch': 'sch v1\n',
    'board.kicad_pcb': 'pcb v1\n',
    'notes.txt': 'notes v1\n',
    ...extraRemote,
  };
  const commit = gh.commitFiles(r, 'main', base, 'first');
  const link: GitLink = {
    v: 1,
    owner: 'octo',
    repo: 'board',
    branch: 'main',
    dir: '',
    commit,
    tree: r.commits.get(commit)!.tree,
  };
  const files = Object.entries(base)
    .filter(([p]) => isSyncedPath(p))
    .map(([p, t]) => file(p, t));
  return { gh, r, link, files };
}

describe('Commit Project... on a linked project', () => {
  it('commits only what changed, on the branch head, with base_tree, and moves the branch', async () => {
    const { gh, r, link, files } = await linked({ '.github/workflows/ci.yml': 'ci\n' });
    const edited = [
      ...files.filter((f) => f.name !== 'board.kicad_sch' && f.name !== 'notes.txt'),
      file('board.kicad_sch', 'sch v2\n'),
      file('new.kicad_sch', 'sub sheet\n'),
    ];
    const plan = await planCommit(gh.fetch, link, edited);
    expect(plan.changes).toEqual([
      { path: 'board.kicad_sch', status: 'modified' },
      { path: 'new.kicad_sch', status: 'new' },
      { path: 'notes.txt', status: 'deleted' },
    ]);
    gh.log.length = 0;
    const next = await runCommit(gh.fetch, plan, 'Rev B');

    const tree = gh.writes().find((w) => w.path.endsWith('/git/trees'))!.body as {
      base_tree: string;
      tree: { path: string; sha?: string | null; content?: string }[];
    };
    expect(tree.base_tree).toBe(link.tree);
    expect(tree.tree.map((e) => e.path).sort()).toEqual([
      'board.kicad_sch',
      'new.kicad_sch',
      'notes.txt',
    ]);
    expect(tree.tree.find((e) => e.path === 'notes.txt')!.sha).toBeNull();
    const commit = gh.writes().find((w) => w.path.endsWith('/git/commits'))!.body as {
      parents: string[];
      message: string;
    };
    expect(commit).toMatchObject({ parents: [link.commit], message: 'Rev B' });
    const ref = gh.writes().find((w) => w.method === 'PATCH')!;
    expect(ref.path).toBe('/repos/octo/board/git/refs/heads/main');
    expect(ref.body).toMatchObject({ force: false });

    expect(gh.filesAt(r, 'main')).toEqual({
      'board.kicad_pro': '{}\n',
      'board.kicad_sch': 'sch v2\n',
      'board.kicad_pcb': 'pcb v1\n',
      'new.kicad_sch': 'sub sheet\n',
      // Not the project's, so untouched: it rides along on base_tree.
      '.github/workflows/ci.yml': 'ci\n',
    });
    expect(next.commit).toBe(r.refs.get('main'));
    expect(next.tree).toBe(r.commits.get(next.commit)!.tree);
  });

  it('has nothing to commit when nothing changed', async () => {
    const { gh, link, files } = await linked();
    const plan = await planCommit(gh.fetch, link, files);
    expect(plan.changes).toEqual([]);
    await expect(runCommit(gh.fetch, plan, 'x')).rejects.toBeInstanceOf(GitSyncError);
  });

  it('refuses, writing nothing, when the branch moved on GitHub: pull first', async () => {
    const { gh, r, link, files } = await linked();
    gh.commitFiles(r, 'main', { 'board.kicad_pro': '{}\n', 'other.txt': 'x' });
    gh.log.length = 0;
    await expect(planCommit(gh.fetch, link, [...files, file('a.txt', 'a')])).rejects.toBeInstanceOf(
      GitBehindError,
    );
    expect(gh.writes()).toEqual([]);
  });

  it('refuses when someone pushes between the plan and the push (not a fast-forward)', async () => {
    const { gh, r, link, files } = await linked();
    const plan = await planCommit(gh.fetch, link, [...files, file('a.txt', 'a')]);
    const theirs = gh.commitFiles(r, 'main', { 'board.kicad_pro': '{}\n' });
    await expect(runCommit(gh.fetch, plan, 'mine')).rejects.toBeInstanceOf(GitBehindError);
    expect(r.refs.get('main')).toBe(theirs);
  });
});

describe('Pull', () => {
  it('is up to date when the branch has not moved', async () => {
    const { gh, link, files } = await linked();
    const plan = await planPull(gh.fetch, link, files);
    expect(plan.upToDate).toBe(true);
  });

  it("fast-forwards: takes GitHub's changes, keeps the project's own", async () => {
    const { gh, r, link, files } = await linked();
    // Here: the board edited, and a file GitHub never had.
    const local = [
      ...files.filter((f) => f.name !== 'board.kicad_pcb'),
      file('board.kicad_pcb', 'pcb mine\n'),
      file('scratch.txt', 'only here\n'),
    ];
    // There: the schematic edited, notes deleted, a sheet added.
    const head = gh.commitFiles(r, 'main', {
      'board.kicad_pro': '{}\n',
      'board.kicad_sch': 'sch theirs\n',
      'board.kicad_pcb': 'pcb v1\n',
      'power.kicad_sch': 'power\n',
    });
    const plan = await planPull(gh.fetch, link, local);
    expect(plan.conflicts).toEqual([]);
    expect(plan.take).toEqual(['board.kicad_sch', 'power.kicad_sch']);
    expect(plan.drop).toEqual(['notes.txt']);

    const got = await fetchPull(gh.fetch, plan, false);
    expect(Object.fromEntries(got.writes.map((w) => [w.name, dec.decode(w.bytes)]))).toEqual({
      'board.kicad_sch': 'sch theirs\n',
      'power.kicad_sch': 'power\n',
    });
    // Never the board (edited here) nor scratch.txt (never in the repository).
    expect(got.deletes).toEqual(['notes.txt']);
    expect(got.link).toEqual({ ...link, commit: head, tree: r.commits.get(head)!.tree });
  });

  it('refuses the whole pull when a file changed on both sides, and changes nothing', async () => {
    const { gh, r, link, files } = await linked();
    const local = [
      ...files.filter((f) => f.name !== 'board.kicad_sch'),
      file('board.kicad_sch', 'sch mine\n'),
    ];
    gh.commitFiles(r, 'main', {
      'board.kicad_pro': '{}\n',
      'board.kicad_sch': 'sch theirs\n',
      'board.kicad_pcb': 'pcb v2\n',
      'notes.txt': 'notes v1\n',
    });
    const plan = await planPull(gh.fetch, link, local);
    expect(plan.conflicts).toEqual(['board.kicad_sch']);
    gh.log.length = 0;
    await expect(fetchPull(gh.fetch, plan, false)).rejects.toThrow(
      'Your local changes and the remote changes conflict, so the pull was cancelled and nothing was changed.',
    );
    expect(gh.log).toEqual([]);
  });

  it("Use Remote takes GitHub's side of the conflict and keeps the other local changes", async () => {
    const { gh, r, link, files } = await linked();
    const local = [
      ...files.filter((f) => f.name !== 'board.kicad_sch' && f.name !== 'notes.txt'),
      file('board.kicad_sch', 'sch mine\n'),
      file('notes.txt', 'notes mine\n'),
    ];
    gh.commitFiles(r, 'main', {
      'board.kicad_pro': '{}\n',
      'board.kicad_sch': 'sch theirs\n',
      'board.kicad_pcb': 'pcb v1\n',
      'notes.txt': 'notes v1\n',
    });
    const plan = await planPull(gh.fetch, link, local);
    expect(plan.conflicts).toEqual(['board.kicad_sch']);
    const got = await fetchPull(gh.fetch, plan, true);
    expect(got.writes.map((w) => [w.name, dec.decode(w.bytes)])).toEqual([
      ['board.kicad_sch', 'sch theirs\n'],
    ]);
    expect(got.deletes).toEqual([]);
  });

  it('a file edited here and deleted on GitHub is a conflict, never a silent delete', async () => {
    const { gh, r, link, files } = await linked();
    const local = [
      ...files.filter((f) => f.name !== 'notes.txt'),
      file('notes.txt', 'notes mine\n'),
    ];
    gh.commitFiles(r, 'main', {
      'board.kicad_pro': '{}\n',
      'board.kicad_sch': 'sch v1\n',
      'board.kicad_pcb': 'pcb v1\n',
    });
    const plan = await planPull(gh.fetch, link, local);
    expect(plan).toMatchObject({ conflicts: ['notes.txt'], take: [], drop: [] });
    // Use Remote: GitHub's side of it is "deleted".
    const got = await fetchPull(gh.fetch, plan, true);
    expect(got).toMatchObject({ writes: [], deletes: ['notes.txt'] });
  });

  it('a change made the same way on both sides is no conflict', async () => {
    const { gh, r, link, files } = await linked();
    const local = [...files.filter((f) => f.name !== 'notes.txt'), file('notes.txt', 'same\n')];
    gh.commitFiles(r, 'main', {
      'board.kicad_pro': '{}\n',
      'board.kicad_sch': 'sch v1\n',
      'board.kicad_pcb': 'pcb v1\n',
      'notes.txt': 'same\n',
    });
    const plan = await planPull(gh.fetch, link, local);
    expect(plan).toMatchObject({ conflicts: [], take: [], drop: [] });
  });

  it('a file added here under a name GitHub then added too, differently, is a conflict', async () => {
    const { gh, r, link, files } = await linked();
    gh.commitFiles(r, 'main', {
      'board.kicad_pro': '{}\n',
      'board.kicad_sch': 'sch v1\n',
      'board.kicad_pcb': 'pcb v1\n',
      'notes.txt': 'notes v1\n',
      'bom.csv': 'theirs\n',
    });
    const plan = await planPull(gh.fetch, link, [...files, file('bom.csv', 'mine\n')]);
    expect(plan.conflicts).toEqual(['bom.csv']);
  });

  it('writes nothing it cannot check: a damaged download stops the pull', async () => {
    const { gh, r, link, files } = await linked();
    gh.commitFiles(r, 'main', {
      'board.kicad_pro': '{}\n',
      'board.kicad_sch': 'sch theirs\n',
      'board.kicad_pcb': 'pcb v1\n',
      'notes.txt': 'notes v1\n',
    });
    const plan = await planPull(gh.fetch, link, files);
    gh.damageBlobs = true;
    await expect(fetchPull(gh.fetch, plan, false)).rejects.toThrow(
      'board.kicad_sch arrived damaged from GitHub.',
    );
  });

  it('switches to another branch the same way', async () => {
    const { gh, r, link, files } = await linked();
    r.refs.set('rev-b', link.commit);
    const head = gh.commitFiles(r, 'rev-b', {
      'board.kicad_pro': '{}\n',
      'board.kicad_sch': 'sch rev b\n',
      'board.kicad_pcb': 'pcb v1\n',
      'notes.txt': 'notes v1\n',
    });
    const plan = await planPull(gh.fetch, link, files, 'rev-b');
    expect(plan.take).toEqual(['board.kicad_sch']);
    expect(plan.link).toMatchObject({ branch: 'rev-b', commit: head });
    await expect(planPull(gh.fetch, link, files, 'nope')).rejects.toThrow(
      'There is no branch nope in octo/board on GitHub.',
    );
  });
});

describe('branches', () => {
  it('lists the current branch first, then the others in order (GetBranchNames)', async () => {
    const { gh, r, link } = await linked();
    r.refs.set('zeta', link.commit);
    r.refs.set('alpha', link.commit);
    expect(await branchNames(gh.fetch, { ...link, branch: 'zeta' })).toEqual([
      'zeta',
      'alpha',
      'main',
    ]);
  });

  it("Add makes the branch at the project's commit and links the project to it", async () => {
    const { gh, r, link } = await linked();
    const next = await addBranch(gh.fetch, link, 'rev-b');
    expect(r.refs.get('rev-b')).toBe(link.commit);
    expect(next).toEqual({ ...link, branch: 'rev-b' });
  });
});

describe('Clone Project from Repository...', () => {
  it("fetches the chosen project's folder, every synced file, linked to the repository", async () => {
    const gh = new FakeGithub();
    const r = gh.addRepo('hw', { private: true });
    const head = gh.commitFiles(r, 'main', {
      'README.md': 'top\n',
      'firmware/main.c': 'int main;\n',
      'hw/amp/amp.kicad_pro': '{}\n',
      'hw/amp/amp.kicad_sch': 'amp sch\n',
      'hw/amp/amp.kicad_pcb': 'amp pcb\n',
      'hw/amp/amp.kicad_prl': '{}\n',
      'hw/amp/lib/x.kicad_sym': 'sym\n',
      'hw/psu/psu.kicad_pro': '{}\n',
      '.github/old/ghost.kicad_pro': '{}\n',
    });
    const offered: string[][] = [];
    const got = await cloneRepository(
      gh.fetch,
      { name: 'hw', owner: { login: 'octo' }, default_branch: 'main' },
      async (projects) => {
        offered.push([...projects]);
        return 'hw/amp/amp.kicad_pro';
      },
    );
    expect(offered).toEqual([['hw/amp/amp.kicad_pro', 'hw/psu/psu.kicad_pro']]);
    expect(got!.project).toBe('amp.kicad_pro');
    expect(Object.fromEntries(got!.files.map((f) => [f.name, dec.decode(f.bytes)]))).toEqual({
      'amp.kicad_pro': '{}\n',
      'amp.kicad_sch': 'amp sch\n',
      'amp.kicad_pcb': 'amp pcb\n',
      'lib/x.kicad_sym': 'sym\n',
    });
    expect(got!.link).toEqual({
      v: 1,
      owner: 'octo',
      repo: 'hw',
      branch: 'main',
      dir: 'hw/amp/',
      commit: head,
      tree: r.commits.get(head)!.tree,
    });
  });

  it('says so when the repository holds no project, and when it is empty', async () => {
    const gh = new FakeGithub();
    const r = gh.addRepo('fw');
    gh.commitFiles(r, 'main', { 'main.c': 'x' });
    const repo = { name: 'fw', owner: { login: 'octo' }, default_branch: 'main' };
    await expect(cloneRepository(gh.fetch, repo, async () => null)).rejects.toThrow(
      'No project files were found in the repository.',
    );
    gh.addRepo('blank');
    await expect(
      cloneRepository(gh.fetch, { ...repo, name: 'blank' }, async () => null),
    ).rejects.toThrow('octo/blank is empty');
  });

  it('a clone commits back into its folder', async () => {
    const gh = new FakeGithub();
    const r = gh.addRepo('hw');
    gh.commitFiles(r, 'main', {
      'hw/a.kicad_pro': '{}\n',
      'hw/a.kicad_sch': 'v1\n',
      'x.txt': 'x\n',
    });
    const got = (await cloneRepository(
      gh.fetch,
      { name: 'hw', owner: { login: 'octo' }, default_branch: 'main' },
      async () => null,
    ))!;
    const edited = got.files.map((f) => (f.name === 'a.kicad_sch' ? file(f.name, 'v2\n') : f));
    await runCommit(gh.fetch, await planCommit(gh.fetch, got.link, edited), 'edit');
    expect(gh.filesAt(r, 'main')).toEqual({
      'hw/a.kicad_pro': '{}\n',
      'hw/a.kicad_sch': 'v2\n',
      'x.txt': 'x\n',
    });
  });
});

describe('changesBetween', () => {
  it('lists new, modified and deleted in path order', () => {
    const l = new Map([
      ['b', { sha: '2' }],
      ['c', { sha: '3' }],
    ]);
    const b = new Map([
      ['a', { sha: '1' }],
      ['b', { sha: 'x' }],
    ]);
    expect(changesBetween(l, b)).toEqual([
      { path: 'a', status: 'deleted' },
      { path: 'b', status: 'modified' },
      { path: 'c', status: 'new' },
    ]);
  });
});

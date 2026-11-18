// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
/**
 * ZiroEDA as a GitHub App (designer/src/github): connecting through its install page, the
 * repositories it may use (its installations', not every repository the person can reach), which
 * of them hold a KiCad project, pushing into an existing empty repository, GitHub refusing to
 * create one, and Disconnect GitHub. Against the in-memory GitHub of fake_github.ts.
 *
 * The App's identity (client id, slug, callback) is the registration's, written here as data.
 */
import { describe, expect, it } from 'vitest';
import {
  type GithubRepo,
  connectionInfo,
  listAppRepos,
} from '@ziroeda/designer/src/github/github_api.js';
import {
  GITHUB_MESSAGE_TYPE,
  accessSettingsUrl,
  authorizeUrl,
  beginGithubConnect,
  installUrl,
  isAccessUpdate,
  onGithubAccessUpdated,
  revokeToken,
} from '@ziroeda/designer/src/github/github_auth.js';
import {
  GitSyncError,
  GithubAccessError,
  type KicadScanCache,
  type ProjectFile,
  findKicadRepos,
  hasKicadProject,
  pushNewRepository,
  pushToExistingRepository,
} from '@ziroeda/designer/src/github/github_project.js';
import { FakeGithub } from './fake_github.js';

const enc = new TextEncoder();
const file = (name: string, text: string): ProjectFile => ({ name, bytes: enc.encode(text) });
const PROJECT = [file('amp.kicad_pro', '{}\n'), file('amp.kicad_sch', '(kicad_sch)\n')];

describe('the App, not the OAuth app', () => {
  it('signs in with the App client id and no scope', () => {
    const u = new URL(authorizeUrl('S'.repeat(43)));
    expect(u.origin + u.pathname).toBe('https://github.com/login/oauth/authorize');
    expect(u.searchParams.get('client_id')).toBe('Iv23liWBsV0BNxfsmQQ8');
    expect(u.searchParams.has('scope')).toBe(false);
    expect(u.searchParams.get('redirect_uri')).toBe(
      'https://designer.ziroeda.com/api/github/callback',
    );
  });

  it('installs through github.com/apps/ziroeda, carrying the state', () => {
    const u = new URL(installUrl('abc_DEF-123'));
    expect(u.origin + u.pathname).toBe('https://github.com/apps/ziroeda/installations/new');
    expect(u.searchParams.get('state')).toBe('abc_DEF-123');
  });
});

/** A window that records its message listeners and the URL it opened. */
function fakeWindow() {
  const listeners: ((e: MessageEvent) => void)[] = [];
  let opened = '';
  const win = {
    location: { origin: 'https://designer.ziroeda.com' },
    open: (url: string) => {
      opened = url;
      return {};
    },
    addEventListener: (_t: string, fn: (e: MessageEvent) => void) => listeners.push(fn),
    removeEventListener: (_t: string, fn: (e: MessageEvent) => void) => {
      const i = listeners.indexOf(fn);
      if (i >= 0) listeners.splice(i, 1);
    },
  } as unknown as Window;
  const post = (origin: string, data: unknown) =>
    [...listeners].forEach((fn) => fn({ origin, data } as MessageEvent));
  return { win, post, opened: () => opened, listeners };
}

describe('connecting through the install page', () => {
  it('opens the install page and takes the install arrival for its own state', async () => {
    const w = fakeWindow();
    const connect = beginGithubConnect(w.win, 'install');
    const url = new URL(w.opened());
    expect(url.pathname).toBe('/apps/ziroeda/installations/new');
    const state = url.searchParams.get('state')!;
    // What api/github/callback.js posts after an install with sign-in (setup_action=install).
    w.post('https://designer.ziroeda.com', {
      type: GITHUB_MESSAGE_TYPE,
      state,
      setup_action: 'install',
      installation_id: 42,
      access_token: 'ghu_fake',
      refresh_token: 'ghr_fake',
      expires_in: 28800,
    });
    expect((await connect).accessToken).toBe('ghu_fake');
  });

  it('an access-changed notice is never taken as a sign-in', async () => {
    const w = fakeWindow();
    let settled = false;
    void beginGithubConnect(w.win, 'install').then(() => {
      settled = true;
    });
    w.post('https://designer.ziroeda.com', {
      type: GITHUB_MESSAGE_TYPE,
      event: 'access-updated',
      installation_id: 42,
    });
    await new Promise((r) => setTimeout(r, 10));
    expect(settled).toBe(false);
  });
});

describe('an access change reported by the callback page', () => {
  it('is an install or an update, from this site, with or without tokens', () => {
    expect(isAccessUpdate({ type: GITHUB_MESSAGE_TYPE, event: 'access-updated' })).toBe(true);
    expect(isAccessUpdate({ type: GITHUB_MESSAGE_TYPE, setup_action: 'update' })).toBe(true);
    expect(isAccessUpdate({ type: GITHUB_MESSAGE_TYPE, setup_action: 'install' })).toBe(true);
    expect(isAccessUpdate({ type: GITHUB_MESSAGE_TYPE, state: 'x', access_token: 'y' })).toBe(
      false,
    );
    expect(isAccessUpdate({ type: 'other', event: 'access-updated' })).toBe(false);
    expect(isAccessUpdate(null)).toBe(false);
  });

  it('is heard from this site only', () => {
    const w = fakeWindow();
    let heard = 0;
    const off = onGithubAccessUpdated(() => heard++, w.win);
    const notice = { type: GITHUB_MESSAGE_TYPE, event: 'access-updated' };
    w.post('https://evil.example', notice);
    expect(heard).toBe(0);
    w.post('https://designer.ziroeda.com', notice);
    expect(heard).toBe(1);
    off();
    w.post('https://designer.ziroeda.com', notice);
    expect(heard).toBe(1);
  });
});

describe('the repositories the App may use', () => {
  it("are its installations' repositories, every page, each once - not GET /user/repos", async () => {
    const gh = new FakeGithub();
    for (let i = 0; i < 130; i++) gh.addRepo(`r${String(i).padStart(3, '0')}`);
    gh.addRepo('hidden');
    gh.installations = [
      {
        id: 7,
        login: 'octo',
        selected: [...Array(130)].map((_, i) => `r${String(i).padStart(3, '0')}`),
      },
      { id: 8, login: 'octo', selected: ['r000'] },
    ];
    const { installations, repos } = await listAppRepos(gh.fetch);
    expect(installations.map((i) => i.id)).toEqual([7, 8]);
    expect(repos).toHaveLength(130);
    expect(repos.some((r) => r.name === 'hidden')).toBe(false);
    expect(new Set(repos.map((r) => r.full_name)).size).toBe(130);
    expect(gh.log.some((l) => l.path.startsWith('/user/repos'))).toBe(false);
    expect(gh.log.filter((l) => l.path.startsWith('/user/installations/7/'))).toHaveLength(2);
  });

  it('none when the App is installed nowhere for this person', async () => {
    const gh = new FakeGithub();
    gh.addRepo('a');
    gh.installations = [];
    expect(await listAppRepos(gh.fetch)).toEqual({ installations: [], repos: [] });
    expect(await connectionInfo(gh.fetch)).toEqual({ login: 'octo', installations: [] });
  });

  it("'Change repository access on GitHub' opens the one installation, else the list of them", () => {
    expect(
      accessSettingsUrl([
        {
          id: 5,
          account: { login: 'org' },
          repository_selection: 'selected',
          html_url: 'https://github.com/organizations/org/settings/installations/5',
        },
      ]),
    ).toBe('https://github.com/organizations/org/settings/installations/5');
    expect(
      accessSettingsUrl([{ id: 5, account: { login: 'me' }, repository_selection: 'selected' }]),
    ).toBe('https://github.com/settings/installations/5');
    const two = [
      { id: 5, account: { login: 'me' }, repository_selection: 'all' as const },
      { id: 6, account: { login: 'org' }, repository_selection: 'all' as const },
    ];
    expect(accessSettingsUrl(two)).toBe('https://github.com/settings/installations');
    expect(accessSettingsUrl([])).toBe('https://github.com/settings/installations');
  });
});

describe('which repositories hold a KiCad project', () => {
  async function world() {
    const gh = new FakeGithub();
    const amp = gh.addRepo('amp');
    gh.commitFiles(amp, 'main', { 'hw/amp.kicad_pro': '{}', 'hw/amp.kicad_sch': '' });
    const fw = gh.addRepo('firmware');
    gh.commitFiles(fw, 'main', { 'main.c': 'int main;' });
    const ci = gh.addRepo('ci');
    gh.commitFiles(ci, 'main', { '.github/old.kicad_pro': '{}' });
    gh.addRepo('blank');
    const { repos } = await listAppRepos(gh.fetch);
    return { gh, amp, repos };
  }

  it('keeps those whose default branch has a .kicad_pro, never one in a tooling folder', async () => {
    const { gh, repos } = await world();
    const progress: number[] = [];
    const found = await findKicadRepos(gh.fetch, repos, (done) => progress.push(done), new Map());
    expect(found.map((r) => r.name)).toEqual(['amp']);
    expect(progress.sort()).toEqual([1, 2, 3, 4]);
  });

  it('asks GitHub once per repository per push: the cache answers until the repository moves', async () => {
    const { gh, amp, repos } = await world();
    const cache: KicadScanCache = new Map();
    await findKicadRepos(gh.fetch, repos, undefined, cache);
    gh.log.length = 0;
    await findKicadRepos(gh.fetch, repos, undefined, cache);
    expect(gh.log).toEqual([]);

    gh.commitFiles(amp, 'main', { 'readme.md': 'project moved out' });
    const after = (await listAppRepos(gh.fetch)).repos;
    gh.log.length = 0;
    const found = await findKicadRepos(gh.fetch, after, undefined, cache);
    expect(found.map((r) => r.name)).toEqual([]);
    expect(gh.log.filter((l) => l.path.includes('/git/trees/'))).toHaveLength(1);
  });

  it('counts a repository GitHub would not list as possibly holding one', async () => {
    const repo: GithubRepo = {
      name: 'huge',
      full_name: 'octo/huge',
      owner: { login: 'octo' },
      private: true,
      default_branch: 'main',
    };
    const truncated = (async () =>
      new Response(JSON.stringify({ tree: [], truncated: true }), { status: 200 })) as typeof fetch;
    expect(await hasKicadProject(truncated, repo, new Map())).toBe(true);
  });
});

describe('Push to GitHub... > Use an existing repository', () => {
  it('fills an empty repository with the project as its first commit', async () => {
    const gh = new FakeGithub();
    const r = gh.addRepo('empty-one');
    const repo = (await listAppRepos(gh.fetch)).repos[0]!;
    const { link } = await pushToExistingRepository(gh.fetch, repo, PROJECT);
    expect(gh.filesAt(r, 'main')).toMatchObject({
      'amp.kicad_pro': '{}\n',
      'amp.kicad_sch': '(kicad_sch)\n',
    });
    expect(r.commits.get(r.refs.get('main')!)!.parents).toEqual([]);
    expect(link).toMatchObject({ owner: 'octo', repo: 'empty-one', branch: 'main', dir: '' });
    expect(gh.log.some((l) => l.method === 'POST' && l.path === '/user/repos')).toBe(false);
  });

  it('refuses a repository that has commits, writing nothing', async () => {
    const gh = new FakeGithub();
    const r = gh.addRepo('busy');
    gh.commitFiles(r, 'main', { 'README.md': 'theirs' });
    const repo = (await listAppRepos(gh.fetch)).repos[0]!;
    gh.log.length = 0;
    await expect(pushToExistingRepository(gh.fetch, repo, PROJECT)).rejects.toThrow(
      'octo/busy already has commits, and Push to GitHub... fills only an empty repository.',
    );
    expect(gh.writes()).toEqual([]);
  });

  it('never forces over a push that landed while it was filling the repository', async () => {
    const gh = new FakeGithub();
    const r = gh.addRepo('raced');
    const repo = (await listAppRepos(gh.fetch)).repos[0]!;
    gh.afterPut = (x) => {
      gh.afterPut = null;
      gh.commitFiles(x, 'main', { 'theirs.txt': 'mine first' });
    };
    await expect(pushToExistingRepository(gh.fetch, repo, PROJECT)).rejects.toThrow(
      'Someone else pushed to octo/raced while ZiroEDA was filling it',
    );
    expect(gh.filesAt(r, 'main')).toEqual({ 'theirs.txt': 'mine first' });
  });
});

describe('Push to GitHub... > Create a new repository, when GitHub will not', () => {
  it("says so in words, as an access problem, never GitHub's raw refusal", async () => {
    const gh = new FakeGithub();
    gh.createDenied = true;
    const e = await pushNewRepository(gh.fetch, 'amp', true, PROJECT).catch((x: unknown) => x);
    expect(e).toBeInstanceOf(GithubAccessError);
    expect(e).toBeInstanceOf(GitSyncError);
    const words = (e as Error).message;
    expect(words).toContain('GitHub did not let ZiroEDA create a repository.');
    expect(words).toContain('Use an existing repository');
    expect(words).not.toContain('Resource not accessible');
    expect(words).not.toContain('integration');
  });

  it('a taken name is not an access problem', async () => {
    const gh = new FakeGithub();
    gh.addRepo('amp');
    const e = await pushNewRepository(gh.fetch, 'amp', true, PROJECT).catch((x: unknown) => x);
    expect(e).not.toBeInstanceOf(GithubAccessError);
    expect((e as Error).message).toContain('name already exists on this account');
  });
});

describe('Disconnect GitHub: revoking the token through the server', () => {
  const server = (status: number, body: unknown) => {
    const calls: { url: string; body: unknown }[] = [];
    const f = (async (url: string, init: RequestInit = {}) => {
      calls.push({ url, body: JSON.parse(String(init.body)) });
      return new Response(JSON.stringify(body), { status });
    }) as typeof fetch;
    return { f, calls };
  };

  it('posts this device token to /api/github/revoke, and is done', async () => {
    const s = server(200, { revoked: true });
    expect(await revokeToken('ghu_fake', s.f)).toBeNull();
    expect(s.calls).toEqual([{ url: '/api/github/revoke', body: { access_token: 'ghu_fake' } }]);
  });

  it("says why when the server could not, in the server's words", async () => {
    const s = server(503, {
      error: 'not_configured',
      error_description: 'GitHub is not set up on this server yet.',
    });
    expect(await revokeToken('ghu_fake', s.f)).toBe('GitHub is not set up on this server yet.');
    const offline = (async () => {
      throw new Error('Failed to fetch');
    }) as typeof fetch;
    expect(await revokeToken('ghu_fake', offline)).toBe('Failed to fetch');
  });
});

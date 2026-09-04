// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * @vitest-environment happy-dom
 *
 * Following a share link.
 *
 * The app has no router, so a link arrives as `?join=<token>` and is dealt with
 * at startup. Two things about that are easy to get wrong and expensive both
 * ways, which is what these pin:
 *
 *  - **the token must not stay in the address bar.** Until it is redeemed it
 *    *is* the credential — anyone holding it takes the role the link grants —
 *    and an address bar is bookmarked, screenshotted, pasted into chat and
 *    kept in history on shared machines.
 *  - **the token must survive a sign-in.** The person following the link
 *    usually has no session, which is the entire point of sharing one. The
 *    case that forces it is OAuth: `signInWithGoogle` redirects to
 *    `window.location.origin`, which has no query string, so a token left in
 *    the URL is simply gone by the time a session exists.
 *
 * Those two pull in opposite directions — strip it early, but do not lose it —
 * and the stash is what satisfies both.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import {
  captureInviteFromUrl,
  clearPendingInvite,
  inviteTokenIn,
  openProjectLink,
  pendingInvite,
  projectLinkIn,
  redeemPendingInvite,
  shareUrlFor,
} from '@ziroeda/designer/src/cloud/invites.js';
import type { CloudBackend } from '@ziroeda/designer/src/cloud/backend.js';

const TOKEN = '99999999-9999-9999-9999-999999999999';
/**
 * The document's own origin. `replaceState` to any other one is a SecurityError
 * in a browser and in happy-dom alike, so the tests that drive history have to
 * stay here; the pure parsing tests are free to use any URL they like.
 */
const BASE = 'http://localhost:3000/';

beforeEach(() => {
  clearPendingInvite();
  window.history.replaceState(null, '', BASE);
});

describe('reading a share link', () => {
  it('takes the token out of the URL, leaving no trailing "?"', () => {
    const { token, cleaned } = inviteTokenIn(`https://app.test/?join=${TOKEN}`);
    expect(token).toBe(TOKEN);
    // Not `https://app.test/?` — a stray question mark is a visible difference
    // in the address bar for no reason.
    expect(cleaned).toBe('https://app.test/');
  });

  it('leaves the rest of the query alone', () => {
    const { token, cleaned } = inviteTokenIn(`https://app.test/?demo=amp&join=${TOKEN}&x=1`);
    expect(token).toBe(TOKEN);
    expect(cleaned).toBe('https://app.test/?demo=amp&x=1');
  });

  it('refuses a value that is not a token', () => {
    // It came off a URL and is about to be put in storage and sent to the
    // database. Anything that is not a uuid is a typo or a probe, and stashing
    // it only produces a confusing failure later, far from the link that caused
    // it.
    expect(inviteTokenIn('https://app.test/?join=../../etc/passwd').token).toBeNull();
    expect(inviteTokenIn('https://app.test/?join=').token).toBeNull();
    expect(inviteTokenIn('not a url at all').token).toBeNull();
  });

  it('stashes the token and clears the address bar', () => {
    window.history.replaceState(null, '', `${BASE}?join=${TOKEN}`);
    expect(captureInviteFromUrl()).toBe(TOKEN);

    // The stash is what carries it across the sign-in; the URL is what must not.
    expect(pendingInvite()).toBe(TOKEN);
    expect(window.location.search).toBe('');
  });

  it('survives a redirect that drops the query string', () => {
    window.history.replaceState(null, '', `${BASE}?join=${TOKEN}`);
    captureInviteFromUrl();

    // What `signInWithGoogle` does: `redirectTo: window.location.origin`. The
    // query is gone, and this is the whole reason the token is not simply read
    // from the URL at the moment it is needed.
    window.history.replaceState(null, '', BASE);
    expect(captureInviteFromUrl()).toBe(TOKEN);
    expect(pendingInvite()).toBe(TOKEN);
  });
});

/** A backend that records what was asked of it. */
function fakeBackend(
  redeem: (token: string) => Promise<{ project_uid: string; role: string } | null>,
): CloudBackend & { asked: string[] } {
  const asked: string[] = [];
  return {
    asked,
    async listProjects() {
      return [];
    },
    async getProject() {
      return null;
    },
    async commitProject() {
      return null;
    },
    async deleteProject() {},
    async putObject() {},
    async getObject() {
      throw new Error('no objects');
    },
    async hasObject() {
      return false;
    },
    async removeObjects() {},
    async redeemInvite(token: string) {
      asked.push(token);
      return redeem(token);
    },
  };
}

describe('an ordinary share link, `?p=<uid>`', () => {
  const UID = '11111111-2222-3333-4444-555555555555';

  it('names the project and is left in the address bar', () => {
    window.history.replaceState(null, '', `${BASE}?p=${UID}`);
    expect(projectLinkIn(window.location.href)).toBe(UID);

    // Deliberately NOT stripped. This is the project's address, the way
    // `/file/<key>` is in Figma: somebody who has opened a project expects to
    // reload it, bookmark it and send that URL on. There is no secret here to
    // protect -- what the link is worth is a setting on the project, which its
    // owner can change or switch off.
    expect(window.location.search).toBe(`?p=${UID}`);
  });

  it('refuses anything that is not a project id', () => {
    expect(projectLinkIn(`${BASE}?p=1`)).toBeNull();
    expect(projectLinkIn(`${BASE}?p=`)).toBeNull();
    expect(projectLinkIn(BASE)).toBeNull();
  });

  it('claims the access the link offers, and can be followed twice', async () => {
    window.history.replaceState(null, '', `${BASE}?p=${UID}`);
    const seen: string[] = [];
    const be = fakeBackend(async () => null);
    (be as unknown as { openByLink: (u: string) => Promise<string> }).openByLink = async (u) => {
      seen.push(u);
      return 'editor';
    };

    expect(await openProjectLink(be)).toEqual({ uid: UID, role: 'editor' });
    // Nothing was spent, so this is not a second use of anything -- it is the
    // same page being opened again, which must behave identically.
    expect(await openProjectLink(be)).toEqual({ uid: UID, role: 'editor' });
    expect(seen).toEqual([UID, UID]);
  });

  it('is not confused with an invite token', async () => {
    window.history.replaceState(null, '', `${BASE}?join=${TOKEN}`);
    // A `?join` link is not a project address, and a `?p` link is not a token.
    expect(projectLinkIn(window.location.href)).toBeNull();
    expect(await openProjectLink(fakeBackend(async () => null))).toBeNull();
  });
});

describe('the link a Share button hands out', () => {
  const UID = '11111111-2222-3333-4444-555555555555';

  it('is built from the app address, not from whatever is in the bar', () => {
    // The current URL can carry another project's `?p=`, a `?join=` token, or a
    // demo parameter. Copying the address bar would hand those out too, which
    // is how a Share button quietly shares the wrong thing.
    expect(shareUrlFor(UID, 'https://app.test/?p=99999999-9999-9999-9999-999999999999')).toBe(
      `https://app.test/?p=${UID}`,
    );
    expect(shareUrlFor(UID, `https://app.test/?join=${TOKEN}&demo=amp#x`)).toBe(
      `https://app.test/?p=${UID}`,
    );
  });

  it('round-trips: what it builds is what the reader is understood to have followed', () => {
    expect(projectLinkIn(shareUrlFor(UID, 'https://app.test/'))).toBe(UID);
  });
});

describe('redeeming it', () => {
  it('spends the token once and reports the role granted', async () => {
    window.history.replaceState(null, '', `${BASE}?join=${TOKEN}`);
    captureInviteFromUrl();
    const be = fakeBackend(async () => ({ project_uid: 'uid-1', role: 'viewer' }));

    expect(await redeemPendingInvite(be)).toEqual({ uid: 'uid-1', role: 'viewer' });
    expect(be.asked).toEqual([TOKEN]);

    // Spent: a second pass must not ask again.
    expect(pendingInvite()).toBeNull();
    expect(await redeemPendingInvite(be)).toBeNull();
    expect(be.asked).toEqual([TOKEN]);
  });

  it('does not retry a token the database refused', async () => {
    window.history.replaceState(null, '', `${BASE}?join=${TOKEN}`);
    captureInviteFromUrl();
    const be = fakeBackend(async () => {
      throw new Error('this invite is no longer valid');
    });

    await expect(redeemPendingInvite(be)).rejects.toThrow('no longer valid');
    // An expired link fails the same way every time. Keeping it would put the
    // same message in front of the user on every sign-in for the life of the
    // tab; they need to ask for a new link, not to be told again.
    expect(pendingInvite()).toBeNull();
  });

  it('keeps the token when the backend cannot redeem at all', async () => {
    window.history.replaceState(null, '', `${BASE}?join=${TOKEN}`);
    captureInviteFromUrl();
    // A deployment whose membership migration has not been run. Nothing was
    // attempted, so nothing was spent, and the next load can still use it.
    const noRedeem = fakeBackend(async () => null);
    delete (noRedeem as { redeemInvite?: unknown }).redeemInvite;

    expect(await redeemPendingInvite(noRedeem)).toBeNull();
    expect(pendingInvite()).toBe(TOKEN);

    expect(await redeemPendingInvite(null)).toBeNull();
    expect(pendingInvite()).toBe(TOKEN);
  });

  it('does nothing at all when no link was followed', async () => {
    const be = fakeBackend(async () => ({ project_uid: 'uid-1', role: 'editor' }));
    expect(await redeemPendingInvite(be)).toBeNull();
    expect(be.asked).toEqual([]);
  });
});

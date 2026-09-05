// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * A project names itself, and names itself well.
 *
 * The client mints the uuid, which is what lets a project have one identity
 * from the moment it exists rather than acquiring one on its first push. The
 * obvious worry is two clients choosing the same one — 122 random bits makes
 * that not worth designing around, and `uid` being the primary key means a
 * duplicate row is refused rather than accepted anyway.
 *
 * What IS worth pinning is where the bits come from. `crypto.randomUUID` exists
 * only in a secure context, so it is undefined when the app is served over
 * plain http on a LAN address — which is exactly how somebody opens it on
 * another machine on their desk. The rung below it must still be the CSPRNG and
 * must still produce a real v4, because the rung below THAT is `Math.random()`.
 */
import 'fake-indexeddb/auto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  deleteProject,
  exportManifest,
  listProjects,
  saveProject,
} from '@ziroeda/designer/src/home/projectStore.js';

/** A v4 uuid: version nibble 4, variant bits 10xx (8, 9, a or b). */
const V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

const text = (s: string): Uint8Array => new TextEncoder().encode(s);
const uidOf = async (id: string): Promise<string | undefined> =>
  (await exportManifest(id))?.cloudUid;

beforeEach(async () => {
  for (const p of await listProjects()) await deleteProject(p.id);
});

describe('the identity a new project is born with', () => {
  it('is a v4 uuid', async () => {
    const id = await saveProject('A', [{ name: 'a.kicad_sch', bytes: text('a') }]);
    expect(await uidOf(id)).toMatch(V4);
  });

  it('is different for every project', async () => {
    const a = await saveProject('A', [{ name: 'a.kicad_sch', bytes: text('a') }]);
    const b = await saveProject('B', [{ name: 'b.kicad_sch', bytes: text('b') }]);
    expect(await uidOf(a)).not.toBe(await uidOf(b));
  });

  it('survives a save, rather than being minted again', async () => {
    const id = await saveProject('A', [{ name: 'a.kicad_sch', bytes: text('a') }]);
    const first = await uidOf(id);
    await saveProject('A', [{ name: 'a.kicad_sch', bytes: text('edited') }], id);
    // A save changes the contents of a project, never which project it is. A
    // fresh uid here would orphan the row already in the cloud under the old
    // one and push the same project up a second time.
    expect(await uidOf(id)).toBe(first);
  });
});

describe('when randomUUID is not available', () => {
  const real = crypto.randomUUID;
  beforeEach(() => {
    // What a plain-http origin looks like: `randomUUID` needs a secure context,
    // `getRandomValues` does not.
    (crypto as { randomUUID?: unknown }).randomUUID = undefined;
  });
  afterEach(() => {
    (crypto as { randomUUID?: unknown }).randomUUID = real;
  });

  it('still produces a real v4 from the CSPRNG', async () => {
    const id = await saveProject('A', [{ name: 'a.kicad_sch', bytes: text('a') }]);
    // Not merely uuid-shaped: the version and variant bits have to be set, or
    // it is a random string Postgres happens to accept.
    expect(await uidOf(id)).toMatch(V4);
  });

  it('takes its bits from the CSPRNG, not from Math.random', async () => {
    // The shape cannot tell these apart -- `Math.random()` produces a
    // perfectly valid-looking v4 -- so the only thing that distinguishes the
    // rungs is which generator is asked. Which is the entire point of having
    // them in that order.
    const spy = vi.spyOn(crypto, 'getRandomValues');
    await saveProject('A', [{ name: 'a.kicad_sch', bytes: text('a') }]);
    const asked = spy.mock.calls.some(
      (c) => c[0] instanceof Uint8Array && (c[0] as Uint8Array).length === 16,
    );
    spy.mockRestore();
    expect(asked).toBe(true);
  });

  it('is still unique across projects', async () => {
    const a = await saveProject('A', [{ name: 'a.kicad_sch', bytes: text('a') }]);
    const b = await saveProject('B', [{ name: 'b.kicad_sch', bytes: text('b') }]);
    expect(await uidOf(a)).not.toBe(await uidOf(b));
  });
});

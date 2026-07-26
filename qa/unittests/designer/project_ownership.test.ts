/**
 * Projects are scoped to the account that owns them
 * (designer/src/home/projectStore.ts).
 *
 * IndexedDB is per browser, not per account, and signing out does not clear it.
 * Before this, signing in as a second person on the same machine made every
 * project of the first person look like local work missing from the cloud,
 * because row-level security hides the first person's rows. Sync then pushed
 * them up under the second account. Where the project id already existed
 * Postgres refused the write, which is the row-level security error that
 * surfaced this; where it did not, one person's projects were copied into
 * another person's account without anyone noticing.
 *
 * So the rule under test is a data-isolation rule, and the dangerous direction
 * is silent: nothing breaks when it stops holding.
 */
import { describe, it, expect, beforeEach } from 'vitest';
// The store's own predicate, not a copy of it: a reimplementation here could
// stay green while the real filter drifted, which for an isolation rule is the
// failure that matters.
import { ownedBy as ownedByCurrent } from '@ziroeda/designer/src/home/projectStore.js';

const ALICE = 'alice-uuid';
const BOB = 'bob-uuid';

describe('project ownership', () => {
  let alicesProject: { ownerId?: string };
  let bobsProject: { ownerId?: string };
  let unowned: { ownerId?: string };

  beforeEach(() => {
    alicesProject = { ownerId: ALICE };
    bobsProject = { ownerId: BOB };
    unowned = {};
  });

  it("hides one account's projects from another", () => {
    expect(ownedByCurrent(BOB, alicesProject)).toBe(false);
    expect(ownedByCurrent(ALICE, bobsProject)).toBe(false);
  });

  it('shows an account its own projects', () => {
    expect(ownedByCurrent(ALICE, alicesProject)).toBe(true);
    expect(ownedByCurrent(BOB, bobsProject)).toBe(true);
  });

  it('keeps unowned work visible to whoever is signed in', () => {
    // Made while signed out, or from before ownership was recorded. Hiding
    // somebody's own local work would be worse than the problem being fixed.
    expect(ownedByCurrent(ALICE, unowned)).toBe(true);
    expect(ownedByCurrent(BOB, unowned)).toBe(true);
  });

  it('filters nothing when signed out or when auth is not configured', () => {
    // Offline use must behave exactly as it did before any of this existed.
    expect(ownedByCurrent(null, alicesProject)).toBe(true);
    expect(ownedByCurrent(null, unowned)).toBe(true);
  });

  it('never offers another account a project to push', () => {
    // The sync manifest is the leak path: anything listed here that the cloud
    // cannot see gets pushed up under the signed-in account.
    const local = [alicesProject, bobsProject, unowned];
    const bobWouldPush = local.filter((r) => ownedByCurrent(BOB, r));
    expect(bobWouldPush).not.toContain(alicesProject);
    expect(bobWouldPush).toContain(bobsProject);
    expect(bobWouldPush).toContain(unowned);
  });

  it('stops a claimed project being inherited by the next account', () => {
    // Claiming happens after a push lands; before it, the project is unowned
    // and the next person to sign in would take it.
    expect(ownedByCurrent(BOB, unowned)).toBe(true);
    unowned.ownerId = ALICE; // claimProject(id, ALICE)
    expect(ownedByCurrent(BOB, unowned)).toBe(false);
  });
});

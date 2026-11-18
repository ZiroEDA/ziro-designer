// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
/**
 * The home page's side of "list the account at once, fetch on open" (cloud/catalog.ts).
 *
 * HomePage.tsx is not renderable here, so each obligation is read from its own call site: the
 * list is asked for when the account opens, kept in the Open Project window's registry, shown in
 * Open Recent, counted as taken names, and a project still only in the account is pulled before
 * it is opened.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const HOME = readFileSync(join(__dirname, '../../../designer/src/home/HomePage.tsx'), 'utf8');

/** From `start` to the next line that opens another top-level const of the component. */
function block(aStart: string): string {
  const at = HOME.indexOf(aStart);
  expect(at).toBeGreaterThan(0);
  const next = HOME.slice(at + aStart.length).search(/\n {2}const [a-zA-Z]+ = /);
  return HOME.slice(at, next < 0 ? undefined : at + aStart.length + next);
}

describe("the home page's account list", () => {
  it('is asked for as the account opens, before the reconcile runs', () => {
    const effect = block('  const userId = session?.user.id;');
    const list = effect.indexOf('cloudOnlyProjects(userId)');
    const sync = effect.indexOf('syncAllProjects(userId');
    expect(list).toBeGreaterThan(0);
    expect(sync).toBeGreaterThan(list);
  });

  it("feeds the Open Project window's registry", () => {
    expect(HOME).toMatch(
      /useEffect\(\(\) => setCloudOnlyProjects\(cloudOnlyHere\), \[cloudOnlyHere\]\);/,
    );
  });

  it('shows in Open Recent, after the projects on this device', () => {
    expect(block('  const recentProjects = useMemo')).toMatch(
      /\.\.\.saved,\s*\.\.\.cloudOnlyHere\.map/,
    );
    expect(HOME).toMatch(/recent: recentProjects,/);
  });

  it('counts as taken names, so a new project cannot duplicate one that has not downloaded', () => {
    expect(block('  const takenProjectNames = useMemo')).toMatch(
      /\[\.\.\.saved, \.\.\.cloudOnlyHere\]/,
    );
  });

  it('pulls a project that is only in the account before opening it', () => {
    const open = block('  const openStored = async (');
    const pull = open.indexOf('await pullProjectNow(userId, remote)');
    const load = open.indexOf('await loadProject(id)');
    expect(pull).toBeGreaterThan(0);
    expect(load).toBeGreaterThan(pull);
  });
});

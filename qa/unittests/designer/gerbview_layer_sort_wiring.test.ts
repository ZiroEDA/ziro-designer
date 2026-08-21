// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * Where GerbView applies a layer sort.
 *
 * `unittests/gerbview/layer_sort.test.ts` pins the two comparators. This pins
 * the four places upstream runs one, because a correct comparator that nothing
 * calls leaves the layers exactly as unsorted as having no comparator at all —
 * which is what ours was: both context-menu entries were rendered greyed out
 * and no load path sorted anything.
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { layerContextMenu } from '@ziroeda/designer/src/editors/gerbview/layer_widget.js';

const VIEWER = readFileSync(
  fileURLToPath(
    new URL('../../../designer/src/editors/gerbview/GerberViewer.tsx', import.meta.url),
  ),
  'utf8',
);

/** The viewer's source with comments blanked — prose must not read as code. */
const CODE = VIEWER.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '');

const noop = (): void => {};
const MENU = layerContextMenu({
  showAll: noop,
  hideAllButActive: noop,
  hideAll: noop,
  sortByX2: noop,
  sortByFileExtension: noop,
  moveUp: noop,
  moveDown: noop,
  clearLayer: noop,
});
const item = (label: string): { disabled?: boolean; action?: () => void } | undefined =>
  MENU.find((m) => 'label' in m && m.label === label) as
    | { disabled?: boolean; action?: () => void }
    | undefined;

describe('the layers manager right-click menu', () => {
  it('found the menu, so this cannot pass by scanning nothing', () => {
    expect(MENU.length).toBeGreaterThan(8);
  });

  for (const label of ['Sort Layers if X2 Mode', 'Sort Layers by File Extension']) {
    it(`"${label}" runs, rather than sitting greyed out`, () => {
      // ID_SORT_GBR_LAYERS_X2 / ID_SORT_GBR_LAYERS_FILE_EXT are two ordinary
      // enabled entries upstream (`gerbview_layer_widget.cpp:176-181,253-259`).
      const entry = item(label);
      expect(entry, `${label} is missing from the menu`).toBeDefined();
      expect(entry?.disabled ?? false, `${label} is still greyed`).toBe(false);
      expect(typeof entry?.action).toBe('function');
    });
  }

  it('and the one entry that IS greyed still is, so this is not "nothing is disabled"', () => {
    // ID_ALWAYS_SHOW_NO_LAYERS_BUT_ACTIVE drives a mode we do not hold.
    expect(item('Always Hide All Layers But Active')?.disabled).toBe(true);
  });
});

describe('the four automatic sorts', () => {
  it('a job file always sorts by X2 attributes', () => {
    // `SortLayersByX2Attributes();`   job_file_reader.cpp:235
    const at = CODE.indexOf('const applyJobFile');
    expect(at).toBeGreaterThanOrEqual(0);
    const body = CODE.slice(at, CODE.indexOf('const loadZip', at));
    expect(body).toMatch(/sortByX2\(\)/);
  });

  it('a zip picks the sort by whether anything in it was X2', () => {
    // `if( foundX2Gerbers ) SortLayersByX2Attributes();
    //  else SortLayersByFileExtension();`   files.cpp:631-634
    const at = CODE.indexOf('const loadZip');
    const body = CODE.slice(at, CODE.indexOf('const loadFiles', at));
    expect(body).toMatch(/isX2File\(l\.image\)\) \? byZOrder : byFileExtension/);
  });

  it('a zip sorts every time, not only when it is the first thing loaded', () => {
    // The asymmetry against a plain Open, and it is upstream's: the zip path
    // has no isFirstFile guard at all.
    const at = CODE.indexOf('const loadZip');
    const body = CODE.slice(at, CODE.indexOf('const loadFiles', at));
    expect(body).not.toMatch(/isFirstFile/);
  });

  it('a plain Open sorts by file extension only when nothing was loaded before', () => {
    // `bool isFirstFile = GetImagesList()->GetLoadedImageCount() == 0;`  files.cpp:178
    // `if( isFirstFile ) { ... SortLayersByFileExtension(); ... }`       files.cpp:184-193
    const at = CODE.indexOf('const loadFiles');
    const body = CODE.slice(at, CODE.indexOf('const openLocalFiles', at));
    expect(body).toMatch(/const isFirstFile = nextLayer\.current === 0;/);
    expect(body).toMatch(/if \(isFirstFile && !selfSorted\) sortByFileExtension\(\);/);
  });

  it('and reads isFirstFile before loading, not after', () => {
    // Read after the loop it would always be false and the sort would never
    // run — the same shape of bug as the empty info box, one line earlier or
    // later deciding whether a whole feature happens.
    const at = CODE.indexOf('const loadFiles');
    const body = CODE.slice(at, CODE.indexOf('const openLocalFiles', at));
    expect(body.indexOf('const isFirstFile')).toBeLessThan(body.indexOf('for (const f of arr)'));
  });

  it('does not sort twice when the batch carried a zip or a job file', () => {
    // Those two paths run their own upstream sort; re-sorting by extension
    // behind them would overwrite an X2 order with a weaker one.
    const at = CODE.indexOf('const loadFiles');
    const body = CODE.slice(at, CODE.indexOf('const openLocalFiles', at));
    expect(body).toMatch(/selfSorted = true;/);
  });
});

describe('the sort itself', () => {
  it('is stable, so ties keep load order', () => {
    // Ties are the COMMON case: .GBR is the third mask in the table, so every
    // file of a modern KiCad plot ties at BOARD_OUTLINE. Upstream's std::sort
    // leaves those in an unspecified permutation; a stable sort is the one
    // deterministic answer inside that range.
    expect(CODE).toMatch(/prev\.slice\(\)\.sort\(compare\)/);
  });

  it('returns the previous array when nothing moved', () => {
    // Otherwise every sort is a new array identity and React re-renders the
    // whole pane on a no-op — and a plain Open runs one on every first load.
    expect(CODE).toMatch(/next\.every\(\(l, i\) => l === prev\[i\]\) \? prev : next/);
  });
});

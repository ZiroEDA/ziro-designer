// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * Attribution for the KiCad work this project reuses
 * (NOTICE.md, designer/src/pcm/defaultRepo.ts, dialog_about.tsx).
 *
 * Licence compatibility is not the issue here: this project is GPL-3.0-or-later
 * and so is KiCad, so porting the code and reusing the icons is permitted.
 * Attribution is the obligation that survives that compatibility, and it is the
 * one that is easy to lose in a refactor, because nothing breaks when it goes.
 *
 * The bundled symbol libraries are the sharp case. They are reproduced verbatim
 * from KiCad's official libraries under CC-BY-SA 4.0, whose central term is
 * credit to the author, so naming ourselves author there is not a cosmetic slip.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { DEFAULT_REPOSITORY } from '@ziroeda/designer/src/pcm/defaultRepo.js';

const ROOT = new URL('../../../', import.meta.url).pathname;
const read = (p: string): string => readFileSync(join(ROOT, p), 'utf8');

describe('NOTICE.md', () => {
  const notice = read('NOTICE.md');

  it('credits KiCad for the ported source and the icons', () => {
    expect(notice).toContain('The KiCad Developers');
    expect(notice).toMatch(/GNU General Public License/);
    expect(notice).toMatch(/icons/i);
  });

  it('credits the KiCad Libraries Team, with the exception that matters to users', () => {
    expect(notice).toContain('KiCad Libraries Team');
    expect(notice).toMatch(/Attribution-ShareAlike 4\.0/);
    expect(notice).toMatch(/exception/i);
  });

  it('carries the MIT notice for rectpack2d verbatim, as MIT requires', () => {
    expect(notice).toContain('rectpack2d');
    expect(notice).toContain(
      'The above copyright notice and this permission notice shall be included in all',
    );
  });

  it('states that ZiroEDA is not affiliated with the KiCad project', () => {
    expect(notice).toMatch(/not affiliated with or endorsed by/i);
  });
});

describe('bundled packages name their real author', () => {
  const packages = DEFAULT_REPOSITORY.packages;

  it('has symbol library packages', () => {
    expect(packages.some((p) => p.kind === 'library')).toBe(true);
  });

  it('never claims ZiroEDA authored KiCad library content', () => {
    for (const pkg of packages.filter((p) => p.kind === 'library')) {
      expect(pkg.author.name).not.toMatch(/ziro/i);
      expect(pkg.author.name).toContain('KiCad');
    }
  });

  it('licenses the libraries as CC-BY-SA with the KiCad exception', () => {
    for (const pkg of packages.filter((p) => p.kind === 'library')) {
      expect(pkg.license).toContain('CC-BY-SA-4.0');
      expect(pkg.license).toMatch(/exception/i);
      // A licence claim with nowhere to read the terms is not much of a claim.
      expect(pkg.resources?.license).toBeTruthy();
    }
  });

  it("does not claim MIT on themes derived from KiCad's GPL palette", () => {
    for (const pkg of packages.filter((p) => p.kind === 'colortheme')) {
      expect(pkg.license).not.toBe('MIT');
      expect(pkg.license).toContain('GPL');
    }
  });
});

describe('in-app attribution', () => {
  const about = read('designer/src/home/dialogs/dialog_about.tsx');

  it('the About dialog credits both KiCad sources and their two licences', () => {
    expect(about).toContain('The KiCad Developers');
    expect(about).toContain('KiCad Libraries Team');
    expect(about).toContain('GPL-3.0-or-later');
    expect(about).toContain('CC-BY-SA 4.0');
  });

  it('is reachable from every editor, not just the home screen', () => {
    // Attribution nobody can open is not attribution. These Help menus used to
    // be no-op stubs while the dialog existed only on the home screen.
    for (const f of [
      'designer/src/editors/pcb/PcbEditor.tsx',
      'designer/src/editors/symbol/SymbolEditor.tsx',
      'designer/src/editors/footprint/FootprintEditor.tsx',
      'designer/src/home/HomePage.tsx',
    ]) {
      expect(read(f)).toContain('AboutDialog');
    }
  });

  it('leaves no dead About menu entries behind', () => {
    for (const f of [
      'designer/src/editors/pcb/PcbEditor.tsx',
      'designer/src/editors/symbol/SymbolEditor.tsx',
      'designer/src/editors/footprint/FootprintEditor.tsx',
    ]) {
      expect(read(f)).not.toMatch(/About [^']*', action: \(\) => \{\}/);
    }
  });
});

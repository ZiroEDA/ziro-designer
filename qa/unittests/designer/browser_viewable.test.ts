// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * Which files the project tree opens in a tab, and which it leaves alone.
 *
 * `PROJECT_TREE_ITEM::Activate` ends four of its branches in the operating
 * system — `OpenPDF` through gestfich, `wxLaunchDefaultBrowser`,
 * `KICAD_MANAGER_ACTIONS::openTextEditor`, `wxLaunchDefaultApplication`. A
 * browser has no shell to hand a path to, but it IS the PDF viewer, the
 * default browser and the image viewer, so those branches are answered rather
 * than dropped.
 *
 * Worth executing because both mistakes are silent. A type wrongly renderable
 * opens a tab full of binary; a type wrongly not renderable does nothing at
 * all when double-clicked, which reads as a dead row.
 */
import { describe, expect, it } from 'vitest';
import { browserViewableMime } from '@ziroeda/designer/src/home/file_activation.js';

describe('files the browser renders', () => {
  it('gives each one the type it must be served as', () => {
    // A PDF served as octet-stream downloads instead of displaying, which is
    // exactly what this used to do.
    expect(browserViewableMime('CM5_MINIMA_3.pdf')).toBe('application/pdf');
    expect(browserViewableMime('img/RoyalBlue54L-Feather-Pinout.svg')).toBe('image/svg+xml');
    expect(browserViewableMime('report.html')).toBe('text/html');
    expect(browserViewableMime('report.htm')).toBe('text/html');
    expect(browserViewableMime('board.png')).toBe('image/png');
    expect(browserViewableMime('photo.JPG')).toBe('image/jpeg');
  });

  it('is case-insensitive, because real projects are not tidy', () => {
    // The shipped CM5 demo carries `.STEP` and `.stp` in one folder.
    expect(browserViewableMime('DATASHEET.PDF')).toBe('application/pdf');
  });
});

describe('files it does not', () => {
  it('leaves archives and CAD payloads alone', () => {
    // Nothing to show. `Download...` in the tree's context menu is where these
    // are meant to be fetched from.
    expect(browserViewableMime('GERBER-RoyalBlue54L.zip')).toBeNull();
    expect(browserViewableMime('hailo8.STEP')).toBeNull();
    expect(browserViewableMime('part.stp')).toBeNull();
    expect(browserViewableMime('version.bin')).toBeNull();
  });

  it('leaves the KiCad documents alone, which have real editors', () => {
    // These never reach this helper — they activate into an editor — but if
    // one ever did, opening it in a tab would be the wrong answer.
    expect(browserViewableMime('board.kicad_pcb')).toBeNull();
    expect(browserViewableMime('sheet.kicad_sch')).toBeNull();
  });

  it('has no opinion about a file with no extension', () => {
    expect(browserViewableMime('fp-lib-table')).toBeNull();
  });
});

/**
 * The browser tab title (the frames' `UpdateTitle()`): the open document first,
 * marked with `*` while modified, then the editor's name. The document leads
 * because a tab truncates from the right — and every view names itself, so a
 * hidden editor's placeholder can no longer own the tab.
 */
import { describe, it, expect } from 'vitest';
import { APP_NAME, formatTitle } from '../../../designer/src/ui/useDocumentTitle.js';

describe('formatTitle', () => {
  it('names the document, then the editor', () => {
    expect(formatTitle('Schematic Editor', 'ecc83.kicad_sch [ecc83]')).toBe(
      `ecc83.kicad_sch [ecc83] — Schematic Editor · ${APP_NAME}`,
    );
  });

  it('marks unsaved changes with a leading *', () => {
    expect(formatTitle('PCB Editor', 'ecc83.kicad_pcb', true)).toBe(
      `*ecc83.kicad_pcb — PCB Editor · ${APP_NAME}`,
    );
  });

  it('falls back to the editor name instead of a bracketed placeholder', () => {
    expect(formatTitle('Footprint Editor')).toBe(`Footprint Editor · ${APP_NAME}`);
    expect(formatTitle('Footprint Editor', null, true)).toBe(`Footprint Editor · ${APP_NAME}`);
    expect(formatTitle('Symbol Editor', '  ')).toBe(`Symbol Editor · ${APP_NAME}`);
  });
});

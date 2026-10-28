// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * `MAIL_SCH_GET_ITEM` (eeschema/cross-probing.cpp:1051-1067): the payload is a KIID; ResolveItem
 * finds it anywhere in the hierarchy, and the answer written back is a sheet's
 * GetShownName( false ), a symbol's GetRef( &path, true ) on the sheet it was found on, or any
 * other item's GetFriendlyName(). An unknown KIID leaves the payload as it came.
 */
import { resolve } from 'node:path';
import { FRAME_T } from '@ziroeda/common/frame_type.js';
import { KIWAY_MAIL_EVENT } from '@ziroeda/common/kiway_mail.js';
import { MAIL_T } from '@ziroeda/common/mail_type.js';
import { PGM_BASE, SETTINGS_MANAGER, SetPgm } from '@ziroeda/common/pgm_base.js';
import { KICAD_T } from '@ziroeda/core/typeinfo.js';
import type { SCH_EDIT_FRAME } from '@ziroeda/eeschema/sch_edit_frame.js';
import type { SCH_SHEET } from '@ziroeda/eeschema/sch_sheet.js';
import type { SCH_SYMBOL } from '@ziroeda/eeschema/sch_symbol.js';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { openProject, schFrame, schToolHarness } from './support/sch_tool_harness.js';

const ORACLE = resolve(__dirname, '../../data/eeschema/netlist_oracle/complex_hierarchy');
const SHEETS = ['complex_hierarchy.kicad_sch', 'ampli_ht.kicad_sch', 'complex_hierarchy.kicad_pro'];

beforeEach(() => SetPgm(new PGM_BASE(null, new SETTINGS_MANAGER())));
afterEach(() => SetPgm(null));

function getItem(aFrame: SCH_EDIT_FRAME, aKiid: string): string {
  const payload = { value: aKiid };
  aFrame.KiwayMailIn(new KIWAY_MAIL_EVENT(FRAME_T.FRAME_SCH, MAIL_T.MAIL_SCH_GET_ITEM, payload));
  return payload.value;
}

function setUp() {
  const h = schToolHarness(schFrame({}));
  openProject(h.frame, ORACLE, 'complex_hierarchy', SHEETS);
  const root = h.frame.Schematic().Hierarchy()[0]!;
  return { frame: h.frame, root };
}

describe('MAIL_SCH_GET_ITEM', () => {
  it('a symbol answers its reference on the sheet it was found on, with the unit', () => {
    const { frame } = setUp();
    for (const sheet of frame.Schematic().Hierarchy()) {
      const sym = [...sheet.LastScreen()!.Items().OfType(KICAD_T.SCH_SYMBOL_T)].find((s) =>
        (s as SCH_SYMBOL).IsMultiUnit(),
      ) as SCH_SYMBOL | undefined;
      if (!sym) continue;
      // GetRef( &path, true ): the unit letter is part of the answer.
      expect(getItem(frame, sym.m_Uuid)).toBe(sym.GetRef(sheet, true));
      expect(getItem(frame, sym.m_Uuid)).not.toBe(sym.GetRef(sheet, false));
      return;
    }
    throw new Error('fixture has no multi-unit symbol');
  });

  it('a sheet answers its shown name', () => {
    const { frame, root } = setUp();
    const sheet = [...root.LastScreen()!.Items().OfType(KICAD_T.SCH_SHEET_T)][0] as SCH_SHEET;
    expect(getItem(frame, sheet.m_Uuid)).toBe(sheet.GetShownName(false));
  });

  it('anything else answers its friendly name', () => {
    const { frame, root } = setUp();
    const wire = [...root.LastScreen()!.Items().OfType(KICAD_T.SCH_LINE_T)][0]!;
    expect(getItem(frame, wire.m_Uuid)).toBe(wire.GetFriendlyName());
  });

  it('an unknown KIID leaves the payload alone', () => {
    const { frame } = setUp();
    const unknown = '01234567-89ab-cdef-0123-456789abcdef';
    expect(getItem(frame, unknown)).toBe(unknown);
  });
});

/**
 * MAIL_RELOAD_LIB (cross-probing.cpp:1145-1151): InvokeEditDesignBlockLibTable sends it after the
 * table changed, and the Design Blocks pane lists the libraries again.
 */
describe('MAIL_RELOAD_LIB', () => {
  it('refreshes the Design Blocks pane', () => {
    const { frame } = setUp();
    let refreshed = 0;
    frame.m_designBlocksPane = {
      RefreshLibs: () => {
        refreshed++;
      },
    } as unknown as NonNullable<SCH_EDIT_FRAME['m_designBlocksPane']>;

    frame.KiwayMailIn(
      new KIWAY_MAIL_EVENT(FRAME_T.FRAME_SCH, MAIL_T.MAIL_RELOAD_LIB, { value: '' }),
    );

    expect(refreshed).toBe(1);
  });

  it('is a no-op with no pane', () => {
    const { frame } = setUp();
    frame.m_designBlocksPane = null;
    expect(() =>
      frame.KiwayMailIn(
        new KIWAY_MAIL_EVENT(FRAME_T.FRAME_SCH, MAIL_T.MAIL_RELOAD_LIB, { value: '' }),
      ),
    ).not.toThrow();
  });
});

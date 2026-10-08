// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * SCH_BASE_FRAME::GetLibSymbol (sch_base_frame.cpp:282) in the browser: a hosted library symbol is
 * fetched (its per-symbol file) into the download folder and read by SCH_IO_KICAD_SEXPR, KiCad's
 * own reader; the host not having it is null, as SchGetLibSymbol's null.
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { LIB_ID } from '@ziroeda/common/lib_id.js';
import { PGM_BASE, SETTINGS_MANAGER, SetPgm } from '@ziroeda/common/pgm_base.js';
import { configureSymbolLibraryAdapter } from '@ziroeda/eeschema/libraries/symbol_library_adapter.js';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { schFrame } from './support/sch_tool_harness.js';

const R = readFileSync(resolve(__dirname, '../../data/R.kicad_sym'), 'utf8');
const fetched: string[] = [];

beforeEach(() => {
  SetPgm(new PGM_BASE(null, new SETTINGS_MANAGER()));
  configureSymbolLibraryAdapter({
    symbolsBase: () => 'https://host/symbols',
    fetchIndex: async () => [],
    trackLoad: (_l, w) => w,
    loadLibraryItemsPooled: async () => [],
  });
  fetched.length = 0;
  vi.stubGlobal('fetch', async (url: string) => {
    fetched.push(url);
    return url.endsWith('/Device/R.kicad_sym')
      ? new Response(R)
      : new Response('', { status: 404 });
  });
});
afterEach(() => {
  vi.unstubAllGlobals();
  SetPgm(null);
});

describe('SCH_BASE_FRAME::GetLibSymbol', () => {
  it('reads a hosted symbol with KiCad’s reader, fetching its file once', async () => {
    const frame = schFrame({});

    const sym = await frame.GetLibSymbol(new LIB_ID('Device', 'R'));
    expect(sym?.GetName()).toBe('R');
    expect(sym?.GetPins().length).toBeGreaterThan(0);

    await frame.GetLibSymbol(new LIB_ID('Device', 'R'));
    expect(fetched.filter((u) => u.endsWith('/Device/R.kicad_sym'))).toHaveLength(1);
  });

  it('is null for a symbol the host does not have', async () => {
    const frame = schFrame({});
    expect(await frame.GetLibSymbol(new LIB_ID('Device', 'NoSuchPart'))).toBe(null);
  });
});

// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
/**
 * The file tests again, in a pseudo-language: `pnpm -C qa test:pseudo`.
 *
 * Every KiCad message translates to `⟪message⟫` here (see
 * `unittests/translation/pseudo_catalog.setup.ts`). What a file holds must not
 * change with the interface language, so every reader, writer, exporter and
 * oracle test below has to pass exactly as it does in English. One that fails
 * is a message marked `_()` where KiCad stores English - a keyword, a token, a
 * default name - and a German user would have it written into their files.
 */
import { defineConfig, mergeConfig } from 'vitest/config';
import base from './vitest.config.js';

export default mergeConfig(
  base,
  defineConfig({
    test: {
      setupFiles: ['unittests/translation/pseudo_catalog.setup.ts'],
      include: [
        'unittests/translation/*.pseudo.ts',
        'unittests/**/*oracle*.test.ts',
        'unittests/**/*roundtrip*.test.ts',
        'unittests/**/*round_trip*.test.ts',
        'unittests/**/*{writer,parser,_io_,sexpr,netlist,plot,export,drill,gerber,fab_,bom,json_dump,project_file,_save,save_}*.test.ts',
        'unittests/eeschema/sch_io*/**/*.test.ts',
        'unittests/pcbnew/pcb_io*/**/*.test.ts',
      ],
      exclude: [
        'unittests/translation/**/*.test.ts',
        '**/node_modules/**',
        // An ERC report is written in the interface language: RC_ITEM::ShowReport takes
        // GetErrorMessage( true ) and GetItemDescription, both translated. kicad-cli's English
        // report cannot be its oracle in another language.
        'unittests/eeschema/erc/erc_oracle.test.ts',
      ],
    },
  }),
);

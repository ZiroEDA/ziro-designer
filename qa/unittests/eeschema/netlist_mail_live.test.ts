// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * MAIL_SCH_GET_NETLIST answered from the frame's live SCHEMATIC (cross-probing.cpp:1028):
 * ReadyToNetlist (netlist_generator.cpp:202), then NETLIST_EXPORTER_KICAD. The nets are
 * kicad-cli's own `sch export netlist` of the same project.
 */
import { readFileSync, readdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { FRAME_T } from '@ziroeda/common/frame_type.js';
import { KIWAY_MAIL_EVENT } from '@ziroeda/common/kiway_mail.js';
import { MAIL_T } from '@ziroeda/common/mail_type.js';
import { PGM_BASE, SETTINGS_MANAGER, SetPgm } from '@ziroeda/common/pgm_base.js';
import { Reporter } from '@ziroeda/common/reporter.js';
import { KICAD_T } from '@ziroeda/core/typeinfo.js';
import { symbolLibraryUri } from '@ziroeda/eeschema/cross-probing.js';
import { SCH_COMMIT } from '@ziroeda/eeschema/sch_commit.js';
import { SCH_EDIT_FRAME, type SCH_EDIT_FRAME_HOOKS } from '@ziroeda/eeschema/sch_edit_frame.js';
import {
  ANNOTATE_ALGO_T,
  ANNOTATE_ORDER_T,
  ANNOTATE_SCOPE_T,
} from '@ziroeda/eeschema/sch_reference_list.js';
import type { SCH_SHEET } from '@ziroeda/eeschema/sch_sheet.js';
import { SYMBOL_FILTER } from '@ziroeda/eeschema/sch_sheet_path.js';
import type { SCH_SYMBOL } from '@ziroeda/eeschema/sch_symbol.js';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

const ORACLE = resolve(__dirname, '../../data/eeschema/netlist_oracle/complex_hierarchy');
const SHEETS = ['complex_hierarchy.kicad_sch', 'ampli_ht.kicad_sch', 'complex_hierarchy.kicad_pro'];

beforeEach(() => SetPgm(new PGM_BASE(null, new SETTINGS_MANAGER())));
afterEach(() => SetPgm(null));

function frameWith(hooks: Partial<SCH_EDIT_FRAME_HOOKS>) {
  const frame = new SCH_EDIT_FRAME({
    crossProbingSettings: () => ({}) as ReturnType<SCH_EDIT_FRAME_HOOKS['crossProbingSettings']>,
    saveProject: () => true,
    getNetlist: () => 'RECORD NETLIST',
    syncLiveSchematic: () => true,
    // The project's sym-lib-table, as the window gives it.
    symbolLibraryUri: symbolLibraryUri(
      readdirSync(ORACLE)
        .filter((n) => n === 'sym-lib-table')
        .map((n) => ({ name: n, text: readFileSync(join(ORACLE, n), 'utf8') })),
    ),
    ...hooks,
  });
  frame.OpenProjectFiles([`/complex_hierarchy/${SHEETS[0]}`], 0, (p) => {
    const n = SHEETS.find((s) => p === `/complex_hierarchy/${s}`);
    return n ? readFileSync(join(ORACLE, n), 'utf8') : null;
  });
  return frame;
}

const mail = (frame: SCH_EDIT_FRAME, aPayload: string) => {
  const payload = { value: aPayload };
  frame.KiwayMailIn(new KIWAY_MAIL_EVENT(FRAME_T.FRAME_SCH, MAIL_T.MAIL_SCH_GET_NETLIST, payload));
  return payload.value;
};

/** From `(components` to the end: everything after the design header's date and tool. */
const body = (aNetlist: string) => aNetlist.slice(aNetlist.indexOf('\t(components'));

describe('MAIL_SCH_GET_NETLIST from the live frame', () => {
  it("answers with kicad-cli's components, libparts, libraries and nets", () => {
    const answer = mail(frameWith({}), '');
    expect(answer.startsWith('(export')).toBe(true);
    expect(body(answer)).toBe(
      body(readFileSync(join(ORACLE, 'complex_hierarchy.kicad-cli.net'), 'utf8')),
    );
  });

  it('asks the annotate dialog when a symbol is unannotated, and gives up if it stays so', () => {
    const asked: string[] = [];
    const frame = frameWith({ modalAnnotate: (m) => asked.push(m) });
    const symbol = frame
      .Schematic()
      .RootScreen()!
      .Items()
      .OfType(KICAD_T.SCH_SYMBOL_T)[0] as SCH_SYMBOL;
    symbol.ClearAnnotation(null, false);

    expect(mail(frame, 'Please annotate')).toBe('Please annotate'); // payload left alone
    expect(asked).toEqual(['Please annotate']);
  });

  it('goes on when the annotate dialog annotated', () => {
    let frame: SCH_EDIT_FRAME;
    const annotate = () => {
      const commit = new SCH_COMMIT(frame);
      frame.AnnotateSymbols(
        commit,
        ANNOTATE_SCOPE_T.ANNOTATE_ALL,
        ANNOTATE_ORDER_T.SORT_BY_X_POSITION,
        ANNOTATE_ALGO_T.INCREMENTAL_BY_REF,
        true,
        0,
        false,
        false,
        false,
        new Reporter(),
        SYMBOL_FILTER.SYMBOL_FILTER_NON_POWER,
      );
      commit.Push('Annotate');
    };
    frame = frameWith({ modalAnnotate: annotate });
    const symbol = frame
      .Schematic()
      .RootScreen()!
      .Items()
      .OfType(KICAD_T.SCH_SYMBOL_T)[0] as SCH_SYMBOL;
    symbol.ClearAnnotation(null, false);

    expect(mail(frame, 'Please annotate').startsWith('(export')).toBe(true);
  });

  it('asks to go on past duplicate sheet names', () => {
    const asked: string[] = [];
    const run = (answer: boolean) => {
      const frame = frameWith({
        isOK: (m) => {
          asked.push(m);
          return answer;
        },
      });
      const [a, b] = frame
        .Schematic()
        .RootScreen()!
        .Items()
        .OfType(KICAD_T.SCH_SHEET_T) as unknown as SCH_SHEET[];
      b!.SetName(a!.GetName());
      return mail(frame, 'annotate');
    };

    expect(run(false)).toBe('annotate');
    expect(run(true).startsWith('(export')).toBe(true);
    expect(asked).toEqual([
      'Error: duplicate sheet names. Continue?',
      'Error: duplicate sheet names. Continue?',
    ]);
  });

  it('with no window to ask, does not go on past duplicate sheet names', () => {
    const frame = frameWith({});
    const [a, b] = frame
      .Schematic()
      .RootScreen()!
      .Items()
      .OfType(KICAD_T.SCH_SHEET_T) as unknown as SCH_SHEET[];
    b!.SetName(a!.GetName());
    expect(mail(frame, 'annotate')).toBe('annotate');
  });

  it('skips ReadyToNetlist for an empty payload, as upstream does', () => {
    const asked: string[] = [];
    const frame = frameWith({ modalAnnotate: (m) => asked.push(m) });
    const symbol = frame
      .Schematic()
      .RootScreen()!
      .Items()
      .OfType(KICAD_T.SCH_SYMBOL_T)[0] as SCH_SYMBOL;
    symbol.ClearAnnotation(null, false);
    expect(mail(frame, '').startsWith('(export')).toBe(true);
    expect(asked).toEqual([]);
  });

  it('answers from the records while the window keeps no live schematic', () => {
    expect(mail(frameWith({ syncLiveSchematic: undefined }), 'x')).toBe('RECORD NETLIST');
  });

  it('leaves the payload alone when the live schematic cannot be brought up to date', () => {
    expect(mail(frameWith({ syncLiveSchematic: () => false }), 'x')).toBe('x');
  });
});

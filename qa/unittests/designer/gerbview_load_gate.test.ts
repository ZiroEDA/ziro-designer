// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * The three gates before GerbView's parser, and what it says when one fires.
 *
 * `unittests/gerbview/file_detect.test.ts` pins the sniffs; this pins the
 * decision they feed and the strings, which carry their own HTML because
 * `HTML_MESSAGE_BOX::ListSet` renders each message as an `<li>`.
 */
import { describe, expect, it } from 'vitest';
import {
  ERRORS_CAPTION,
  MSG_JOB_FILE_AS_PLOT,
  MSG_NOT_LOADED,
  MSG_NO_MORE_LAYER,
  decideLoad,
} from '@ziroeda/designer/src/editors/gerbview/gerber_load_report.js';

const GERBER = ['%FSLAX46Y46*%', '%ADD10C,0.5*%', 'D10*', 'X0Y0D03*', 'M02*'].join('\n');
const DRILL = ['M48', 'FMAT,2', 'T1C0.800', 'T1', 'X10.0Y20.0', 'M30'].join('\n');

describe('the strings', () => {
  it('are upstream’s, HTML markers included', () => {
    // files.cpp:45-46 and :305-306. The bold heading and italic filename in a
    // live Errors box are these, not styling of ours.
    expect(MSG_NOT_LOADED).toBe('<b>Not loaded:</b> <i>%s</i>');
    expect(MSG_NO_MORE_LAYER).toBe('<b>No more available layers</b> in GerbView to load files');
    expect(MSG_JOB_FILE_AS_PLOT).toBe(
      '<b>A gerber job file cannot be loaded as a plot file</b> <i>%s</i>',
    );
    expect(ERRORS_CAPTION).toBe('Errors');
  });

  it('and MSG_NO_MORE_LAYER names no file, unlike the other two', () => {
    // It is not a format string upstream either — the files it displaces are
    // reported separately, each with MSG_NOT_LOADED.
    expect(MSG_NO_MORE_LAYER).not.toContain('%s');
  });
});

describe('a gerber job file', () => {
  it('is refused by NAME, before anything is read', () => {
    // `if( filename.GetExt() == FILEEXT::GerberJobFileExtension.c_str() )`
    // (`files.cpp:302`) — ahead of the content sniff, so even a .gbrjob that
    // somehow parsed as a gerber would still be refused.
    expect(decideLoad('board-job.gbrjob', GERBER, 2)).toStrictEqual({
      kind: 'refuse',
      message: '<b>A gerber job file cannot be loaded as a plot file</b> <i>board-job.gbrjob</i>',
    });
  });

  it('is refused on every file type, not only autodetect', () => {
    // The check is outside the type switch entirely.
    for (const type of [0, 1, 2] as const) {
      expect(decideLoad('a.gbrjob', '{}', type).kind, `type ${type}`).toBe('refuse');
    }
  });
});

describe('autodetect', () => {
  it('parses a drill file as a drill file', () => {
    expect(decideLoad('a.drl', DRILL, 2)).toStrictEqual({ kind: 'parse', type: 1 });
  });

  it('parses a gerber as a gerber', () => {
    expect(decideLoad('a.gbr', GERBER, 2)).toStrictEqual({ kind: 'parse', type: 0 });
  });

  it('refuses anything else, naming it', () => {
    // The bug Akshay found: ours loaded these as empty gerber layers.
    expect(decideLoad('notes.txt', 'hello\n', 2)).toStrictEqual({
      kind: 'refuse',
      message: '<b>Not loaded:</b> <i>notes.txt</i>',
    });
  });
});

describe('the typed entries do not sniff', () => {
  it('Open Gerber File(s) parses as a gerber whatever the content', () => {
    // Upstream passes 0 for every file and goes straight to Read_GERBER_File;
    // only type 2 runs the tests. Sniffing here would be a deviation that
    // happens to look helpful.
    expect(decideLoad('a.gbr', DRILL, 0)).toStrictEqual({ kind: 'parse', type: 0 });
    expect(decideLoad('a.gbr', 'not a gerber at all', 0)).toStrictEqual({
      kind: 'parse',
      type: 0,
    });
  });

  it('Open NC Drill File(s) parses as a drill file whatever the content', () => {
    expect(decideLoad('a.drl', GERBER, 1)).toStrictEqual({ kind: 'parse', type: 1 });
  });
});

describe('no free layer', () => {
  it('refuses with MSG_NOT_LOADED, before the name or the content is looked at', () => {
    // `if( layer == NO_AVAILABLE_LAYERS ) { ... while( ii < count ) report
    // MSG_NOT_LOADED ... break; }` (`files.cpp:338-351`) — the remaining files
    // are named without being read, so this gate comes first.
    expect(decideLoad('a.gbr', GERBER, 2, { noMoreLayers: true })).toStrictEqual({
      kind: 'refuse',
      message: '<b>Not loaded:</b> <i>a.gbr</i>',
    });
    // Even a job file, which would otherwise get its own message.
    const job = decideLoad('a.gbrjob', '{}', 2, { noMoreLayers: true });
    expect(job.kind).toBe('refuse');
    if (job.kind === 'refuse') expect(job.message).toContain('Not loaded');
  });
});

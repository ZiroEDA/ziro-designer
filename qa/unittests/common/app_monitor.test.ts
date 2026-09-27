// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
/**
 * `APP_MONITOR` (common/app_monitor.cpp) over a backend of the test's own:
 * what reaches Sentry, when, and what upstream's opt-in files do.
 */
import { afterEach, describe, expect, it } from 'vitest';
import {
  AddBreadcrumb,
  AddNavigationBreadcrumb,
  BREADCRUMB_LEVEL,
  BREADCRUMB_TYPE,
  SENTRY,
  type SENTRY_BACKEND,
  SetSentryBackend,
} from '@ziroeda/common/app_monitor.js';
import { IO_ERROR } from '@ziroeda/common/exceptions.js';
import { HandleAssert, HandleException } from '@ziroeda/common/pgm_base.js';

interface Fake extends SENTRY_BACKEND {
  marker: boolean;
  uid: string;
  log: string[];
}

function fake(aMarker: boolean, aUid = ''): Fake {
  const f: Fake = {
    marker: aMarker,
    uid: aUid,
    log: [],
    OptInExists: () => f.marker,
    SetOptInMarker: (on) => {
      f.marker = on;
      f.log.push(`marker ${on}`);
    },
    ReadUid: () => f.uid,
    WriteUid: (u) => {
      f.uid = u;
    },
    Init: ({ uid }) => f.log.push(`init ${uid.length}`),
    Close: () => f.log.push('close'),
    SetTag: (k, v) => f.log.push(`tag ${k}=${v}`),
    CaptureException: (type, msg, tags) => f.log.push(`${type}: ${msg} ${JSON.stringify(tags)}`),
    AddBreadcrumb: (c) => f.log.push(`crumb ${JSON.stringify(c)}`),
  };
  SetSentryBackend(f);
  return f;
}

afterEach(() => {
  SetSentryBackend(null);
  SENTRY.ResetInstance();
});

describe('SENTRY', () => {
  it('is never opted in with no Sentry build linked', () => {
    expect(SENTRY.Instance().IsOptedIn()).toBe(false);
    SENTRY.Instance().LogException('x', true);
  });

  it('Init starts the SDK only when the opt-in marker exists', () => {
    const off = fake(false);
    SENTRY.Instance().Init();
    expect(off.log).toEqual([]);
    expect(SENTRY.Instance().IsOptedIn()).toBe(false);

    SENTRY.ResetInstance();
    const on = fake(true);
    SENTRY.Instance().Init();
    // readOrCreateUid: no stored id, so a new 36-character one.
    expect(on.log).toEqual(['init 36']);
    expect(on.uid).toHaveLength(36);
    expect(SENTRY.Instance().IsOptedIn()).toBe(true);
  });

  it('keeps a stored id of the right length, and replaces one of the wrong length', () => {
    const good = '0123456789abcdef0123456789abcdef0123';
    fake(true, good);
    SENTRY.Instance().Init();
    expect(SENTRY.Instance().GetSentryId()).toBe(good);

    SENTRY.ResetInstance();
    fake(true, 'short');
    SENTRY.Instance().Init();
    expect(SENTRY.Instance().GetSentryId()).toHaveLength(36);
  });

  it('opting in writes the marker and opts in, but starts nothing until the next Init', () => {
    const f = fake(false);
    SENTRY.Instance().SetSentryOptIn(true);
    expect(f.log).toEqual(['marker true']);
    expect(SENTRY.Instance().IsOptedIn()).toBe(true);
  });

  it('opting out removes the marker and closes the reporter now', () => {
    const f = fake(true);
    SENTRY.Instance().Init();
    SENTRY.Instance().SetSentryOptIn(false);
    expect(f.log.slice(1)).toEqual(['marker false', 'close']);
    expect(SENTRY.Instance().IsOptedIn()).toBe(false);
  });

  it('LogException tags whether it was handled', () => {
    const f = fake(true);
    SENTRY.Instance().Init();
    SENTRY.Instance().LogException('boom', true);
    SENTRY.Instance().LogException('bang', false);
    expect(f.log.slice(1)).toEqual([
      'exception: boom {"unhandled":"true"}',
      'exception: bang {"unhandled":"false"}',
    ]);
  });

  it('LogAssert sends each assert once, keyed by file, line, function and condition', () => {
    const f = fake(true);
    SENTRY.Instance().Init();
    const key = { file: 'a.cpp', line: 3, func: 'f', cond: 'x' };
    SENTRY.Instance().LogAssert(key, 'm');
    SENTRY.Instance().LogAssert(key, 'm');
    SENTRY.Instance().LogAssert({ ...key, line: 4 }, 'm');
    expect(f.log.filter((l) => l.startsWith('assert'))).toHaveLength(2);
  });

  it('sends nothing at all while opted out', () => {
    const f = fake(false);
    SENTRY.Instance().Init();
    SENTRY.Instance().LogException('boom', true);
    AddNavigationBreadcrumb('m', 'c');
    expect(f.log).toEqual([]);
  });
});

describe('breadcrumbs', () => {
  it('name the type in lower case, DBG and ERR spelled out, and carry a level only for ERR', () => {
    const f = fake(true);
    SENTRY.Instance().Init();
    AddNavigationBreadcrumb('open', 'frame');
    AddBreadcrumb(BREADCRUMB_TYPE.ERR, 'bad', 'io', BREADCRUMB_LEVEL.DBG);
    AddBreadcrumb(BREADCRUMB_TYPE.DBG, 'x', 'y', BREADCRUMB_LEVEL.FATAL);
    expect(f.log.slice(1)).toEqual([
      'crumb {"type":"navigation","message":"open","category":"frame"}',
      'crumb {"type":"error","message":"bad","category":"io","level":"debug"}',
      'crumb {"type":"debug","message":"x","category":"y"}',
    ]);
  });
});

describe('PGM_BASE::HandleException / HandleAssert', () => {
  it('reports an IO_ERROR only when it escaped, and any other error either way', () => {
    const f = fake(true);
    SENTRY.Instance().Init();
    HandleException(new IO_ERROR('io'), false);
    HandleException(new IO_ERROR('io'), true);
    HandleException(new Error('e'), false);
    HandleException('thrown string', false);
    HandleException('thrown string', true);
    expect(f.log.slice(1).map((l) => l.split(' {')[0])).toEqual([
      expect.stringContaining('exception: '),
      'exception: e',
      'exception: Unhandled exception of unknown type',
    ]);
  });

  it('formats an assert the way upstream does, with and without a message', () => {
    const f = fake(true);
    SENTRY.Instance().Init();
    HandleAssert('a.cpp', 3, 'f', 'x > 0', 'why');
    HandleAssert('b.cpp', 4, 'g', 'y', '');
    expect(f.log.slice(1)).toEqual([
      'assert: Assertion failed at a.cpp:3 in f: x > 0 - why {}',
      'assert: Assertion failed at b.cpp:4 in g: y {}',
    ]);
  });
});

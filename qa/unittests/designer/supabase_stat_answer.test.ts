// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
/**
 * `hasObject` asks storage `info( path )` and reads its answer here. The
 * failures are the ones production returned on 11-04 for the projects bucket,
 * as storage-js 2.110 hands them on (StorageApiError: status = HTTP status,
 * statusCode = the body's statusCode).
 */
import { describe, expect, it } from 'vitest';
import { statAnswer } from '@ziroeda/designer/src/cloud/supabaseBackend.js';

const P = 'u/blobs/1d/1dd2';

describe('statAnswer: what info() says about an object', () => {
  it('present: info() returned the row', () => {
    expect(statAnswer(P, { id: '52d1', name: P }, null)).toBe(true);
  });

  it('absent: HTTP 400 carrying NoSuchKey / 404 in its body (this project, measured)', () => {
    expect(
      statAnswer(P, null, { message: 'Object not found', status: 400, statusCode: '404' }),
    ).toBe(false);
  });

  it('absent: a storage that answers 404 itself', () => {
    expect(
      statAnswer(P, null, { message: 'Object not found', status: 404, statusCode: '404' }),
    ).toBe(false);
  });

  it('a failure to ask is not an answer: a database timeout throws, it does not say absent', () => {
    // The 544 every listing returned during the outage.
    expect(() =>
      statAnswer(P, null, {
        message: 'The connection to the database timed out',
        status: 544,
        statusCode: '544',
      }),
    ).toThrow(`stat ${P}: The connection to the database timed out`);
  });

  it('and neither is a 400 for any other reason', () => {
    expect(() =>
      statAnswer(P, null, { message: 'invalid jwt', status: 400, statusCode: '403' }),
    ).toThrow(/invalid jwt/);
  });
});

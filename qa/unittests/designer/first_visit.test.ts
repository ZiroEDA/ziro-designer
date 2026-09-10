// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * What stands between a first visit and the first screen.
 *
 * Measured with the scratch harness described in the commit that added this
 * (fresh profile, throttled network, time to the manager's launchers): the
 * entry chunk was 1496 KB, of which 799 KB was 472 toolbar SVGs inlined as
 * data: URIs — icons nothing shows until an editor frame paints — and 208 KB
 * the telemetry SDK. With both off the path the first screen came at half
 * the time at every speed tried (1306 -> 616 ms at 50 Mbps, 9.2 -> 4.7 s on
 * a 1.6 Mbps link). Read as text: both rules are build-time and boot-time
 * shape, which no rendered test reaches.
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const DESIGNER = join(__dirname, '../../../designer');
const VITE = readFileSync(join(DESIGNER, 'vite.config.ts'), 'utf8');
const SINK = readFileSync(join(DESIGNER, 'src/telemetry/sentrySink.ts'), 'utf8');

describe('bitmaps are files, as KiCad ships them', () => {
  it('nothing is inlined into the entry as a data: URI', () => {
    // Vite's default inlines any asset under 4 KB; every toolbar icon is.
    expect(VITE).toMatch(/assetsInlineLimit: 0,/);
  });
});

describe('the telemetry SDK arrives after the first paint', () => {
  it('is a dynamic import, never a static one', () => {
    expect(SINK).toMatch(/import\('@sentry\/browser'\)/);
    expect(SINK).not.toMatch(/^import \* as Sentry from '@sentry\/browser'/m);
    // Only the type may be imported statically; a type import erases.
    expect(SINK).toMatch(/^import type \* as SentryNs from '@sentry\/browser'/m);
  });

  it('queues what is captured before the SDK lands, and drains the queue into it', () => {
    expect(SINK).toMatch(/else if \(!closed\) queued\.push\(\[err, context\]\);/);
    expect(SINK).toMatch(
      /for \(const \[err, context\] of queued\.splice\(0\)\)\s*sdk\.captureException\(/,
    );
  });

  it('a close before the SDK lands stops it initialising at all', () => {
    expect(SINK).toMatch(/if \(closed\) return;\s*Sentry\.init\(/);
    expect(SINK).toMatch(/close\(\) \{[\s\S]*?closed = true;[\s\S]*?queued\.length = 0;/);
  });
});

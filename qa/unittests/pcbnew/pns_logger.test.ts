// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * `PNS::LOGGER` (pns_logger.ts): the event log's shape, `FormatEvent`'s exact
 * text (`pns_logger.cpp:108-130`), and `ParseEvent`'s matching, quirky
 * (sizes-dropping) inverse (`cpp:133-153`).
 */
import { VIATYPE } from '@ziroeda/pcbnew/pcb_track_types.js';
import { describe, expect, it } from 'vitest';
import { PnsSolid } from '@ziroeda/pcbnew/router/pns_solid.js';
import { PnsLayerRange } from '@ziroeda/pcbnew/router/pns_layerset.js';
import {
  PnsLogger,
  PnsLoggerEventType,
  type PnsLoggerEventEntry,
} from '@ziroeda/pcbnew/router/pns_logger.js';
import { PnsSizesSettings } from '@ziroeda/pcbnew/router/pns_sizes_settings.js';

function itemWithUuid(uuid: string): PnsSolid {
  const s = new PnsSolid();
  s.setLayers(new PnsLayerRange(0, 0));
  s.setParent({ uuid });
  return s;
}

describe('PnsLogger', () => {
  it('clear() empties the event log', () => {
    const logger = new PnsLogger();
    logger.log(PnsLoggerEventType.EVT_START_ROUTE);
    expect(logger.getEvents()).toHaveLength(1);
    logger.clear();
    expect(logger.getEvents()).toHaveLength(0);
  });

  it('log() wraps a single item into logM()', () => {
    const logger = new PnsLogger();
    const item = itemWithUuid('11111111-1111-1111-1111-111111111111');
    logger.log(PnsLoggerEventType.EVT_FIX, { x: 10, y: 20 }, item, null, 3);
    const [ent] = logger.getEvents();
    expect(ent).toBeDefined();
    expect(ent!.type).toBe(PnsLoggerEventType.EVT_FIX);
    expect(ent!.p).toEqual({ x: 10, y: 20 });
    expect(ent!.layer).toBe(3);
    expect(ent!.uuids).toEqual(['11111111-1111-1111-1111-111111111111']);
  });

  it('logM() collects a UUID per item that has a parent, skipping items and parents that lack one', () => {
    const logger = new PnsLogger();
    const withUuid = itemWithUuid('aaaa');
    const noParent = new PnsSolid(); // setParent never called: parent() is null
    logger.logM(PnsLoggerEventType.EVT_START_MULTIDRAG, { x: 0, y: 0 }, [withUuid, noParent, null]);
    expect(logger.getEvents()[0]!.uuids).toEqual(['aaaa']);
  });

  it('logM() clones the sizes it is given (a later mutation does not reach the logged entry)', () => {
    const logger = new PnsLogger();
    const sizes = new PnsSizesSettings();
    sizes.setTrackWidth(100);
    logger.logM(PnsLoggerEventType.EVT_START_ROUTE, { x: 0, y: 0 }, [], sizes);
    sizes.setTrackWidth(999);
    expect(logger.getEvents()[0]!.sizes.trackWidth()).toBe(100);
  });

  it('logM() with no sizes uses a fresh default SIZES_SETTINGS, not null', () => {
    const logger = new PnsLogger();
    logger.logM(PnsLoggerEventType.EVT_TOGGLE_VIA);
    const ent = logger.getEvents()[0]!;
    expect(ent.sizes.trackWidth()).toBe(0);
    expect(ent.sizes.viaType()).toBe(VIATYPE.THROUGH);
  });
});

describe('PnsLogger.formatEvent (LOGGER::FormatEvent)', () => {
  it('formats the five-int header, zero UUIDs, and the seven sizes ints', () => {
    const sizes = new PnsSizesSettings();
    sizes.setTrackWidth(250000);
    sizes.setViaDiameter(600000);
    sizes.setViaDrill(300000);
    sizes.setTrackWidthIsExplicit(true);
    sizes.setLayerBottom(31);
    sizes.setLayerTop(0);
    sizes.setViaType(VIATYPE.THROUGH);
    const ent: PnsLoggerEventEntry = {
      p: { x: 1000, y: -2000 },
      type: PnsLoggerEventType.EVT_MOVE,
      uuids: [],
      sizes,
      layer: 0,
    };
    expect(PnsLogger.formatEvent(ent)).toBe(
      'event 1000 -2000 3 0 0 250000 600000 300000 1 31 0 4\n',
    );
  });

  it('inserts each UUID, space-terminated, before the sizes block', () => {
    const ent: PnsLoggerEventEntry = {
      p: { x: 0, y: 0 },
      type: PnsLoggerEventType.EVT_FIX,
      uuids: ['uuid-a', 'uuid-b'],
      sizes: new PnsSizesSettings(),
      layer: 5,
    };
    expect(PnsLogger.formatEvent(ent)).toBe('event 0 0 2 5 2 uuid-a uuid-b 0 0 0 1 0 0 4\n');
  });

  it('writes 0 for a non-explicit track width and the micro via-type int', () => {
    const sizes = new PnsSizesSettings();
    sizes.setTrackWidthIsExplicit(false);
    sizes.setViaType(VIATYPE.MICROVIA);
    const ent: PnsLoggerEventEntry = {
      p: { x: 0, y: 0 },
      type: PnsLoggerEventType.EVT_UNFIX,
      uuids: [],
      sizes,
      layer: 0,
    };
    expect(PnsLogger.formatEvent(ent)).toBe('event 0 0 6 0 0 0 0 0 0 0 0 1\n');
  });
});

describe('PnsLogger.parseEvent (LOGGER::ParseEvent)', () => {
  it('reads the header and UUIDs back, but not the sizes (upstream drops them too)', () => {
    const line = 'event 1000 -2000 3 7 2 uuid-a uuid-b 250000 600000 300000 1 31 0 4\n';
    const ent = PnsLogger.parseEvent(line);
    expect(ent.p).toEqual({ x: 1000, y: -2000 });
    expect(ent.type).toBe(PnsLoggerEventType.EVT_MOVE);
    expect(ent.layer).toBe(7);
    expect(ent.uuids).toEqual(['uuid-a', 'uuid-b']);
    // Never parsed: comes back as a fresh default, not the 250000 the line carries.
    expect(ent.sizes.trackWidth()).toBe(0);
  });

  it('returns a default entry for a line that is not an event (wxCHECK_MSG failure path)', () => {
    const ent = PnsLogger.parseEvent('removed some-uuid');
    expect(ent.type).toBe(PnsLoggerEventType.EVT_START_ROUTE);
    expect(ent.uuids).toEqual([]);
  });

  it('round-trips a formatted event through the header and UUIDs', () => {
    const sizes = new PnsSizesSettings();
    sizes.setTrackWidth(42);
    const before: PnsLoggerEventEntry = {
      p: { x: 5, y: -5 },
      type: PnsLoggerEventType.EVT_START_DRAG,
      uuids: ['x', 'y', 'z'],
      sizes,
      layer: 2,
    };
    const after = PnsLogger.parseEvent(PnsLogger.formatEvent(before));
    expect(after.p).toEqual(before.p);
    expect(after.type).toBe(before.type);
    expect(after.layer).toBe(before.layer);
    expect(after.uuids).toEqual(before.uuids);
  });
});

describe('PnsLogger.formatLogFileAsString (LOGGER::FormatLogFileAsString)', () => {
  it('assembles mode, then events, then removed, then added, then head, in that order', () => {
    const ent: PnsLoggerEventEntry = {
      p: { x: 1, y: 2 },
      type: PnsLoggerEventType.EVT_ABORT,
      uuids: [],
      sizes: new PnsSizesSettings(),
      layer: 0,
    };
    const out = PnsLogger.formatLogFileAsString(
      1,
      ['ADDED_LINE'],
      ['removed-uuid'],
      ['HEAD_LINE'],
      [ent],
    );
    expect(out).toBe(
      [
        'mode 1',
        'event 1 2 4 0 0 0 0 0 1 0 0 4',
        'removed removed-uuid',
        'added ADDED_LINE',
        'head HEAD_LINE',
        '',
      ].join('\n'),
    );
  });
});

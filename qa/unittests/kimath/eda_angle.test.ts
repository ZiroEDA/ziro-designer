// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * `qa/tests/libs/kimath/geometry/test_eda_angle.cpp` (EdaAngle), transcribed,
 * plus the `IsCardinal` / `IsCardinal90` / `KeepUpright` / `IsParallelTo`
 * bodies that suite leaves to the header.
 */
import { describe, expect, it } from 'vitest';
import {
  ANGLE_0,
  ANGLE_45,
  ANGLE_90,
  ANGLE_135,
  ANGLE_180,
  ANGLE_270,
  ANGLE_360,
  ANGLE_HORIZONTAL,
  ANGLE_VERTICAL,
  EDA_ANGLE,
  FULL_CIRCLE,
} from '@ziroeda/kimath/src/geometry/eda_angle.js';

//                 [0,360)   (-360,0]    [-90,90]   (-180,180]   [-360,360)
// Original     Normalized    NormNeg      Norm90      Norm180      Norm720
const normalize_cases: [number, number, number, number, number, number][] = [
  [90.0, 90.0, -270.0, 90.0, 90.0, 90.0],
  [-90.0, 270.0, -90.0, -90.0, -90.0, -90.0],
  [135.0, 135.0, -225.0, -45.0, 135.0, 135.0],
  [-135.0, 225.0, -135.0, 45.0, -135.0, -135.0],
  [180.0, 180.0, -180.0, 0.0, 180.0, 180.0],
  [-180.0, 180.0, -180.0, 0.0, 180.0, -180.0],
  [360.0, 0.0, 0.0, 0.0, 0.0, 0.0],
  [-360.0, 0.0, 0.0, 0.0, 0.0, -360.0],
  [390.0, 30.0, -330.0, 30.0, 30.0, 30.0],
  [-390.0, 330.0, -30.0, -30.0, -30.0, -30.0],
  [720.0, 0.0, 0.0, 0.0, 0.0, 0.0],
  [-720.0, 0.0, 0.0, 0.0, 0.0, -360.0],
];

describe('EdaAngle', () => {
  it('Normalize', () => {
    for (const [angle, n, nn, n90, n180, n720] of normalize_cases) {
      expect(new EDA_ANGLE(angle).Normalize().AsDegrees(), `${angle} Normalize`).toBe(n);
      expect(
        new EDA_ANGLE(angle).NormalizeNegative().AsDegrees(),
        `${angle} NormalizeNegative`,
      ).toBe(nn);
      expect(new EDA_ANGLE(angle).Normalize90().AsDegrees(), `${angle} Normalize90`).toBe(n90);
      expect(new EDA_ANGLE(angle).Normalize180().AsDegrees(), `${angle} Normalize180`).toBe(n180);
      expect(new EDA_ANGLE(angle).Normalize720().AsDegrees(), `${angle} Normalize720`).toBe(n720);
    }
  });

  it('ConstantAngles', () => {
    expect(ANGLE_0.AsDegrees()).toBe(0.0);
    expect(ANGLE_45.AsDegrees()).toBe(45.0);
    expect(ANGLE_90.AsDegrees()).toBe(90.0);
    expect(ANGLE_135.AsDegrees()).toBe(135.0);
    expect(ANGLE_180.AsDegrees()).toBe(180.0);
    expect(ANGLE_270.AsDegrees()).toBe(270.0);
    expect(ANGLE_360.AsDegrees()).toBe(360.0);
    expect(ANGLE_HORIZONTAL.AsDegrees()).toBe(0.0);
    expect(ANGLE_VERTICAL.AsDegrees()).toBe(90.0);
    expect(FULL_CIRCLE.AsDegrees()).toBe(360.0);
  });
});

describe('EDA_ANGLE predicates (eda_angle.cpp)', () => {
  it('IsCardinal is any multiple of 90; IsCardinal90 is 90/270 only', () => {
    for (const d of [0, 90, 180, 270, 360, -90, -450])
      expect(new EDA_ANGLE(d).IsCardinal(), `${d}`).toBe(true);
    for (const d of [45, 89.9, 91, -1]) expect(new EDA_ANGLE(d).IsCardinal(), `${d}`).toBe(false);

    for (const d of [90, 270, -90, -270, 450])
      expect(new EDA_ANGLE(d).IsCardinal90(), `${d}`).toBe(true);
    for (const d of [0, 180, 360, 45, -180])
      expect(new EDA_ANGLE(d).IsCardinal90(), `${d}`).toBe(false);
  });

  it('KeepUpright folds into 0 or 90', () => {
    expect(new EDA_ANGLE(30).KeepUpright().AsDegrees()).toBe(0);
    expect(new EDA_ANGLE(45).KeepUpright().AsDegrees()).toBe(0);
    expect(new EDA_ANGLE(46).KeepUpright().AsDegrees()).toBe(90);
    expect(new EDA_ANGLE(135).KeepUpright().AsDegrees()).toBe(90);
    expect(new EDA_ANGLE(136).KeepUpright().AsDegrees()).toBe(0);
    expect(new EDA_ANGLE(225).KeepUpright().AsDegrees()).toBe(0);
    expect(new EDA_ANGLE(226).KeepUpright().AsDegrees()).toBe(90);
    expect(new EDA_ANGLE(315).KeepUpright().AsDegrees()).toBe(0);
    expect(new EDA_ANGLE(-30).KeepUpright().AsDegrees()).toBe(0);
  });

  it('IsParallelTo compares modulo 180 with -90 folded onto 90', () => {
    expect(new EDA_ANGLE(90).IsParallelTo(new EDA_ANGLE(-90))).toBe(true);
    expect(new EDA_ANGLE(90).IsParallelTo(new EDA_ANGLE(270))).toBe(true);
    expect(new EDA_ANGLE(0).IsParallelTo(new EDA_ANGLE(180))).toBe(true);
    expect(new EDA_ANGLE(45).IsParallelTo(new EDA_ANGLE(225))).toBe(true);
    expect(new EDA_ANGLE(45).IsParallelTo(new EDA_ANGLE(135))).toBe(false);
  });

  it('Round and abs', () => {
    expect(new EDA_ANGLE(12.3456).Round(2).AsDegrees()).toBe(12.35);
    expect(new EDA_ANGLE(-12.345).Round(2).AsDegrees()).toBe(-12.35);
    expect(new EDA_ANGLE(-30).abs().AsDegrees()).toBe(30);
  });
});

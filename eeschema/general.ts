// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * `eeschema/general.h`: the legacy schematic header's version and string, and the
 * `DefaultTransform` declaration.
 *
 * Only the legacy writer (`SCH_IO_KICAD_LEGACY::Format`, sch_io_kicad_legacy.cpp:1532) reads
 * the two constants; ours reads `.sch` files but does not write them, so nothing reads them yet.
 * `DefaultTransform` is defined in `libs/kimath/src/transform.cpp`, as ours is in kimath's
 * `transform.ts`; this header only declares it for eeschema, which the re-export mirrors.
 */

export { DefaultTransform } from '@ziroeda/kimath/src/transform.js';

/** `EESCHEMA_VERSION`: the legacy schematic format version written. [data] */
export const EESCHEMA_VERSION = 5;

/** `SCHEMATIC_HEAD_STRING`: "EESchema <this> <version>", the legacy file's first line. [data] */
export const SCHEMATIC_HEAD_STRING = 'Schematic File Version';

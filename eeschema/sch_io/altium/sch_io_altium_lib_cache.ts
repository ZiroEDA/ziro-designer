// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * `eeschema/sch_io/altium/sch_io_altium_lib_cache.h`: `SCH_IO_ALTIUM_LIB_CACHE`, "a cache
 * assistant for Altium symbol libraries".
 *
 * Upstream declares the class - a constructor and a `Load()` override - but defines neither,
 * and nothing includes the header: SCH_IO_ALTIUM caches its libraries itself (`m_libCache`,
 * sch_io_altium.ts). So the class is mirrored as declared and stays abstract, with `Load()`
 * left to a subclass, exactly as uninstantiable as upstream's.
 */
import { SCH_IO_LIB_CACHE } from '../sch_io_lib_cache.js';

export abstract class SCH_IO_ALTIUM_LIB_CACHE extends SCH_IO_LIB_CACHE {}

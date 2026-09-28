// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * Wires `model_cache.ts`'s real, IndexedDB-backed tessellation cache into
 * `@ziroeda/3d-viewer`'s `loadmodel.ts` — the one thing that package needs
 * from the app and cannot resolve itself (`ModelCache`'s doc comment there).
 *
 * Imported for its side effect by every designer module that can trigger a
 * 3D model load (`Viewer3DFrame.tsx`, `widgets/footprint_preview_3d.tsx`), so
 * the seam is live before the first one runs regardless of which caller gets
 * there first. A module's top level runs once no matter how many importers
 * it has, so two importers calling this cost nothing extra.
 */
import { setModelCache } from '@ziroeda/3d-viewer/loadmodel.js';
import { cacheGet, cachePut, modelKey } from './model_cache.js';

setModelCache({ modelKey, cacheGet, cachePut });

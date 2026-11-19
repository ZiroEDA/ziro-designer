// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
/** /api/github/refresh on Cloudflare Pages: api/github/refresh.js, run through api/github/_fetch_adapter.js. */
import { toPagesFunction } from '../../../api/github/_fetch_adapter.js';
import { createRefreshHandler } from '../../../api/github/refresh.js';

export const onRequest = toPagesFunction((env) => createRefreshHandler({ env }));

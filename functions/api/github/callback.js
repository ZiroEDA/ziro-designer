// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
/** /api/github/callback on Cloudflare Pages: api/github/callback.js, run through api/github/_fetch_adapter.js. */
import { toPagesFunction } from '../../../api/github/_fetch_adapter.js';
import { createCallbackHandler } from '../../../api/github/callback.js';

export const onRequest = toPagesFunction((env) => createCallbackHandler({ env }));

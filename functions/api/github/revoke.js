// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
/** /api/github/revoke on Cloudflare Pages: api/github/revoke.js, run through api/github/_fetch_adapter.js. */
import { toPagesFunction } from '../../../api/github/_fetch_adapter.js';
import { createRevokeHandler } from '../../../api/github/revoke.js';

export const onRequest = toPagesFunction((env) => createRevokeHandler({ env }));

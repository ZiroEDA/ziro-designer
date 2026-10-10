// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
/**
 * `loginSecret` off the main thread, for priming it while the form is being
 * filled in (login_secret_cache.ts): half a second of Argon2id on the main
 * thread would freeze typing at every pause.
 */
import { loginSecret } from '../cloud/crypto.js';

interface Ask {
  id: number;
  email: string;
  password: string;
}

self.onmessage = (e: MessageEvent<Ask>) => {
  const { id, email, password } = e.data;
  loginSecret(email, password).then(
    (secret) => self.postMessage({ id, secret }),
    (err: unknown) => self.postMessage({ id, error: String(err) }),
  );
};

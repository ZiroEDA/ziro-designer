// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
/**
 * One Argon2id run off the main thread (crypto.ts `argon2idReal`). The account key's is seconds
 * of WebAssembly over 256 MiB; on the main thread the page froze for all of it, and a sign-in
 * looked hung. A run's memory goes with the worker, which the caller ends after one answer.
 */
import { argon2id } from 'hash-wasm';

interface Ask {
  password: string;
  salt: Uint8Array;
  opsLimit: number;
  memLimitKiB: number;
  parallelism: number;
  hashLength: number;
}

self.onmessage = (e: MessageEvent<Ask>) => {
  const { password, salt, opsLimit, memLimitKiB, parallelism, hashLength } = e.data;
  argon2id({
    password,
    salt,
    iterations: opsLimit,
    memorySize: memLimitKiB,
    parallelism,
    hashLength,
    outputType: 'binary',
  }).then(
    (key) => self.postMessage({ key }),
    // A memory limit the device cannot give comes back as an error: the caller's ladder retries.
    (err: unknown) => self.postMessage({ error: String(err) }),
  );
};

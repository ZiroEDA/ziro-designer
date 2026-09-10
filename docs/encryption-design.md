<!-- SPDX-License-Identifier: GPL-3.0-or-later -->
<!-- Copyright (C) 2026 ZiroEDA and contributors. -->

# End-to-end encryption: design

**Status:** design + crypto core landed; wiring into sync is not yet done.
**Audience:** us. The user-facing version is [`security.md`](./security.md).

## What we are promising

A project, and everything in it, is readable **only** by its owner and the
collaborators the owner has explicitly shared it with. It is *not* readable by:

- us, the operators of the service;
- anyone who obtains a copy of the database or the object store;
- any other ZiroEDA user.

To everyone in that second list, a stored board is indistinguishable from random
bytes. This is a mathematical property, not an access-control rule the server
chooses to enforce — the server never holds a key that opens the data.

The honest consequence, stated up front: **if the server cannot read a project,
the server cannot help a user who has lost their keys.** That is why the
recovery key (below) exists and why losing *it as well* is unrecoverable. That
trade is the point, not a defect.

## Threat model, briefly

- **In scope.** A hostile or compromised server; a stolen database dump or
  storage bucket; a curious operator; one user trying to read another's project.
- **Out of scope.** A compromised client device (if malware is on the machine
  where plaintext is decrypted, no scheme helps); the user losing every device
  *and* their recovery key; traffic-analysis metadata (see "What still leaks").

## The two things that make this different from a textbook port

We modelled the key hierarchy on a proven, externally audited, libsodium-based
design used by established end-to-end-encrypted products. Two facts about *our*
codebase forced deliberate departures from it. These are the parts to get right.

### 1. Content addressing keys blobs by the hash of their bytes

`blobStore.ts` stores every blob at a path derived from `sha256(bytes)`, and
three load-bearing properties follow from that: writes cannot destroy (two
contents cannot collide on one key), reads are verifiable (`getBlob` re-hashes
and rejects a mismatch), and a re-push of unchanged content writes nothing.

Naively encrypting the bytes breaks all three, because a fresh random nonce
makes the ciphertext — and therefore its hash — different every single time.

**Resolution: content-address by the hash of the _plaintext_.**

- The manifest entry's `hash` stays `sha256(plaintext)` — stable identity, dedup
  and "re-push writes nothing" both survive, and it is still the value we verify
  against *after* decrypting.
- The object stored at that path is `nonce ‖ ciphertext` under the project key.
- `getBlob`'s contract becomes: fetch, decrypt, then check the plaintext hashes
  to the key that named it. A tampered or truncated object fails the AEAD tag
  first, and a substituted one fails the hash — strictly stronger than today.

The plaintext hash is an existence oracle over the user's *own* plaintext within
their *own* namespace (`<userId>/blobs/…`), which is already how the store
works and carries no cross-user leak — blobs are namespaced per user precisely
so "does this hash exist" never answers a question about someone else's files.

### 2. The auth server takes a password, and must not get ours

The reference design derives a key-encryption-key (KEK) from the user's password
with Argon2id and wraps the master key with it. Signing in there uses SRP, so
the password itself never leaves the device. We do the same derivation, but our
auth server (Supabase Auth) has no SRP: it takes a password string and bcrypts
it. Handing it the real password would put the one secret that unwraps every
project on a server we promised cannot read anything.

**Resolution: the server is given a login secret derived one way from the KEK.**

- The client derives `passwordKey = Argon2id(password, salt, ops, mem)`. This is
  the KEK. It never leaves the device.
- The client derives `loginSecret = HKDF-SHA256(passwordKey, "ziro-login-v1")`
  and gives THAT to Supabase as the account's password. The reference design
  does the same thing for its SRP input (a `loginctx` subkey off the KEK). From
  the login secret the server can recover neither the password nor the KEK.
- One Argon2id run per sign-in yields both: the login secret to sign in with,
  and the KEK to unwrap the master key once the wrapped account comes back.

**The stretch is Argon2id at libsodium's SENSITIVE limits, chosen by trying.**
Argon2id is memory-hard; PBKDF2 (the first cut, because Web Crypto has it
natively) is not, and gives far more ground to GPUs. The parameters are the
reference design's ladder: start at 4 passes over 1 GiB; if the device cannot
give that memory, halve the memory and double the passes and try again, so the
work stays constant and only the footprint drops; refuse below 64 MiB rather
than issue a weak key. The device that creates the account decides once, and
the salt, ops and memory are stored with the account (`KdfParams`) so every
later device derives the same key. Storing them is also what makes the KDF
replaceable: a stronger stretch is a new `name` on new accounts, never a flag
day.

The implementation is `hash-wasm`'s Argon2id, the one dependency this design
takes. It is pinned against libsodium's own output (two known answers computed
with PyNaCl live in `crypto.test.ts`), so it is the reference design's function
and not merely one with the same name.

**The recovery key is the only reset.** A random 256-bit recovery key, shown
once at sign-up, also wraps the master key. A forgotten password is answered by
the recovery key unwrapping the master key and a new password re-wrapping the
SAME master key, so nothing encrypted before the reset is lost. There is no
reset-by-email that reaches the data, because the server holds nothing that
could perform one.

## Key hierarchy

```
password
    └─ Argon2id ─▶ passwordKey (the KEK) ── wraps ─▶ masterKey (256-bit random)
                        └─ HKDF ─▶ loginSecret ── given to the auth server
recoveryKey (256-bit random, shown to user once)
    └─ also wraps ─▶ masterKey

masterKey
    ├─ wraps ─▶ privateKey        (of the account's ECDH keypair)
    ├─ wraps ─▶ recoveryKey       (so the pair is mutually recoverable)
    └─ wraps ─▶ projectKey        (one per project the user owns)

publicKey (of the account keypair) — stored in the clear, used to receive shares

projectKey (256-bit random, one per project)
    ├─ wrapped for self:   secretbox(projectKey, masterKey)
    ├─ wrapped for member: seal(projectKey, memberPublicKey)   ← this is sharing
    └─ encrypts ─▶ every board blob of that project
```

## Operations

**Signup.** Generate `masterKey`, an ECDH `keypair`, and a `recoveryKey`.
Wrap `masterKey` under `recoveryKey`; wrap `privateKey` and `recoveryKey` under
`masterKey`. Upload `{ publicKey, encMasterKey_byRecovery, encPrivateKey,
encRecoveryKey_byMaster }`. Show the recovery key to the user once.

**New device.** Authenticate with Google as today. Then either (a) user pastes
the recovery key → unwrap `masterKey` → unwrap `privateKey`; or (b) an existing
device seals `masterKey` to this device's freshly generated public key and the
server relays it. Cache unwrapped keys in memory (and, optionally, in the
browser only as a convenience; browser storage is treated as a disposable cache,
never the source of truth — see §1 of the recovery discussion).

**Create a project.** Generate a random `projectKey`; wrap it under `masterKey`;
store the wrapped key on the project row. Every blob is encrypted with it.

**Share a project.** Fetch the recipient's `publicKey`. `seal(projectKey,
recipientPublicKey)` and store that alongside the membership row. The recipient
unwraps with their `privateKey`. The board blobs are never re-encrypted — only
the small project key is wrapped per member. This layers directly onto the
existing membership machinery in `invites.ts` / `backend.ts` (`redeemInvite`,
`listMemberships`): membership already decides who *may* reach a project; the
sealed project key decides who *can decrypt* it.

**Recovery.** User pastes the recovery key → unwrap `masterKey` → everything
else follows. If a password wrap exists, they may then set a new password.

## The link-sharing tension (decision needed before wiring)

`invites.ts` supports `?p=<uid>` link sharing: anyone with the link gets
viewer/editor. That is fundamentally at odds with per-recipient key wrapping —
"anyone with the link" has no public key to seal the project key to. Options:

1. **Explicit invites only for encrypted projects.** A share names an account;
   we seal the project key to that account's public key. Link-sharing is
   disabled for encrypted projects. (Cleanest; matches the guarantee.)
2. **Key-in-fragment links** (Excalidraw-style `#<key>`). The project key rides
   in the URL fragment, never sent to the server. Preserves "anyone with the
   link" but the link *is* the secret — screenshots and history leak it.

Recommendation: ship (1) first; consider (2) later as an explicit "public link"
mode with a loud warning. Do not silently mix them.

## Primitives (Web Crypto, plus one dependency for Argon2id)

| Purpose | Reference (libsodium) | Ours (Web Crypto) |
|---|---|---|
| Symmetric AEAD (wrap keys, encrypt blobs) | `crypto_secretbox` (XSalsa20-Poly1305) | **AES-256-GCM**, random 96-bit IV per message, stored as `iv ‖ ct` |
| Asymmetric seal (share a project key) | `crypto_box_seal` (X25519) | **ECDH P-256** ephemeral-static → HKDF-SHA256 → AES-256-GCM; stored as `ephPub ‖ iv ‖ ct` |
| Key derivation / domain separation | `crypto_kdf` | **HKDF-SHA256** |
| Password stretch | Argon2id (`crypto_pwhash`, SENSITIVE limits) | **Argon2id** via `hash-wasm`, same limits and ladder; pinned to libsodium's output. (PBKDF2-SHA256 descriptors from the first accounts still open.) |
| Login secret for the auth server | `crypto_kdf` subkey of the KEK (`loginctx`) | **HKDF-SHA256** of the KEK, label `ziro-login-v1` |

GCM nonce discipline: a fresh `crypto.getRandomValues` 96-bit IV per encryption,
stored with the ciphertext. Random 96-bit IVs are safe well beyond the message
volume any single project key will ever see; keys are per-project and rotated on
re-share, so no key approaches the birthday bound.

## What still leaks (be honest in the user doc)

The server, seeing only ciphertext, still learns *metadata*: who collaborates
with whom, when a project changed and roughly by how much, and the plaintext
*hashes* within a user's own namespace (used for dedup). It never learns the
contents of a board, a schematic, or a file name we choose to encrypt. The
user-facing doc says this plainly rather than claiming "we know nothing."

## Implementation plan (waves)

1. **Crypto core** — `designer/src/cloud/crypto.ts`, self-contained, no wiring.
   Key generation, wrap/unwrap, seal/open, project keys, blob encrypt/decrypt.
   Tests in `qa/unittests/designer/crypto.test.ts`. *(This wave.)*
2. **Account key lifecycle** — generate at first sign-in, store wrapped forms,
   the recovery-key UI (show once / paste to recover), device-approval.
3. **Blob path** — encrypt in `putBlob`, decrypt in `getBlob`, content-address
   by plaintext hash. This is the change that touches existing behaviour, so it
   lands behind a per-project `encrypted` flag with old projects untouched.
4. **Sharing** — seal the project key on invite; unwrap on redeem. Decide the
   link-sharing question above first.
5. **Migration** — existing plaintext projects stay readable; new ones are
   encrypted; offer an opt-in "encrypt this project" that re-uploads blobs.

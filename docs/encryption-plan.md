# End-to-end encryption: the plan

Internal. The design is in `encryption-design.md`; this is the order of work,
what each phase changes, and what is decided. The reference design is the one
that document names, and every mapping below is to its published architecture:
master key, collection key, file key, sharing by sealing the collection key to
the receiver's public key, public links carrying the key in the URL fragment.

## Why

Users ask for the cloud to be removed because they do not want to hand over
their designs. Removing it removes collaboration, access from anywhere and
sharing, which are the reasons the product is in a browser. End-to-end
encryption keeps all of that and makes the objection go away: the server holds
ciphertext, and only the owner and the people they share with hold keys. This
is the whole product promise, so it covers everything a user makes, not only
boards.

## What exists today (audited 2026-09-10)

| Store | What it holds | In the clear today |
|---|---|---|
| `projects` (Postgres) | uid, owner, name, `files` manifest (names, hashes, sizes), version, link_access | name, every file name, every plaintext hash |
| `projects` bucket (Storage) | one object per file at `<owner>/blobs/<hash>` | every file, addressed by its plaintext hash |
| `project_members`, `project_invites` | who may open what, invite tokens | who works with whom (this stays: it is access control) |
| `project_blobs` | the index the RLS uses to grant a member a blob | hashes |
| `user_settings` | preferences | preferences (not design data) |
| `account_keys` | the wrapped account keys | nothing usable (done) |
| IndexedDB `ziroeda` (local) | every project, compressed, with names | everything |
| IndexedDB local history | snapshots of every edit | everything |
| IndexedDB user templates, library bundles, 3D model cache | the user's own templates; the public library bundle; tessellated models | user templates and user models |
| The four user-data folders `/Symbols`, `/Footprints`, `/3D Models`, `/Templates` | custom libraries, uploaded models, templates. They are records of the same store as projects and sync the same way. | everything |

So: yes, custom symbol and footprint libraries and uploaded 3D models exist
already, as folders in the account tree, and they are in scope. Demos, the
public KiCad libraries and the hosted 3D model set are public content and stay
in the clear.

## The mapping

| Reference design | ZiroEDA |
|---|---|
| master key, KEK, recovery key, key pair | done: `account_keys`, Argon2id, 24-word recovery key |
| collection | a **project**; and each of the four user-data folders is a collection of its own |
| collection key | `projectKey`, random 256-bit, one per project |
| file | a project file |
| file key | `fileKey`, random 256-bit, one per file (blob) |
| collection metadata encrypted with the collection key | the project's **name** and its **manifest** (paths, sizes, plaintext hashes) encrypted under `projectKey` |
| collection key encrypted with the master key | `project_keys` row: `projectKey` wrapped under the owner's `masterKey` |
| collection key sealed to a receiver's public key | `project_keys` row for a member: `projectKey` sealed to their public key (`seal`, ECDH P-256) |
| public link with the key in the URL fragment | share link `/p/<uid>/pcb#<projectKey, base58>`; the fragment never reaches a server |
| verification ID | a fingerprint of each member's public key in the Share popover (last phase) |

Two things the reference design does that we did not plan to, adopted now:

1. **Per-file keys, not one key per project for everything.** The reason is
   the same as theirs: a file can then move or be shared without re-encrypting
   its bytes. For us that means (a) the same library file in two projects is
   one ciphertext blob with its `fileKey` wrapped under each project's key, so
   deduplication survives encryption, and (b) removing a collaborator rotates
   the `projectKey` and re-wraps the file keys, which is bytes, not files. The
   promise in `security.md`, that someone removed cannot open new changes, is
   kept by that rotation.

2. **Random blob ids, not plaintext hashes.** `encryption-design.md` §1 chose
   to keep addressing blobs by the hash of the plaintext, in the owner's own
   namespace, to keep deduplication and verification. It is an existence
   oracle over the owner's plaintext, and it is not needed: deduplication is
   done on the client against the plaintext hashes kept INSIDE the encrypted
   manifest, which is where the reference design keeps its file hashes. The
   server sees `<owner>/blobs/<uuid>` and learns nothing from the name.
   Verification is the AEAD tag plus the hash in the manifest, after decrypt.
   That section of the design document is superseded by this.

## What the server still sees, stated

Account emails; who owns and who is a member of which project; when things
changed; how many blobs a project has and how large each is; version numbers.
Not names, not paths, not contents, not hashes. This is the reference design's
position as well, and it is written in `security.md` for users.

## Phases

Each phase is shippable on its own, is behind nothing once shipped, and lands
with tests and mutants like everything else. Existing data is migrated by the
client on its next sign-in or push; the server never has a plaintext copy to
convert, because it cannot.

### P0. Project keys (server + client, no data changes yet)

- Table `project_keys (project_uid, user_id, enc_project_key, how)` where
  `how` is `master` (owner, wrapped under the master key) or `sealed` (member,
  sealed to their public key). RLS: your own rows. The owner writes members'
  rows at share time; a member may read only their own.
- Client: `projectKey` created with every new project and wrapped for the
  owner. For projects that exist: made on first unlock, for every project the
  account owns that has no key yet.
- `useAuth().keys.masterKey` is the only thing this needs, and it exists.

### P1. Encrypted blobs and manifest (the behaviour change)

- `blobStore.putBlob`: `fileKey` per file, `iv ‖ AES-256-GCM(fileKey, bytes)`,
  stored at a random id. `getBlob`: decrypt, verify the tag, verify the hash
  the manifest says, as today's verify does after decrypt.
- `projects.files` and `projects.name` become ciphertext under `projectKey`
  (`enc_manifest`, `enc_name`); the plaintext columns are dropped once every
  row has migrated. The manifest holds, per file: path, size, plaintext hash,
  blob id, `fileKey` wrapped under `projectKey`.
- `project_blobs` (the RLS index that lets a member fetch a blob) keys on the
  blob id instead of the hash; the grant is the same.
- Version compare-and-swap is unchanged: it is about the row, not the bytes.
- Migration: a flag per project, `encrypted`. A project without it is pushed
  encrypted on its next push and its plaintext blobs are deleted after; a
  client that finds one on pull reads it the old way once. The flag goes when
  no rows lack it.

### P2. Local at rest

- The IndexedDB project store, the local history snapshots, and the user
  templates store hold ciphertext under `projectKey`. The recent-projects list
  needs names: decrypted on unlock, held in memory, gone on lock.
- The 3D model tessellation cache is derived from user models and is treated
  as user data: encrypted under the owning folder's key.
- Locking (sign out, or the tab closing with the session key gone) leaves
  nothing readable in the browser. This is the answer to "a developer with
  devtools", which the wall alone is not.

### P3. Sharing, on keys

- Inviting a member: their public key from `public_keys_of`, the project key
  sealed to it, a `project_keys` row written by the owner. Redeeming an invite
  by link: the link carries the key in its fragment, exactly like a public
  link, and the redeemer wraps it under their own master key and writes their
  own row. Either way the owner's device need not be online.
- Link access (`link_access` on the project): the link is
  `/p/<uid>/<editor>#<key>`. The server grants the ciphertext to anyone with
  the link; only the fragment opens it. Turning link access off does not
  revoke the key the links carry: that is a rotation, below.
- Removing a member, or turning off a link that was shared: rotate
  `projectKey`, re-wrap every `fileKey`, re-seal for the members who remain,
  bump the version. Blobs are untouched.
- Editors who commit: a commit is the manifest re-encrypted under the current
  project key plus new blobs under new file keys, so an editor needs the same
  thing a viewer needs and nothing more.

### P4. Libraries and assets

- The four user-data folders are four collections with keys of their own,
  wrapped for the owner. Everything in them goes through P1 and P2 unchanged,
  because they are projects to the store already.
- A custom library referenced from a project is one blob with its file key
  wrapped under both the folder's key and the project's key, which is the
  per-file-key design paying for itself.
- Sharing a library folder is the same mechanism as sharing a project; not
  offered in the UI until asked for.

### P5. Trust and the rest

- Verification ID in the Share popover: a fingerprint of the member's public
  key, compared out of band.
- Optional link password, as the reference design offers, checked by the
  server before it hands over ciphertext; the key still travels in the
  fragment.
- Real-time presence, when it comes, carries only ciphertext under the
  project key.

## Order and size

P0 and P1 together are the behaviour change and go first; P2 closes the local
gap the wall exposed; P3 makes sharing work again on top of keys (until then,
sharing an encrypted project is owner-only, which is why P1 and P3 should land
in the same release); P4 is mostly already covered by the earlier phases and
is small; P5 is polish. Two releases: {P0, P1, P2, P3} and {P4, P5}.

## Things that are NOT in scope, said now

- Server-side search or indexing of design content: impossible by design.
- Recovering a project whose owner lost both password and recovery key:
  impossible by design, and said so on the recover screen.
- Encrypting `user_settings`: preferences are not design data; revisit if a
  setting ever carries a path or a name.

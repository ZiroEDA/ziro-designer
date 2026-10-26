// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * The shield at the right end of the project manager's status bar, saying on hover that the
 * servers never see a project.
 *
 * No KiCad counterpart - KiCad has no server. It is Excalidraw's `EncryptedIcon`
 * (excalidraw-app/components/EncryptedIcon.tsx, MIT), which sits at the right end of that app's
 * footer for the same reason: an app that works without an account should say what happens to
 * the work once it leaves the machine. It is true either way here: signed out nothing leaves, and
 * signed in a project syncs sealed under a key the server never holds (cloud/session_keys.ts).
 *
 * The tooltip is the app's own (`data-tip`, common/widgets/tooltip.tsx), not a second kind.
 */

import type { JSX } from 'react';

export const ENCRYPTED_TIP =
  "Your projects are end-to-end encrypted so ZiroEDA's servers will never see them.";

export function EncryptedIcon(): JSX.Element {
  return (
    <span
      className="ze-encrypted-icon"
      data-tip={ENCRYPTED_TIP}
      aria-label={ENCRYPTED_TIP}
      role="img"
    >
      <svg viewBox="0 0 24 24" aria-hidden="true">
        {/* [data] Excalidraw's `shield` (packages/excalidraw/components/icons.tsx, MIT), itself a
            modified Feather icon. */}
        <path
          fill="currentColor"
          d="M11.553 22.894a.998.998 0 00.894 0s3.037-1.516 5.465-4.097C19.616 16.987 21 14.663 21 12V5a1 1 0 00-.649-.936l-8-3a.998.998 0 00-.702 0l-8 3A1 1 0 003 5v7c0 2.663 1.384 4.987 3.088 6.797 2.428 2.581 5.465 4.097 5.465 4.097zm-1.303-8.481l6.644-6.644a.856.856 0 111.212 1.212l-7.25 7.25a.856.856 0 01-1.212 0l-3.75-3.75a.856.856 0 111.212-1.212l3.144 3.144z"
        />
      </svg>
    </span>
  );
}

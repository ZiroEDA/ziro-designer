// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/** About dialog (upstream counterpart: common/dialog_about/). Shows the
 * product identity, the build stamp baked in by Vite, and the license.
 *
 * It also carries the attribution for the KiCad work this application reuses.
 * That is not decoration: the icons are GPL and the bundled libraries are
 * CC-BY-SA, and both licences require credit wherever the work is conveyed.
 * NOTICE.md holds the full detail; this is the copy a user actually sees, so it
 * names the two distinct sources and their two distinct licences. */

import type { JSX } from 'react';

declare const __BUILD_STAMP__: string;

const link = { color: '#7fb4e6' };

export function AboutDialog({ onClose }: { onClose: () => void }): JSX.Element {
  const build = typeof __BUILD_STAMP__ === 'string' ? __BUILD_STAMP__ : 'dev';
  return (
    <div className="ze-modal-backdrop" onMouseDown={onClose}>
      <div className="ze-modal ze-label-dialog" onMouseDown={(e) => e.stopPropagation()}>
        <div className="ze-modal-header">
          About Ziro Designer
          <span className="x" title="Close" onClick={onClose}>
            ✕
          </span>
        </div>
        <div className="ze-label-dialog-body" style={{ lineHeight: 1.6 }}>
          <div style={{ fontSize: 16, fontWeight: 700 }}>Ziro Designer</div>
          <div style={{ opacity: 0.8 }}>
            The browser-native electronics design suite from ZiroEDA.
          </div>
          <div style={{ opacity: 0.6, fontSize: 12, marginTop: 8 }}>Build {build}</div>
          <div style={{ opacity: 0.6, fontSize: 12 }}>
            Free software, GPL-3.0-or-later. Not affiliated with or endorsed by the KiCad project;
            "KiCad" is a trademark of its respective owners.
          </div>

          <div style={{ marginTop: 12, fontSize: 12, opacity: 0.75 }}>
            <div style={{ fontWeight: 600, marginBottom: 2 }}>Built on KiCad's work</div>
            <div>
              Much of this application is a TypeScript port of{' '}
              <a href="https://gitlab.com/kicad/code/kicad" style={link}>
                KiCad
              </a>
              , and its icons are KiCad's. Copyright The KiCad Developers, GPL-3.0-or-later.
            </div>
            <div style={{ marginTop: 4 }}>
              The symbol, footprint and 3D model libraries are KiCad's official{' '}
              <a href="https://gitlab.com/kicad/libraries" style={link}>
                libraries
              </a>
              , by the KiCad Libraries Team, under{' '}
              <a href="https://www.kicad.org/libraries/license/" style={link}>
                CC-BY-SA 4.0 with the KiCad library exception
              </a>
              . That exception means using them in a design does not place your design under
              share-alike terms.
            </div>
          </div>
        </div>
        <div className="ze-modal-footer">
          <button type="button" className="ze-btn primary" onClick={onClose}>
            OK
          </button>
        </div>
      </div>
    </div>
  );
}

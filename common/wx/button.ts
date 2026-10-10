// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from wxWidgets, copyright the wxWidgets team (wxWindows Library Licence).
/**
 * `wxButton` / `wxBitmapButton`, as far as a dialog's logic reads it: enabled or not, and the
 * bitmap it shows. The rendering is the form's.
 */
export class wxButton {
  private m_enabled = true;
  private m_bitmap = '';

  Enable(aEnable = true): boolean {
    const changed = this.m_enabled !== aEnable;
    this.m_enabled = aEnable;
    return changed;
  }

  IsEnabled(): boolean {
    return this.m_enabled;
  }

  /** `SetBitmap( KiBitmapBundle( BITMAPS::name ) )`: the bitmap's name. */
  SetBitmap(aBitmap: string): void {
    this.m_bitmap = aBitmap;
  }

  GetBitmap(): string {
    return this.m_bitmap;
  }
}

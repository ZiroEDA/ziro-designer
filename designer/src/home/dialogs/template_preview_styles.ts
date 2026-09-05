// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * GetCommonStyles() from kicad/dialogs/template_default_html.h, which the
 * template selector injects into every external page it previews.
 *
 * A template's meta/info.html carries no CSS of its own - they are bare HTML
 * from 2015 onwards - so without this the WebView would render them the way any
 * browser renders unstyled markup: white, serif, and as wide as the widest
 * element. KiCad does not accept that. OnWebViewLoaded runs a script that
 * appends this stylesheet to the loaded document:
 *
 *     if( m_loadingExternalHtml )
 *     {
 *         wxString script = wxString::Format( wxS( R"(
 *     ( function()
 *     {
 *         var style = document.createElement( 'style' );
 *         style.textContent = `%s`;
 *         document.head.appendChild( style );
 *     } )();
 *                                                      )" ), GetCommonStyles() );
 *
 * so the page picks up the theme's background and text colours, the system
 * font, themed link colours, and - the one that matters most in a narrow pane -
 * `img { max-width: 100% }`, which is what stops a board photograph forcing the
 * preview to scroll sideways.
 *
 * One deliberate difference. Upstream opens with `color-scheme: light dark` and
 * lets light-dark() follow the desktop. ZiroEDA has no light mode: the
 * shell is dark whatever the desktop says, so following the desktop here would
 * put a white page inside a dark dialog for anyone running a light theme. The
 * declaration is pinned to `dark` and the light halves of each light-dark()
 * pair are left in place, so the mapping back to upstream stays readable.
 */
export const TEMPLATE_PREVIEW_STYLES = `
:root {
  color-scheme: dark;

  --bg-primary: light-dark(#FFFFFF, #1E1E1E);
  --bg-secondary: light-dark(#F3F3F3, #2D2D2D);
  --bg-elevated: light-dark(#FFFFFF, #333333);
  --text-primary: light-dark(#1F2328, #DED3DD);
  --text-secondary: light-dark(#545454, #848484);
  --accent: light-dark(#1A81C4, #42B8EB);
  --accent-subtle: light-dark(rgba(26, 129, 196, 0.08), rgba(66, 184, 235, 0.1));
  --border: light-dark(#E0E0E0, #404040);
  --shadow: light-dark(0 1px 3px rgba(0,0,0,0.06), 0 1px 3px rgba(0,0,0,0.2));
}

body {
  background-color: var(--bg-primary);
  color: var(--text-primary);
  font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
}

a, a:link {
  color: light-dark(#0D4A8B, #A7D7FC);
}

a:hover{
  color: light-dark(#0A2540, #EBF5FE);
}

a:visited {
  color: light-dark(#7C3EAE, #E9DDFC);
}

img {
  max-width: 100%;
  height: auto;
}
`;

/**
 * Append the stylesheet to a previewed document, the way OnWebViewLoaded does.
 *
 * Returns false when the frame's document cannot be reached, which is what a
 * cross-origin or fully sandboxed frame gives us; the caller has nothing to do
 * about it but the page still renders, unstyled.
 */
export function styleTemplatePreview(frame: HTMLIFrameElement): boolean {
  const doc = frame.contentDocument;
  if (!doc) return false;

  // OnWebViewLoaded fires again on in-page navigation, and re-appending would
  // stack duplicate sheets.
  if (doc.getElementById('ze-template-preview-styles')) return true;

  const style = doc.createElement('style');
  style.id = 'ze-template-preview-styles';
  style.textContent = TEMPLATE_PREVIEW_STYLES;
  (doc.head ?? doc.documentElement).appendChild(style);
  return true;
}

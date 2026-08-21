// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
//
// What wxAUI draws between a docked pane and the centre one.
//
// KiCad never states this: every frame adds its palette with
// `m_auimgr.AddPane( w, EDA_PANE().Palette()... )` and wxAUI supplies the sash,
// so the width and the colour are wxAuiDefaultDockArt's, resolved against this
// machine's GTK theme. Asking the dock art directly is the same call the
// running GerbView makes.
//
// Build:
//   g++ -Wno-deprecated-declarations -o aui_sash_probe aui_sash_probe.cpp \
//       $(wx-config --cxxflags --libs core,base,aui)
#include <wx/wx.h>
#include <wx/aui/aui.h>
#include <wx/settings.h>

static void dump( const char* name, const wxColour& c )
{
    printf( "%-28s rgb(%d, %d, %d)   #%02x%02x%02x\n", name, c.Red(), c.Green(), c.Blue(),
            c.Red(), c.Green(), c.Blue() );
}

class App : public wxApp
{
public:
    bool OnInit() override
    {
        wxFrame* f = new wxFrame( nullptr, wxID_ANY, "probe" );

        // The font GTK actually gave us, so a run under `env -i` announces the
        // fallback instead of silently measuring Cantarell.
        printf( "gtk-font-name (as wx sees it): %s\n",
                (const char*) wxSystemSettings::GetFont( wxSYS_DEFAULT_GUI_FONT )
                        .GetNativeFontInfoUserDesc().utf8_str() );

        wxAuiManager mgr( f );
        wxAuiDockArt* art = mgr.GetArtProvider();

        printf( "\n-- metrics (px) --\n" );
        printf( "%-28s %d\n", "SASH_SIZE", art->GetMetric( wxAUI_DOCKART_SASH_SIZE ) );
        printf( "%-28s %d\n", "GRIPPER_SIZE", art->GetMetric( wxAUI_DOCKART_GRIPPER_SIZE ) );
        printf( "%-28s %d\n", "PANE_BORDER_SIZE",
                art->GetMetric( wxAUI_DOCKART_PANE_BORDER_SIZE ) );
        printf( "%-28s %d\n", "CAPTION_SIZE", art->GetMetric( wxAUI_DOCKART_CAPTION_SIZE ) );

        printf( "\n-- colours --\n" );
        dump( "SASH_COLOUR", art->GetColour( wxAUI_DOCKART_SASH_COLOUR ) );
        dump( "BACKGROUND_COLOUR", art->GetColour( wxAUI_DOCKART_BACKGROUND_COLOUR ) );
        dump( "BORDER_COLOUR", art->GetColour( wxAUI_DOCKART_BORDER_COLOUR ) );
        dump( "INACTIVE_CAPTION_COLOUR",
              art->GetColour( wxAUI_DOCKART_INACTIVE_CAPTION_COLOUR ) );
        dump( "INACTIVE_CAPTION_TEXT",
              art->GetColour( wxAUI_DOCKART_INACTIVE_CAPTION_TEXT_COLOUR ) );
        dump( "ACTIVE_CAPTION_COLOUR", art->GetColour( wxAUI_DOCKART_ACTIVE_CAPTION_COLOUR ) );

        printf( "\n-- the system colours wxAuiDefaultDockArt derives them from --\n" );
        dump( "wxSYS_COLOUR_3DFACE", wxSystemSettings::GetColour( wxSYS_COLOUR_3DFACE ) );
        dump( "wxSYS_COLOUR_BTNFACE", wxSystemSettings::GetColour( wxSYS_COLOUR_BTNFACE ) );
        dump( "wxSYS_COLOUR_ACTIVECAPTION",
              wxSystemSettings::GetColour( wxSYS_COLOUR_ACTIVECAPTION ) );

        // EDA_MSG_PANEL: SetBackgroundColour( wxSYS_COLOUR_BTNFACE )
        // (`common/widgets/msgpanel.cpp:51`) and
        // DoGetBestSize() = wxSize( wxDefaultCoord, 2 * m_fontSize.y )
        // where m_fontSize = GetTextExtent( "W" ) in the panel's own font
        // (`:72,78`).
        {
            wxPanel* panel = new wxPanel( f );
            wxFont   font = panel->GetFont();
            int      tw = 0, th = 0;
            panel->GetTextExtent( wxT( "W" ), &tw, &th, 0, 0, &font );
            printf( "\n-- EDA_MSG_PANEL --\n" );
            printf( "%-28s %s\n", "panel font",
                    (const char*) font.GetNativeFontInfoUserDesc().utf8_str() );
            printf( "%-28s %d x %d\n", "GetTextExtent(\"W\")", tw, th );
            printf( "%-28s %d\n", "best height (2 * th)", 2 * th );
            dump( "background (BTNFACE)",
                  wxSystemSettings::GetColour( wxSYS_COLOUR_BTNFACE ) );
            dump( "text (WINDOWTEXT)",
                  wxSystemSettings::GetColour( wxSYS_COLOUR_WINDOWTEXT ) );
            dump( "dim text (GRAYTEXT)",
                  wxSystemSettings::GetColour( wxSYS_COLOUR_GRAYTEXT ) );
        }

        mgr.UnInit();
        f->Destroy();
        return false;
    }
};
wxIMPLEMENT_APP_NO_MAIN( App );

int main( int argc, char** argv )
{
    wxEntryStart( argc, argv );
    wxTheApp->CallOnInit();
    wxEntryCleanup();
    return 0;
}

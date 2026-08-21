// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
//
// Every wxSYS_COLOUR_* and wxSYS_METRIC_* wx reports on this machine, plus the
// system fonts.
//
// This is the palette KiCad actually paints with. KiCad asks wxWidgets, and wx
// maps GTK's theme onto its own system-colour enum with logic of its own - so
// GTK's `theme_bg_color` (#2c2c2c) is NOT what a wxAuiToolBar draws on, which
// measures #373737 in a real GerbView. Reading the GTK palette answers a
// different question than the one KiCad asks.
//
// Build (see README.md - env -i is mandatory, XAUTHORITY is the mutter one):
//   g++ -Wno-deprecated-declarations -o syscolour_probe syscolour_probe.cpp \
//       $(wx-config --cxxflags --libs core,base)

#include <wx/wx.h>
#include <wx/settings.h>

struct Named { const char* name; wxSystemColour id; };

static const Named COLOURS[] = {
    { "3DDKSHADOW",        wxSYS_COLOUR_3DDKSHADOW },
    { "3DFACE / BTNFACE",  wxSYS_COLOUR_3DFACE },
    { "3DHIGHLIGHT",       wxSYS_COLOUR_3DHIGHLIGHT },
    { "3DLIGHT",           wxSYS_COLOUR_3DLIGHT },
    { "3DSHADOW",          wxSYS_COLOUR_3DSHADOW },
    { "ACTIVEBORDER",      wxSYS_COLOUR_ACTIVEBORDER },
    { "ACTIVECAPTION",     wxSYS_COLOUR_ACTIVECAPTION },
    { "APPWORKSPACE",      wxSYS_COLOUR_APPWORKSPACE },
    { "BTNHIGHLIGHT",      wxSYS_COLOUR_BTNHIGHLIGHT },
    { "BTNSHADOW",         wxSYS_COLOUR_BTNSHADOW },
    { "BTNTEXT",           wxSYS_COLOUR_BTNTEXT },
    { "CAPTIONTEXT",       wxSYS_COLOUR_CAPTIONTEXT },
    { "DESKTOP",           wxSYS_COLOUR_DESKTOP },
    { "GRAYTEXT",          wxSYS_COLOUR_GRAYTEXT },
    { "HIGHLIGHT",         wxSYS_COLOUR_HIGHLIGHT },
    { "HIGHLIGHTTEXT",     wxSYS_COLOUR_HIGHLIGHTTEXT },
    { "INACTIVEBORDER",    wxSYS_COLOUR_INACTIVEBORDER },
    { "INACTIVECAPTION",   wxSYS_COLOUR_INACTIVECAPTION },
    { "INACTIVECAPTIONTEXT", wxSYS_COLOUR_INACTIVECAPTIONTEXT },
    { "INFOBK",            wxSYS_COLOUR_INFOBK },
    { "INFOTEXT",          wxSYS_COLOUR_INFOTEXT },
    { "LISTBOX",           wxSYS_COLOUR_LISTBOX },
    { "LISTBOXTEXT",       wxSYS_COLOUR_LISTBOXTEXT },
    { "LISTBOXHIGHLIGHTTEXT", wxSYS_COLOUR_LISTBOXHIGHLIGHTTEXT },
    { "MENU",              wxSYS_COLOUR_MENU },
    { "MENUBAR",           wxSYS_COLOUR_MENUBAR },
    { "MENUHILIGHT",       wxSYS_COLOUR_MENUHILIGHT },
    { "MENUTEXT",          wxSYS_COLOUR_MENUTEXT },
    { "SCROLLBAR",         wxSYS_COLOUR_SCROLLBAR },
    { "WINDOW",            wxSYS_COLOUR_WINDOW },
    { "WINDOWFRAME",       wxSYS_COLOUR_WINDOWFRAME },
    { "WINDOWTEXT",        wxSYS_COLOUR_WINDOWTEXT },
};

struct NamedMetric { const char* name; wxSystemMetric id; };

static const NamedMetric METRICS[] = {
    { "BORDER_X",          wxSYS_BORDER_X },
    { "BORDER_Y",          wxSYS_BORDER_Y },
    { "EDGE_X",            wxSYS_EDGE_X },
    { "EDGE_Y",            wxSYS_EDGE_Y },
    { "HSCROLL_ARROW_X",   wxSYS_HSCROLL_ARROW_X },
    { "HTHUMB_X",          wxSYS_HTHUMB_X },
    { "ICON_X",            wxSYS_ICON_X },
    { "ICON_Y",            wxSYS_ICON_Y },
    { "SMALLICON_X",       wxSYS_SMALLICON_X },
    { "SMALLICON_Y",       wxSYS_SMALLICON_Y },
    { "HSCROLL_Y",         wxSYS_HSCROLL_Y },
    { "VSCROLL_X",         wxSYS_VSCROLL_X },
    { "MENU_Y",            wxSYS_MENU_Y },
    { "CAPTION_Y",         wxSYS_CAPTION_Y },
    { "SCREEN_X",          wxSYS_SCREEN_X },
    { "SCREEN_Y",          wxSYS_SCREEN_Y },
};

class Probe : public wxApp
{
public:
    bool OnInit() override
    {
        wxPrintf( "== wxSYS_COLOUR_*\n" );

        for( const Named& n : COLOURS )
        {
            wxColour c = wxSystemSettings::GetColour( n.id );
            wxPrintf( "  %-24s #%02x%02x%02x  rgb(%d, %d, %d)%s\n", n.name,
                      c.Red(), c.Green(), c.Blue(), c.Red(), c.Green(), c.Blue(),
                      c.Alpha() == 255 ? "" : wxString::Format( "  a=%d", c.Alpha() ).mb_str().data() );
        }

        wxPrintf( "\n== wxSYS_METRIC_*\n" );

        for( const NamedMetric& n : METRICS )
            wxPrintf( "  %-24s %d\n", n.name, wxSystemSettings::GetMetric( n.id ) );

        wxPrintf( "\n== fonts\n" );

        const struct { const char* name; wxSystemFont id; } FONTS[] = {
            { "DEFAULT_GUI_FONT", wxSYS_DEFAULT_GUI_FONT },
            { "SYSTEM_FONT",      wxSYS_SYSTEM_FONT },
            { "ANSI_VAR_FONT",    wxSYS_ANSI_VAR_FONT },
            { "ANSI_FIXED_FONT",  wxSYS_ANSI_FIXED_FONT },
        };

        for( const auto& f : FONTS )
        {
            wxFont fo = wxSystemSettings::GetFont( f.id );
            wxPrintf( "  %-20s %s  %dpt  weight %d  %s\n", f.name,
                      fo.GetFaceName().mb_str().data(), fo.GetPointSize(),
                      (int) fo.GetWeight(), fo.GetNativeFontInfoDesc().mb_str().data() );
        }

        // A wxPanel's character cell, which every dialog-unit size divides by.
        wxFrame* frame = new wxFrame( nullptr, wxID_ANY, "probe" );
        wxPanel* panel = new wxPanel( frame );
        wxPrintf( "\n== wxPanel character cell (the dialog-unit base)\n" );
        wxPrintf( "  GetCharWidth()  %d\n", panel->GetCharWidth() );
        wxPrintf( "  GetCharHeight() %d\n", panel->GetCharHeight() );
        wxPrintf( "  ConvertDialogToPixels(100,100) = %d x %d\n",
                  panel->ConvertDialogToPixels( wxSize( 100, 100 ) ).x,
                  panel->ConvertDialogToPixels( wxSize( 100, 100 ) ).y );

        frame->Destroy();
        return false;
    }
};

wxIMPLEMENT_APP_CONSOLE( Probe );

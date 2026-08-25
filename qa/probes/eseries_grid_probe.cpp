// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
//
// Asks wxWidgets what colour the E-Series grids' lines are.
//
// PANEL_ESERIES_DISPLAY::PANEL_ESERIES_DISPLAY does
//
//     wxColour clr = parent->GetBackgroundColour();
//     m_GridEseries112->SetGridLineColour( clr );
//
// (pcb_calculator/calculator_panels/panel_eseries_display.cpp:73-84), and the
// parent is the frame's wxTreebook (pcb_calculator_frame.cpp:183). Our CSS
// asserts `--chrome-bg` for that rule with no [px] tag; `--chrome-bg2`, which
// is documented as wxSYS_COLOUR_WINDOW, is the plausible alternative. This
// prints what GTK actually answers, on this machine, with this theme.
//
//   g++ -Wno-deprecated-declarations -o eseries_grid_probe eseries_grid_probe.cpp \
//       $(wx-config --cxxflags --libs core,base,adv)
//
//   env -i HOME="$HOME" PATH=/usr/bin:/bin USER="$USER" DISPLAY=:0 \
//       XAUTHORITY="$XAUTHORITY" XDG_RUNTIME_DIR="$XDG_RUNTIME_DIR" \
//       GDK_BACKEND=x11 ./eseries_grid_probe

#include <wx/wx.h>
#include <wx/treebook.h>
#include <wx/settings.h>
#include <wx/grid.h>

static void say( const char* what, const wxColour& c )
{
    printf( "%-34s rgb(%d, %d, %d)  %s\n", what, c.Red(), c.Green(), c.Blue(),
            (const char*) c.GetAsString( wxC2S_HTML_SYNTAX ).mb_str() );
}

class Probe : public wxApp
{
public:
    bool OnInit() override
    {
        wxFrame* frame = new wxFrame( nullptr, wxID_ANY, "probe" );
        wxTreebook* book = new wxTreebook( frame, wxID_ANY );
        wxPanel* page = new wxPanel( book );
        book->AddPage( page, "General system design" );

        // The exact call the panel makes.
        say( "treebook GetBackgroundColour", book->GetBackgroundColour() );
        say( "page GetBackgroundColour", page->GetBackgroundColour() );
        say( "frame GetBackgroundColour", frame->GetBackgroundColour() );
        say( "wxSYS_COLOUR_WINDOW", wxSystemSettings::GetColour( wxSYS_COLOUR_WINDOW ) );
        say( "wxSYS_COLOUR_BTNFACE", wxSystemSettings::GetColour( wxSYS_COLOUR_BTNFACE ) );
        say( "wxSYS_COLOUR_3DLIGHT", wxSystemSettings::GetColour( wxSYS_COLOUR_3DLIGHT ) );

        wxGrid* grid = new wxGrid( page, wxID_ANY );
        grid->CreateGrid( 2, 2 );
        say( "wxGrid default line colour", grid->GetGridLineColour() );
        say( "wxGrid default label bg", grid->GetLabelBackgroundColour() );

        return false; // no main loop
    }
};

wxIMPLEMENT_APP_NO_MAIN( Probe );

int main( int argc, char** argv )
{
    wxEntryStart( argc, argv );
    wxTheApp->CallOnInit();
    wxEntryCleanup();
    return 0;
}

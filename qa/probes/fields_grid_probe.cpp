// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
//
// The Symbol Properties fields grid, asked of the widget that draws it.
//
// DIALOG_SYMBOL_PROPERTIES builds a WX_GRID (eeschema/dialogs/
// dialog_symbol_properties_base.cpp:30-82) and gives it a FIELDS_GRID_TABLE.
// WX_GRID's constructor sets BOTH the cell and the label font to
// KIUI::GetControlFont (common/widgets/wx_grid.cpp:217-218), which off macOS is
// the plain wxSYS_DEFAULT_GUI_FONT, and then wxGrid derives the DEFAULT ROW
// HEIGHT from that font. That number appears nowhere in KiCad's source, so it
// has to be measured here.
//
//   g++ -Wno-deprecated-declarations -o fields_grid_probe fields_grid_probe.cpp \
//       $(wx-config --cxxflags --libs core,base,adv)
//
// Run it the way qa/probes/README.md says (env -i ... DISPLAY=:0), and let the
// event loop settle before asking: GTK does not recompute a grid's metrics
// until it is realized.
#include <wx/wx.h>
#include <wx/grid.h>

static void settle( wxWindow* w )
{
    for( int i = 0; i < 50; ++i )
    {
        wxYield();
        w->Layout();
    }
}

class Probe : public wxApp
{
public:
    bool OnInit() override
    {
        wxFrame* f = new wxFrame( nullptr, wxID_ANY, "p", wxDefaultPosition, wxSize( 1000, 400 ) );
        wxPanel* p = new wxPanel( f );

        wxFont gui = wxSystemSettings::GetFont( wxSYS_DEFAULT_GUI_FONT );
        wxPrintf( "GUI font (wxSYS_DEFAULT_GUI_FONT): %s %dpt\n\n", gui.GetFaceName(),
                  gui.GetPointSize() );

        wxGrid* g = new wxGrid( p, wxID_ANY );
        g->CreateGrid( 5, 14 );

        // WX_GRID::WX_GRID, wx_grid.cpp:217-218.
        g->SetLabelFont( gui );
        g->SetDefaultCellFont( gui );

        // The base class's own calls.
        g->SetColLabelSize( 22 );
        g->SetRowLabelSize( 0 );
        g->SetMargins( 0, 0 );

        // FIELDS_GRID_TABLE's three renderers, so a row carrying each can be
        // compared against a plain text row.
        g->SetCellRenderer( 1, 2, new wxGridCellBoolRenderer() );
        g->SetCellEditor( 1, 2, new wxGridCellBoolEditor() );
        wxArrayString hAlign;
        hAlign.Add( "Left" );
        hAlign.Add( "Center" );
        hAlign.Add( "Right" );
        g->SetCellEditor( 1, 4, new wxGridCellChoiceEditor( hAlign ) );

        wxBoxSizer* s = new wxBoxSizer( wxVERTICAL );
        s->Add( g, 1, wxEXPAND );
        p->SetSizer( s );
        f->Show();
        settle( p );

        wxPrintf( "GetDefaultRowSize()      %d\n", g->GetDefaultRowSize() );
        wxPrintf( "GetDefaultRowLabelSize() %d\n", g->GetDefaultRowLabelSize() );
        wxPrintf( "GetColLabelSize()        %d\n", g->GetColLabelSize() );
        wxPrintf( "GetRowSize( 0 )          %d   (plain text row)\n", g->GetRowSize( 0 ) );
        wxPrintf( "GetRowSize( 1 )          %d   (bool + choice cells)\n", g->GetRowSize( 1 ) );

        for( int r = 0; r < 5; ++r )
            wxPrintf( "  row %d height = %d\n", r, g->GetRowSize( r ) );

        wxPrintf( "\nGetDefaultColSize()      %d\n", g->GetDefaultColSize() );
        wxPrintf( "GetColSize( 14th )       %d   (Allow Autoplacement: no SetColSize)\n",
                  g->GetColSize( 13 ) );

        // The three surfaces, so the CSS tokens can be checked against them.
        wxPrintf( "\nlabel bg   %s\n", g->GetLabelBackgroundColour().GetAsString( wxC2S_HTML_SYNTAX ) );
        wxPrintf( "cell bg    %s\n", g->GetDefaultCellBackgroundColour().GetAsString( wxC2S_HTML_SYNTAX ) );
        wxPrintf( "grid lines %s\n", g->GetGridLineColour().GetAsString( wxC2S_HTML_SYNTAX ) );
        wxPrintf( "selection  %s\n", g->GetSelectionBackground().GetAsString( wxC2S_HTML_SYNTAX ) );

        // KIPLATFORM::UI::GetDialogBGColour(), what m_tcLibraryID is painted
        // (dialog_symbol_properties.cpp:384).
        wxPrintf( "\nBTNFACE (GetDialogBGColour) %s\n",
                  wxSystemSettings::GetColour( wxSYS_COLOUR_BTNFACE )
                          .GetAsString( wxC2S_HTML_SYNTAX ) );

        f->Destroy();
        return false;
    }
};

wxIMPLEMENT_APP_CONSOLE( Probe );

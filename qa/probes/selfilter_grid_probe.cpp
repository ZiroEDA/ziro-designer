// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
//
// Every number the Selection Filter is built out of, asked of the widget that
// draws it rather than derived from a screenshot or a stylesheet.
//
// The panel is PANEL_SCH_SELECTION_FILTER (eeschema/widgets) and pcbnew's
// PANEL_SELECTION_FILTER, which are the same widget twice: a
// wxGridBagSizer( 0, 0 ) whose every item is added with a 5px border, carrying
// KIUI::GetInfoFont == getGUIFont( win, -1 ) on every checkbox
// (common/widgets/ui_common.cpp:156). The grid below is eeschema's, copied from
// panel_sch_selection_filter_base.cpp:14-66 including the Hide() at (5,0).
//
//   g++ -Wno-deprecated-declarations -o selfilter_grid_probe selfilter_grid_probe.cpp \
//       $(wx-config --cxxflags --libs core,base)
//
// MEASURE AFTER THE EVENT LOOP HAS RUN. GTK only recomputes a widget's
// preferred size once it is realized and its style has settled, so asking
// straight out of OnInit reports the size the widget had BEFORE SetFont — and
// reports it identically for every point size, which is what makes the mistake
// look like a result. Sweep 1 below is the check: if its heights do not move
// with the font, the probe is measuring nothing.
#include <wx/wx.h>
#include <wx/gbsizer.h>

// Let the loop run, then invalidate so the next Layout asks GTK afresh.
static void settle( wxWindow* w, const std::vector<wxWindow*>& kids )
{
    for( int i = 0; i < 50; ++i )
    {
        wxYield();
        for( wxWindow* k : kids )
            k->InvalidateBestSize();
        w->Layout();
    }
}

struct Cell { const char* label; int row, col; int border; bool hide; };

class Probe : public wxApp
{
public:
    bool OnInit() override
    {
        wxFrame* f = new wxFrame( nullptr, wxID_ANY, "p" );
        wxPanel* p = new wxPanel( f );

        wxFont gui = p->GetFont();
        wxFont info = gui;
        info.SetPointSize( info.GetPointSize() - 1 );   // KIUI::GetInfoFont

        wxPrintf( "GUI font (wxSYS_DEFAULT_GUI_FONT): %s %dpt\n",
                  gui.GetFaceName(), gui.GetPointSize() );
        wxPrintf( "Info font (getGUIFont( win, -1 )): %s %dpt\n\n",
                  info.GetFaceName(), info.GetPointSize() );

        // ---------------------------------------------------------------
        // 1. The row height, and what decides it.
        //
        // A checkbox and a radio return the SAME height, so the panel's row is
        // not a checkbox-versus-radio question: it is a font question. 22 at
        // the GUI font is --check-row (which bitmap2component's radios want);
        // 21 at the info font is --check-row-info, which is this panel.
        // ---------------------------------------------------------------
        {
            const int    N = 5;
            wxCheckBox*  cb[N];
            wxRadioButton* rb[N];
            std::vector<wxWindow*> kids;

            for( int i = 0; i < N; ++i )
            {
                wxFont fo = gui;
                fo.SetPointSize( 8 + i );
                cb[i] = new wxCheckBox( p, wxID_ANY, "Graphics" );    cb[i]->SetFont( fo );
                rb[i] = new wxRadioButton( p, wxID_ANY, "Graphics" ); rb[i]->SetFont( fo );
                kids.push_back( cb[i] );
                kids.push_back( rb[i] );
            }

            wxCheckBox* bare = new wxCheckBox( p, wxID_ANY, wxEmptyString );
            bare->SetFont( info );
            kids.push_back( bare );

            f->Show();
            settle( p, kids );

            wxPrintf( "1. row height by font ('Graphics')\n" );
            wxPrintf( "   %-5s %-16s %s\n", "pt", "wxCheckBox", "wxRadioButton" );

            for( int i = 0; i < N; ++i )
                wxPrintf( "   %-5d %4d x %-9d %4d x %d\n", 8 + i,
                          cb[i]->GetBestSize().x, cb[i]->GetBestSize().y,
                          rb[i]->GetBestSize().x, rb[i]->GetBestSize().y );

            wxPrintf( "   indicator alone (no label): %d wide\n\n", bare->GetBestSize().x );

            for( wxWindow* k : kids )
                k->Destroy();
        }

        // ---------------------------------------------------------------
        // 2. The indicator-to-label inset.
        //
        // Gtk.CheckButton lays out focus-padding 1 + focus-line-width 1 +
        // indicator-spacing 2 = 4 before the indicator, the same 4 after it,
        // and the same 4 past the label. So the widget is 4 + 16 + 4 + text + 4
        // and "cbox - text" below is 28 for EVERY label — the same constant ten
        // times, which is what makes it a metric and not a coincidence.
        // ---------------------------------------------------------------
        {
            const char* L[] = { "All items", "Rule Areas", "Symbols", "Pins", "Wires",
                                "Labels", "Graphics", "Images", "Text", "Other items" };
            const int   N = 10;
            wxCheckBox* cb[N];
            std::vector<wxWindow*> kids;

            for( int i = 0; i < N; ++i )
            {
                cb[i] = new wxCheckBox( p, wxID_ANY, L[i] );
                cb[i]->SetFont( info );
                kids.push_back( cb[i] );
            }

            settle( p, kids );

            wxClientDC dc( p );
            dc.SetFont( info );

            wxPrintf( "2. widget width vs text width, at the info font\n" );
            wxPrintf( "   %-13s %-6s %-6s %s\n", "label", "cbox", "text", "cbox - text" );

            for( int i = 0; i < N; ++i )
            {
                int tw, th;
                dc.GetTextExtent( L[i], &tw, &th );
                wxPrintf( "   %-13s %-6d %-6d %d\n", L[i], cb[i]->GetBestSize().x, tw,
                          cb[i]->GetBestSize().x - tw );
            }

            wxPrintf( "\n" );

            for( wxWindow* k : kids )
                k->Destroy();
        }

        // ---------------------------------------------------------------
        // 3. The grid itself, as the sizer lays it out.
        //
        // Row heights come out 26/21/21/21/26 — the 21px control with 5 added
        // above the first row and below the last, and NOTHING between, because
        // the vgap is 0. Column 0 comes out 90: "Graphics" at 80 plus its 5+5.
        // ---------------------------------------------------------------
        {
            wxPanel* g = new wxPanel( f );
            wxGridBagSizer* gb = new wxGridBagSizer( 0, 0 );
            gb->SetFlexibleDirection( wxBOTH );
            gb->SetNonFlexibleGrowMode( wxFLEX_GROWMODE_SPECIFIED );

            Cell cells[] = {
                { "All items",    0, 0, wxLEFT|wxTOP,            false },
                { "Rule Areas",   0, 1, wxLEFT|wxRIGHT|wxTOP,    false },
                { "Locked items", 5, 0, wxLEFT|wxRIGHT|wxTOP,    true  },
                { "Symbols",      1, 0, wxLEFT|wxRIGHT,          false },
                { "Pins",         1, 1, wxLEFT|wxRIGHT,          false },
                { "Wires",        2, 0, wxLEFT|wxRIGHT,          false },
                { "Labels",       2, 1, wxLEFT|wxRIGHT,          false },
                { "Graphics",     3, 0, wxLEFT|wxRIGHT,          false },
                { "Images",       3, 1, wxLEFT|wxRIGHT,          false },
                { "Text",         4, 0, wxLEFT|wxRIGHT,          false },
                { "Other items",  4, 1, wxBOTTOM|wxLEFT|wxRIGHT, false },
            };

            wxCheckBox* cb[11];
            std::vector<wxWindow*> kids;

            for( int i = 0; i < 11; ++i )
            {
                cb[i] = new wxCheckBox( g, wxID_ANY, cells[i].label );
                cb[i]->SetValue( true );
                cb[i]->SetFont( info );

                if( cells[i].hide )
                    cb[i]->Hide();

                gb->Add( cb[i], wxGBPosition( cells[i].row, cells[i].col ), wxGBSpan( 1, 1 ),
                         cells[i].border, 5 );
                kids.push_back( cb[i] );
            }

            g->SetSizer( gb );
            settle( g, kids );
            gb->Fit( g );

            wxPrintf( "3. the grid, laid out\n" );
            wxPrintf( "   panel client size: %d x %d\n", g->GetClientSize().x,
                      g->GetClientSize().y );
            wxPrintf( "   %-13s %-6s %-10s %s\n", "label", "cell", "pos", "size" );

            for( int i = 0; i < 11; ++i )
                wxPrintf( "   %-13s (%d,%d)  %4d,%-5d %4d x %-4d%s\n", cells[i].label,
                          cells[i].row, cells[i].col, cb[i]->GetPosition().x,
                          cb[i]->GetPosition().y, cb[i]->GetSize().x, cb[i]->GetSize().y,
                          cells[i].hide ? "  [hidden]" : "" );

            wxPrintf( "   column widths:" );
            for( int c : gb->GetColWidths() )
                wxPrintf( " %d", c );

            wxPrintf( "\n   row heights  :" );
            for( int r : gb->GetRowHeights() )
                wxPrintf( " %d", r );

            wxPrintf( "\n" );
        }

        f->Destroy();
        return false;
    }
};
wxIMPLEMENT_APP_CONSOLE( Probe );

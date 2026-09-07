// How wide is a Pre-defined Sizes column, and how far apart are its buttons?
//
// `panel_setup_tracks_and_vias_base.cpp` says `SetColSize( 0, 120 )`, and then
// the .cpp throws that away (`:106-120`):
//
//     int min_linesize = grid->GetTextExtent( wxT( "000.000000 mm " ) ).x;
//     int best_w = std::max( min_linesize, grid->GetVisibleWidth( col, … ) );
//     curr_grid->SetColMinimalWidth( col, best_w );
//     curr_grid->SetColSize( col, best_w );
//
// so the real width is a text extent in the grid's own font, which is a wx
// question. Build the grid wx builds and ask it.
//
// Build:
//   g++ -Wno-deprecated-declarations -o tracks_vias_grid_probe \
//       tracks_vias_grid_probe.cpp $(wx-config --cxxflags --libs core,base,adv)
#include <wx/wx.h>
#include <wx/grid.h>
#include <cstdio>

class App : public wxApp
{
public:
    bool OnInit() override
    {
        wxFrame* frame = new wxFrame( nullptr, wxID_ANY, "probe" );
        wxPanel* panel = new wxPanel( frame );

        wxGrid* grid = new wxGrid( panel, wxID_ANY );
        grid->CreateGrid( 2, 2 );
        grid->SetColSize( 0, 120 );
        grid->SetColLabelValue( 0, "Diameter" );
        grid->SetColLabelValue( 1, "Hole" );
        grid->SetRowLabelSize( 0 );
        grid->SetColLabelSize( wxGRID_AUTOSIZE );
        grid->SetCellValue( 0, 0, "0.8 mm" );

        wxBoxSizer* s = new wxBoxSizer( wxVERTICAL );
        s->Add( grid, 1, wxEXPAND | wxRIGHT, 5 );
        panel->SetSizer( s );
        frame->Show();
        panel->Layout();

        printf( "GetTextExtent(\"000.000000 mm \")  %d\n",
                grid->GetTextExtent( wxT( "000.000000 mm " ) ).x );
        printf( "column label height (AUTOSIZE)    %d\n", grid->GetColLabelSize() );
        printf( "default row size                  %d\n", grid->GetDefaultRowSize() );
        printf( "base-file SetColSize( 0, 120 )    120 (overridden by the extent above)\n" );
        fflush( stdout );
        frame->Destroy();
        return true;
    }
};
wxIMPLEMENT_APP_CONSOLE( App );

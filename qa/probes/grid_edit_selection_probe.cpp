// Does starting a cell editor clear the ROW selection?
//
// DIALOG_SYMBOL_PROPERTIES' fields grid is wxGridSelectRows
// (dialog_symbol_properties.cpp:340), so clicking a cell fills the whole row.
// KiCad's own screenshots show NO fill while a cell is being edited, and wx's
// sources are not on this machine — so ask a live grid.
#include <wx/wx.h>
#include <wx/grid.h>

class App : public wxApp
{
public:
    bool OnInit() override
    {
        wxFrame* f = new wxFrame( nullptr, wxID_ANY, "probe" );
        wxGrid* g = new wxGrid( f, wxID_ANY );
        g->CreateGrid( 4, 3 );
        g->SetSelectionMode( wxGrid::wxGridSelectRows );
        for( int r = 0; r < 4; ++r )
            for( int c = 0; c < 3; ++c )
                g->SetCellValue( r, c, wxString::Format( "r%dc%d", r, c ) );
        f->Show();
        while( Pending() ) Dispatch();

        g->SetGridCursor( 2, 1 );
        g->SelectRow( 2 );
        while( Pending() ) Dispatch();
        wxPrintf( "%-38s rows=%zu  inSel(2,1)=%d\n", "after SelectRow(2)",
                  g->GetSelectedRows().GetCount(), (int) g->IsInSelection( 2, 1 ) );

        g->EnableCellEditControl( true );
        while( Pending() ) Dispatch();
        wxPrintf( "%-38s rows=%zu  inSel(2,1)=%d  editing=%d\n", "after EnableCellEditControl(true)",
                  g->GetSelectedRows().GetCount(), (int) g->IsInSelection( 2, 1 ),
                  (int) g->IsCellEditControlShown() );

        g->DisableCellEditControl();
        while( Pending() ) Dispatch();
        wxPrintf( "%-38s rows=%zu  inSel(2,1)=%d\n", "after DisableCellEditControl()",
                  g->GetSelectedRows().GetCount(), (int) g->IsInSelection( 2, 1 ) );
        f->Destroy();
        return false;
    }
};
wxIMPLEMENT_APP_NO_MAIN( App );
int main( int argc, char** argv ) { wxEntryStart( argc, argv ); wxTheApp->CallOnInit(); return 0; }

// What colour is a SELECTED row painted while one of its cells is being
// edited?
//
// `grid_edit_selection_probe` already answered the first half: the row stays
// selected across EnableCellEditControl. But KiCad's own screenshot of
// PANEL_FP_USER_LAYER_NAMES shows no orange fill on the row it is editing, so
// the difference has to be in the PAINT, not in the selection --
// wxGridCellRenderer::Draw picks GetSelectionBackground() only `if
// ( grid.HasFocus() )` and wxSYS_COLOUR_BTNSHADOW otherwise.
//
// So: put the grid on screen, and in each state ask the renderer to draw the
// row-label-adjacent cell into a bitmap and read the pixel back. That is the
// same call wxGrid makes on a paint.
#include <wx/wx.h>
#include <wx/grid.h>
#include <wx/dcmemory.h>

static void report( const char* what, wxGrid* g, int row, int col )
{
    wxBitmap bmp( 60, 20, 24 );
    wxMemoryDC dc( bmp );
    dc.SetBackground( *wxBLACK_BRUSH );
    dc.Clear();

    wxGridCellAttr*     attr = g->GetOrCreateCellAttr( row, col );
    wxGridCellRenderer* r = attr->GetRenderer( g, row, col );
    r->Draw( *g, *attr, dc, wxRect( 0, 0, 60, 20 ), row, col, g->IsInSelection( row, col ) );
    r->DecRef();
    attr->DecRef();

    dc.SelectObject( wxNullBitmap );
    wxImage  img = bmp.ConvertToImage();
    wxColour px( img.GetRed( 3, 3 ), img.GetGreen( 3, 3 ), img.GetBlue( 3, 3 ) );

    wxPrintf( "%-34s inSel=%d gridHasFocus=%d editing=%d  cellFill=%s\n", what,
              (int) g->IsInSelection( row, col ), (int) g->HasFocus(),
              (int) g->IsCellEditControlShown(), px.GetAsString( wxC2S_HTML_SYNTAX ) );
}

class App : public wxApp
{
public:
    bool OnInit() override
    {
        wxFrame* f = new wxFrame( nullptr, wxID_ANY, "probe" );
        wxGrid*  g = new wxGrid( f, wxID_ANY );
        g->CreateGrid( 4, 3 );
        g->SetSelectionMode( wxGrid::wxGridSelectRows );
        for( int r = 0; r < 4; ++r )
            for( int c = 0; c < 3; ++c )
                g->SetCellValue( r, c, wxString::Format( "r%dc%d", r, c ) );
        f->Show();
        g->SetFocus();
        while( Pending() ) Dispatch();

        wxPrintf( "SelectionBackground = %s\n",
                  g->GetSelectionBackground().GetAsString( wxC2S_HTML_SYNTAX ) );
        wxPrintf( "wxSYS_COLOUR_HIGHLIGHT = %s\n",
                  wxSystemSettings::GetColour( wxSYS_COLOUR_HIGHLIGHT )
                          .GetAsString( wxC2S_HTML_SYNTAX ) );
        wxPrintf( "wxSYS_COLOUR_BTNSHADOW = %s\n",
                  wxSystemSettings::GetColour( wxSYS_COLOUR_BTNSHADOW )
                          .GetAsString( wxC2S_HTML_SYNTAX ) );
        wxPrintf( "default cell background = %s\n",
                  g->GetDefaultCellBackgroundColour().GetAsString( wxC2S_HTML_SYNTAX ) );

        report( "unselected row", g, 0, 0 );

        g->SetGridCursor( 2, 1 );
        g->SelectRow( 2 );
        g->SetFocus();
        while( Pending() ) Dispatch();
        report( "selected, grid focused", g, 2, 0 );

        g->EnableCellEditControl( true );
        g->ShowCellEditControl();
        while( Pending() ) Dispatch();
        report( "selected, editor open", g, 2, 0 );

        g->DisableCellEditControl();
        g->SetFocus();
        while( Pending() ) Dispatch();
        report( "selected, editor closed again", g, 2, 0 );

        f->Destroy();
        return false;
    }
};
wxIMPLEMENT_APP_NO_MAIN( App );
int main( int argc, char** argv )
{
    wxEntryStart( argc, argv );
    wxTheApp->CallOnInit();
    return 0;
}

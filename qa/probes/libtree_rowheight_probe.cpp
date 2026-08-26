// The symbol chooser tree's row height, asked of wxWidgets AND of GTK.
//
// LIB_TREE does not take GTK's own row height. It overrides it
// (common/widgets/lib_tree.cpp:177-180):
//
//     #ifdef __WXGTK__
//         int rowHeight = FromDIP( 6 ) + GetTextExtent( wxS( "pdI" ) ).y;
//         m_tree_ctrl->SetRowHeight( rowHeight );
//     #endif
//
// "pdI" is chosen for its ascender, descender and cap height, so the extent is
// the font's full line box.
//
// THE FORMULA IS NOT THE ANSWER. A first version of this probe printed only
// `FromDIP(6) + GetTextExtent("pdI").y` and reported 24, but a live chooser
// measures 26 between row baselines. What wx asks for and what GTK draws are
// two different numbers: GtkTreeView inserts its "vertical-separator" style
// property BETWEEN rows, so the pitch is the requested cell height plus that
// separator. `chooser_cells_probe.cpp` hit the same class of error from the
// other direction, where a naive derivation said 24 and the real list was 29.
//
// So this prints the requested height, the separator GTK will add, and the
// realized row height read back off the widget, and the last of those is the
// one to port.
//
//   g++ -Wno-deprecated-declarations -o libtree_rowheight_probe \
//       libtree_rowheight_probe.cpp \
//       $(wx-config --cxxflags --libs core,base,adv) $(pkg-config --cflags --libs gtk+-3.0)
#include <wx/wx.h>
#include <wx/dataview.h>
#include <gtk/gtk.h>
#include <cstdio>
#include <vector>

static void collect( GtkWidget* w, std::vector<GtkWidget*>& out )
{
    out.push_back( w );
    if( GTK_IS_CONTAINER( w ) )
    {
        GList* kids = gtk_container_get_children( GTK_CONTAINER( w ) );
        for( GList* l = kids; l; l = l->next ) collect( GTK_WIDGET( l->data ), out );
        g_list_free( kids );
    }
}

class Probe : public wxApp
{
public:
    bool OnInit() override
    {
        wxDialog* dlg = new wxDialog( nullptr, wxID_ANY, wxS( "Choose Symbol" ),
                                      wxDefaultPosition, wxSize( 900, 600 ) );
        wxPanel* panel = new wxPanel( dlg, wxID_ANY );

        const wxFont font = panel->GetFont();
        const wxSize ext = panel->GetTextExtent( wxS( "pdI" ) );
        const int    dip6 = panel->FromDIP( 6 );
        const int    asked = dip6 + ext.y;

        printf( "font                 %s %g pt\n",
                (const char*) font.GetFaceName().utf8_str(), font.GetFractionalPointSize() );
        printf( "GetTextExtent(pdI).y %d\n", ext.y );
        printf( "FromDIP(6)           %d\n", dip6 );
        printf( "REQUESTED rowHeight  %d   <- what LIB_TREE passes to SetRowHeight\n", asked );

        // Build the control the way LIB_TREE does and ask for that height.
        wxDataViewListCtrl* dv = new wxDataViewListCtrl( panel, wxID_ANY, wxDefaultPosition,
                                                         wxSize( 600, 400 ), wxDV_SINGLE );
        dv->AppendTextColumn( wxS( "Item" ) );
        dv->AppendTextColumn( wxS( "Description" ) );
        for( int i = 0; i < 12; ++i )
        {
            wxVector<wxVariant> row;
            row.push_back( wxVariant( wxString::Format( "Screw_Terminal_01x%02d", i + 1 ) ) );
            row.push_back( wxVariant( wxS( "Generic screw terminal" ) ) );
            dv->AppendItem( row );
        }
        dv->SetRowHeight( asked );

        wxBoxSizer* s = new wxBoxSizer( wxVERTICAL );
        s->Add( dv, 1, wxEXPAND );
        panel->SetSizer( s );
        dlg->Show();
        panel->Layout();
        wxYield();

        // Now ask GTK what it will actually draw.
        std::vector<GtkWidget*> ws;
        collect( dv->GetHandle(), ws );
        for( GtkWidget* w : ws )
        {
            if( !GTK_IS_TREE_VIEW( w ) ) continue;

            gint sep = 0;
            gtk_widget_style_get( w, "vertical-separator", &sep, NULL );
            printf( "GtkTreeView vertical-separator  %d\n", sep );
            printf( "RENDERED row pitch              %d   <- port THIS\n", asked + sep );

            // Cross-check against the row rectangle GTK reports, which is the
            // strongest form: not a formula at all, but the geometry it will use.
            GtkTreePath* path = gtk_tree_path_new_from_indices( 1, -1 );
            GdkRectangle rect;
            gtk_tree_view_get_background_area( GTK_TREE_VIEW( w ), path, NULL, &rect );
            printf( "background_area(row 1).height   %d\n", rect.height );
            gtk_tree_path_free( path );
        }

        dlg->Destroy();
        return false;
    }
};

wxIMPLEMENT_APP_CONSOLE( Probe );

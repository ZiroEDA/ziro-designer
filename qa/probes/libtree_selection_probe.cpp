// What a wxDataViewCtrl actually PAINTS for a selected row, on this machine
// with this theme.
//
// LIB_TREE (common/widgets/lib_tree.cpp:169-180) builds a WX_DATAVIEWCTRL and
// overrides its row height with `FromDIP( 6 ) + GetTextExtent( "pdI" ).y`. It
// declares NO colour for the selection: the highlight is whatever GTK's
// treeview draws for `:selected`. Ours drew a rounded, horizontally inset
// orange pill, and the question this answers is what the real one is - colour,
// alpha, whether it bleeds to the control's edges, and whether it has a corner
// radius.
//
// It also reports the same colour from the GtkStyleContext in three states,
// because a GNOME screen capture always holds the focus and so always shows the
// BACKDROP colour of the window it captured (see the "Screenshots show backdrop
// colours" note). The painted pixel of a window this probe itself presents is
// the focused one.
//
// Build (see README.md - env -i is mandatory, XAUTHORITY is the mutter one):
//   g++ -Wno-deprecated-declarations -o libtree_selection_probe \
//       libtree_selection_probe.cpp \
//       $(wx-config --cxxflags --libs core,base) $(pkg-config --cflags --libs gtk+-3.0)
#include <wx/wx.h>
#include <wx/dataview.h>
#include <wx/settings.h>
#include <gtk/gtk.h>
#include <cstdio>
#include <vector>

static void collect( GtkWidget* w, std::vector<GtkWidget*>& out )
{
    out.push_back( w );

    if( GTK_IS_CONTAINER( w ) )
    {
        GList* kids = gtk_container_get_children( GTK_CONTAINER( w ) );

        for( GList* l = kids; l; l = l->next )
            collect( GTK_WIDGET( l->data ), out );

        g_list_free( kids );
    }
}

static void pump()
{
    for( int i = 0; i < 400; ++i )
    {
        while( gtk_events_pending() )
            gtk_main_iteration();
    }
}

static cairo_surface_t* g_shot = nullptr;
static GtkWidget*       g_top = nullptr;

// Read the mapped toplevel back out of the display server: what a screenshot
// would capture, except that this window has the focus.
static void snapshot( wxWindow* aWin )
{
    g_top = gtk_widget_get_toplevel( (GtkWidget*) aWin->GetHandle() );

    GtkAllocation a;
    gtk_widget_get_allocation( g_top, &a );

    GdkWindow* gw = gtk_widget_get_window( g_top );
    GdkPixbuf* pb = gdk_pixbuf_get_from_window( gw, 0, 0, a.width, a.height );

    if( !pb )
    {
        printf( "  (could not read the window back from the server)\n" );
        return;
    }

    g_shot = cairo_image_surface_create( CAIRO_FORMAT_ARGB32, a.width, a.height );
    cairo_t* cr = cairo_create( g_shot );
    gdk_cairo_set_source_pixbuf( cr, pb, 0, 0 );
    cairo_paint( cr );
    cairo_destroy( cr );
    g_object_unref( pb );
    cairo_surface_flush( g_shot );
    printf( "  (toplevel read back from the server, %dx%d)\n", a.width, a.height );
}

static bool shotPixel( int x, int y, unsigned char out[4] )
{
    if( !g_shot )
        return false;

    int w = cairo_image_surface_get_width( g_shot );
    int h = cairo_image_surface_get_height( g_shot );

    if( x < 0 || y < 0 || x >= w || y >= h )
        return false;

    unsigned char* data = cairo_image_surface_get_data( g_shot );
    int            stride = cairo_image_surface_get_stride( g_shot );
    unsigned char* p = data + y * stride + x * 4;       // BGRA, premultiplied
    out[0] = p[2]; out[1] = p[1]; out[2] = p[0]; out[3] = p[3];
    return true;
}

static void widgetOrigin( wxWindow* aWin, int& ox, int& oy, int& w, int& h )
{
    GtkWidget*    gw = (GtkWidget*) aWin->GetHandle();
    GtkAllocation a;
    gtk_widget_get_allocation( gw, &a );
    w = a.width;
    h = a.height;
    ox = oy = 0;
    gtk_widget_translate_coordinates( gw, g_top, 0, 0, &ox, &oy );
}

static void styleColour( GtkStyleContext* ctx, GtkStateFlags state, const char* label )
{
    GdkRGBA fg;
    GdkRGBA bg;
    gtk_style_context_save( ctx );
    gtk_style_context_set_state( ctx, state );
    gtk_style_context_get_color( ctx, state, &fg );
    gtk_style_context_get( ctx, state, GTK_STYLE_PROPERTY_BACKGROUND_COLOR, &bg, NULL );
    gtk_style_context_restore( ctx );

    printf( "  %-34s bg rgba(%.0f,%.0f,%.0f,%.3f) #%02x%02x%02x   fg #%02x%02x%02x\n", label,
            bg.red * 255, bg.green * 255, bg.blue * 255, bg.alpha, (int) ( bg.red * 255 + 0.5 ),
            (int) ( bg.green * 255 + 0.5 ), (int) ( bg.blue * 255 + 0.5 ),
            (int) ( fg.red * 255 + 0.5 ), (int) ( fg.green * 255 + 0.5 ),
            (int) ( fg.blue * 255 + 0.5 ) );
}


// LIB_TREE_RENDERER, verbatim in the part that decides geometry
// (common/lib_tree_model_adapter.cpp:52-90): a wxDataViewCustomRenderer whose
// GetSize() answers `GetTextExtent( m_text ).y + 2`. The built-in text renderer
// a plain wxDataViewListCtrl uses does NOT answer that, and the row pitch is
// not the same for the two - which is the whole reason this class is copied
// here rather than approximated.
class LibTreeRenderer : public wxDataViewCustomRenderer
{
public:
    wxSize GetSize() const override
    {
        wxSize size( GetOwner()->GetWidth(), GetTextExtent( m_text ).y + 2 );
        size.IncTo( wxSize( 1, 1 ) );
        return size;
    }

    bool GetValue( wxVariant& aValue ) const override { aValue = m_text; return true; }
    bool SetValue( const wxVariant& aValue ) override { m_text = aValue.GetString(); return true; }

    bool Render( wxRect aRect, wxDC* dc, int aState ) override
    {
        RenderBackground( dc, aRect );
        aRect.Deflate( 1 );
        RenderText( m_text, 0, aRect, dc, aState );
        return true;
    }

private:
    wxString m_text;
};

class App : public wxApp
{
public:
    bool OnInit() override
    {
        wxFrame* frame = new wxFrame( nullptr, wxID_ANY, wxT( "libtree selection" ),
                                      wxDefaultPosition, wxSize( 420, 380 ) );

        wxPanel*    panel = new wxPanel( frame, wxID_ANY );
        wxBoxSizer* sizer = new wxBoxSizer( wxVERTICAL );

        // LIB_TREE: `new WX_DATAVIEWCTRL( this, wxID_ANY, ..., wxDV_MULTIPLE )`
        // for the Symbol Editor's tree (SEARCH | MULTISELECT).
        wxDataViewListCtrl* dv = new wxDataViewListCtrl( panel, wxID_ANY, wxDefaultPosition,
                                                         wxDefaultSize, wxDV_MULTIPLE );
        // `doAddColumn` (common/lib_tree_model_adapter.cpp:477-499): a
        // wxDataViewColumn over a LIB_TREE_RENDERER, at the adapter's own
        // default widths - Item 300, Description 600 (:158-160).
        dv->AppendColumn( new wxDataViewColumn( wxT( "Item" ), new LibTreeRenderer(), 0, 300,
                                                wxALIGN_NOT,
                                                wxDATAVIEW_CELL_INERT
                                                        | (int) wxDATAVIEW_COL_RESIZABLE ),
                          "string" );
        dv->AppendColumn( new wxDataViewColumn( wxT( "Description" ), new LibTreeRenderer(), 1, 600,
                                                wxALIGN_NOT,
                                                wxDATAVIEW_CELL_INERT
                                                        | (int) wxDATAVIEW_COL_RESIZABLE ),
                          "string" );

        for( int i = 0; i < 10; ++i )
        {
            wxVector<wxVariant> row;
            row.push_back( wxString::Format( wxT( "Amplifier_Audio_%d" ), i ) );
            row.push_back( wxT( "a description" ) );
            dv->AppendItem( row );
        }

        sizer->Add( dv, 1, wxEXPAND, 5 );
        panel->SetSizer( sizer );

        // LIB_TREE's own override, verbatim.
        int rowHeight = frame->FromDIP( 6 ) + dv->GetTextExtent( wxS( "pdI" ) ).y;
        dv->SetRowHeight( rowHeight );

        frame->Show();
        pump();

        dv->SelectRow( 3 );
        dv->SetFocus();
        gtk_window_present( GTK_WINDOW( gtk_widget_get_toplevel( (GtkWidget*) frame->GetHandle() ) ) );
        pump();

        printf( "LIB_TREE::SetRowHeight( FromDIP(6) + GetTextExtent(\"pdI\").y )\n" );
        printf( "  FromDIP(6) = %d   GetTextExtent(\"pdI\").y = %d   rowHeight = %d\n",
                frame->FromDIP( 6 ), dv->GetTextExtent( wxS( "pdI" ) ).y, rowHeight );
        printf( "  wxSYS_COLOUR_HIGHLIGHT      %s\n",
                (const char*) wxSystemSettings::GetColour( wxSYS_COLOUR_HIGHLIGHT )
                        .GetAsString( wxC2S_HTML_SYNTAX )
                        .mb_str() );
        printf( "  wxSYS_COLOUR_HIGHLIGHTTEXT  %s\n",
                (const char*) wxSystemSettings::GetColour( wxSYS_COLOUR_HIGHLIGHTTEXT )
                        .GetAsString( wxC2S_HTML_SYNTAX )
                        .mb_str() );

        // The row geometry GTK will actually use, asked of the realized
        // GtkTreeView after the event loop has settled - not of a formula, and
        // not before the widget has been laid out.
        {
            std::vector<GtkWidget*> ws;
            collect( (GtkWidget*) dv->GetHandle(), ws );

            for( GtkWidget* w : ws )
            {
                if( !GTK_IS_TREE_VIEW( w ) )
                    continue;

                gint sep = 0;
                gtk_widget_style_get( w, "vertical-separator", &sep, NULL );
                printf( "  GtkTreeView vertical-separator = %d\n", sep );

                for( int r = 0; r < 4; ++r )
                {
                    GtkTreePath* path = gtk_tree_path_new_from_indices( r, -1 );
                    GdkRectangle bg;
                    GdkRectangle cell;
                    gtk_tree_view_get_background_area( GTK_TREE_VIEW( w ), path, NULL, &bg );
                    gtk_tree_view_get_cell_area( GTK_TREE_VIEW( w ), path, NULL, &cell );
                    printf( "  row %d background_area y=%d h=%d   cell_area y=%d h=%d\n", r, bg.y,
                            bg.height, cell.y, cell.height );
                    gtk_tree_path_free( path );
                }
            }
        }

        printf( "\nGtkStyleContext of wx's own GtkTreeView\n" );
        GtkStyleContext* ctx = gtk_widget_get_style_context( (GtkWidget*) dv->GetHandle() );
        styleColour( ctx, GTK_STATE_FLAG_NORMAL, "treeview NORMAL" );
        styleColour( ctx, GTK_STATE_FLAG_SELECTED, "treeview SELECTED (focused)" );
        styleColour( ctx, (GtkStateFlags) ( GTK_STATE_FLAG_SELECTED | GTK_STATE_FLAG_BACKDROP ),
                     "treeview SELECTED+BACKDROP" );

        snapshot( frame );

        int ox, oy, w, h;
        widgetOrigin( dv, ox, oy, w, h );
        printf( "\nThe dataview is %dx%d at %d,%d in the toplevel\n", w, h, ox, oy );

        // A vertical cut down the middle of the control: every colour change,
        // so the header, the row pitch and the selected band all show up.
        printf( "\nVertical cut at the control's mid-x (%d), y in CONTROL coordinates\n", w / 2 );
        {
            unsigned char prev[4] = { 0, 0, 0, 0 };
            bool          have = false;

            for( int y = 0; y < h; ++y )
            {
                unsigned char c[4];

                if( !shotPixel( ox + w / 2, oy + y, c ) )
                    continue;

                if( !have || c[0] != prev[0] || c[1] != prev[1] || c[2] != prev[2] )
                    printf( "    y=%-4d #%02x%02x%02x\n", y, c[0], c[1], c[2] );

                prev[0] = c[0]; prev[1] = c[1]; prev[2] = c[2];
                have = true;
            }
        }

        // The selected band. It is found by its own colour rather than by
        // "differs from the face", because the row's TEXT also differs from the
        // face and a naive scan latches onto the first glyph it meets.
        {
            unsigned char hi[4] = { 0xe9, 0x54, 0x20, 0xff };
            wxColour      sys = wxSystemSettings::GetColour( wxSYS_COLOUR_HIGHLIGHT );
            hi[0] = sys.Red(); hi[1] = sys.Green(); hi[2] = sys.Blue();

            auto isHi = []( const unsigned char c[4], const unsigned char h[4] )
            {
                return abs( (int) c[0] - h[0] ) < 8 && abs( (int) c[1] - h[1] ) < 8
                       && abs( (int) c[2] - h[2] ) < 8;
            };

            int bandTop = -1, bandBot = -1;

            for( int y = 0; y < h; ++y )
            {
                unsigned char c[4];

                if( !shotPixel( ox + w - 6, oy + y, c ) )
                    continue;

                if( isHi( c, hi ) )
                {
                    if( bandTop < 0 )
                        bandTop = y;

                    bandBot = y;
                }
            }

            printf( "\nSelected row, painted\n" );
            printf( "  band y=%d..%d  =>  %d px tall (background_area is 26)\n", bandTop, bandBot,
                    bandBot - bandTop + 1 );

            if( bandTop >= 0 )
            {
                int mid = ( bandTop + bandBot ) / 2;
                int firstHi = -1, lastHi = -1;

                for( int x = 0; x < w; ++x )
                {
                    unsigned char c[4];

                    if( !shotPixel( ox + x, oy + mid, c ) )
                        continue;

                    if( isHi( c, hi ) )
                    {
                        if( firstHi < 0 )
                            firstHi = x;

                        lastHi = x;
                    }
                }

                printf( "  at y=%d the highlight spans x=%d..%d of a %d px wide control\n", mid,
                        firstHi, lastHi, w );

                printf( "  the band's own corners (a radius leaves them unpainted):\n" );

                for( int dy = 0; dy < 3; ++dy )
                {
                    printf( "    y=%d: ", bandTop + dy );

                    for( int dx = 0; dx < 4; ++dx )
                    {
                        unsigned char c[4];
                        shotPixel( ox + firstHi + dx, oy + bandTop + dy, c );
                        printf( " x+%d #%02x%02x%02x", dx, c[0], c[1], c[2] );
                    }

                    printf( "\n" );
                }

                printf( "  the row ABOVE the band, at its own mid-y: " );
                {
                    unsigned char c[4];
                    shotPixel( ox + w - 6, oy + bandTop - 13, c );
                    printf( "#%02x%02x%02x\n", c[0], c[1], c[2] );
                }
            }
        }

        fflush( stdout );
        frame->Destroy();
        return false;
    }
};

wxIMPLEMENT_APP_CONSOLE( App );

// The Choose Symbol dialog's shell: which colour every region is PAINTED, how
// wide a dialog unit is, and what the search control's two icons actually are.
//
// PANEL_SYMBOL_CHOOSER (eeschema/widgets/panel_symbol_chooser.cpp) declares no
// colour at all. It builds a wxPanel holding a wxSplitterWindow pair; the left
// pane is a LIB_TREE (a wxPanel with a wxSearchCtrl and a wxDataViewCtrl), the
// bottom pane an HTML_WINDOW. Every face in it is whatever GTK paints for those
// widgets, so the only way to get the numbers is to build them and look.
//
// This deliberately reads the RENDERED pixel rather than wxSYS_COLOUR_*: wx maps
// GTK onto its enum with logic of its own, and the two disagree here. It also
// reports GetBackgroundColour() beside it so the disagreement is visible.
//
// Build (see README.md - env -i is mandatory, XAUTHORITY is the mutter one):
//   g++ -Wno-deprecated-declarations -o chooser_shell_probe chooser_shell_probe.cpp \
//       $(wx-config --cxxflags --libs core,base,html) $(pkg-config --cflags --libs gtk+-3.0)
#include <wx/wx.h>
#include <wx/dataview.h>
#include <wx/headerctrl.h>
#include <wx/html/htmlwin.h>
#include <wx/settings.h>
#include <wx/splitter.h>
#include <wx/srchctrl.h>
#include <wx/statline.h>
#include <gtk/gtk.h>
#include <cstdio>

static void pump()
{
    for( int i = 0; i < 400; ++i )
    {
        while( gtk_events_pending() )
            gtk_main_iteration();
    }
}

// The whole dialog, captured once into an image surface. A wxPanel on GTK3 draws
// NOTHING of its own - the face comes from the toplevel's style - so rendering
// each widget on its own reports a transparent pixel and misses the very colour
// we are after. The toplevel has to be the thing captured.
static cairo_surface_t* g_shot = nullptr;
static GtkWidget*       g_top = nullptr;

// aFromServer reads the mapped window back out of the display server, which is
// exactly what a screenshot captures; the alternative replays the draw handlers
// into a fresh surface. On this machine the two agree pixel for pixel, and both
// are here so that can be re-checked rather than assumed.
static void snapshot( wxWindow* dlg, bool aFromServer )
{
    g_top = gtk_widget_get_toplevel( (GtkWidget*) dlg->GetHandle() );
    GtkAllocation a;
    gtk_widget_get_allocation( g_top, &a );

    if( aFromServer )
    {
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
        return;
    }

    g_shot = cairo_image_surface_create( CAIRO_FORMAT_ARGB32, a.width, a.height );
    cairo_t* cr = cairo_create( g_shot );
    gtk_widget_draw( g_top, cr );
    cairo_destroy( cr );
    cairo_surface_flush( g_shot );
    printf( "  (toplevel rendered offscreen %dx%d)\n", a.width, a.height );
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

// Sample a point inside aWin, offset (px,py) from its top-left, out of the
// toplevel's rendering.
static void rendered( const char* label, wxWindow* win, int px, int py )
{
    GtkWidget* w = (GtkWidget*) win->GetHandle();
    GtkAllocation a;
    gtk_widget_get_allocation( w, &a );

    int ox = 0, oy = 0;
    gtk_widget_translate_coordinates( w, g_top, 0, 0, &ox, &oy );

    if( px < 0 ) px = a.width / 2;
    if( py < 0 ) py = a.height / 2;

    unsigned char c[4] = { 0, 0, 0, 0 };
    bool          ok = shotPixel( ox + px, oy + py, c );
    wxColour      reported = win->GetBackgroundColour();

    printf( "  %-26s at %4d,%4d %4dx%-4d  painted #%02x%02x%02x a=%02x%s   "
            "GetBackgroundColour %s\n",
            label, ox, oy, a.width, a.height, c[0], c[1], c[2], c[3], ok ? "" : " (OFF)",
            reported.IsOk() ? (const char*) reported.GetAsString( wxC2S_HTML_SYNTAX ).mb_str()
                            : "(unset)" );
}

// A run-length scan of one row of the rendering, the same view of the dialog
// that a screenshot gives.
static void scanRow( int y, int x0, int x1 )
{
    printf( "  y=%-4d ", y );
    unsigned char prev[4] = { 0, 0, 0, 0 };
    int           start = x0;
    bool          have = false;
    int           printed = 0;

    for( int x = x0; x <= x1; ++x )
    {
        unsigned char c[4];

        if( !shotPixel( x, y, c ) )
            break;

        if( !have )
        {
            memcpy( prev, c, 4 );
            have = true;
            start = x;
            continue;
        }

        if( memcmp( prev, c, 4 ) != 0 )
        {
            if( x - start >= 4 && printed < 12 )
            {
                printf( "%d-%d:#%02x%02x%02x  ", start, x - 1, prev[0], prev[1], prev[2] );
                printed++;
            }

            memcpy( prev, c, 4 );
            start = x;
        }
    }

    if( printed < 12 )
        printf( "%d-%d:#%02x%02x%02x", start, x1, prev[0], prev[1], prev[2] );

    printf( "\n" );
}


// The brightest pixel in a rectangle. Symbolic icons and antialiased text are
// drawn in ONE colour at varying coverage, so the strongest pixel in the glyph
// is that colour.
static void brightestIn( const char* label, int x0, int y0, int w, int h )
{
    unsigned char best[4] = { 0, 0, 0, 0 };
    int           bestLum = -1;

    for( int y = y0; y < y0 + h; ++y )
    {
        for( int x = x0; x < x0 + w; ++x )
        {
            unsigned char c[4];

            if( !shotPixel( x, y, c ) )
                continue;

            int lum = c[0] + c[1] + c[2];

            if( lum > bestLum )
            {
                bestLum = lum;
                memcpy( best, c, 4 );
            }
        }
    }

    printf( "  %-30s #%02x%02x%02x\n", label, best[0], best[1], best[2] );
}

class Probe : public wxApp
{
public:
    bool OnInit() override
    {
        // A real top-level dialog, the way DIALOG_SYMBOL_CHOOSER is one.
        wxDialog* dlg = new wxDialog( nullptr, wxID_ANY, wxS( "Choose Symbol" ), wxDefaultPosition,
                                      wxSize( 900, 700 ),
                                      wxDEFAULT_DIALOG_STYLE | wxRESIZE_BORDER );

        wxPanel*    body = new wxPanel( dlg );
        wxBoxSizer* bodySizer = new wxBoxSizer( wxVERTICAL );
        body->SetSizer( bodySizer );

        // PANEL_SYMBOL_CHOOSER's splitter pair, with its exact styles.
        wxSplitterWindow* vsplit =
                new wxSplitterWindow( body, wxID_ANY, wxDefaultPosition, wxDefaultSize,
                                      wxSP_LIVE_UPDATE | wxSP_NOBORDER | wxSP_3DSASH );
        wxSplitterWindow* hsplit =
                new wxSplitterWindow( vsplit, wxID_ANY, wxDefaultPosition, wxDefaultSize,
                                      wxSP_LIVE_UPDATE | wxSP_NOBORDER | wxSP_3DSASH );

        // Bottom pane: a wxPanel holding the HTML_WINDOW, exactly as upstream.
        wxPanel*      detailsPanel = new wxPanel( vsplit );
        wxBoxSizer*   detailsSizer = new wxBoxSizer( wxVERTICAL );
        wxHtmlWindow* details = new wxHtmlWindow( detailsPanel, wxID_ANY );
        detailsSizer->Add( details, 1, wxEXPAND | wxLEFT | wxRIGHT | wxBOTTOM, 5 );
        detailsPanel->SetSizer( detailsSizer );

        // Left pane: the tree panel, holding a LIB_TREE-shaped wxPanel.
        wxPanel*    treePanel = new wxPanel( hsplit );
        wxBoxSizer* treeSizer = new wxBoxSizer( wxVERTICAL );

        // LIB_TREE itself: wxWANTS_CHARS | wxTAB_TRAVERSAL | wxNO_BORDER.
        wxPanel* libTree = new wxPanel( treePanel, wxID_ANY, wxDefaultPosition, wxDefaultSize,
                                        wxWANTS_CHARS | wxTAB_TRAVERSAL | wxNO_BORDER );
        wxBoxSizer* libSizer = new wxBoxSizer( wxVERTICAL );
        wxBoxSizer* searchSizer = new wxBoxSizer( wxHORIZONTAL );

        wxSearchCtrl* query = new wxSearchCtrl( libTree, wxID_ANY );
        query->ShowCancelButton( true );
        // The cancel icon only exists while there is something to cancel.
        query->SetValue( wxS( "terminal" ) );
        searchSizer->Add( query, 1, wxALIGN_CENTER_VERTICAL | wxRIGHT, 4 );

        wxStaticLine* sep = new wxStaticLine( libTree, wxID_ANY, wxDefaultPosition, wxDefaultSize,
                                              wxLI_VERTICAL );
        searchSizer->Add( sep, 0, wxEXPAND | wxTOP | wxBOTTOM, 3 );

        wxButton* sortBtn = new wxButton( libTree, wxID_ANY, wxS( "" ), wxDefaultPosition,
                                          wxSize( 24, 24 ), wxBU_AUTODRAW );
        searchSizer->Add( sortBtn, 0, wxALIGN_CENTER_VERTICAL, 5 );
        libSizer->Add( searchSizer, 0, wxEXPAND, 5 );

        wxDataViewListCtrl* tree = new wxDataViewListCtrl( libTree, wxID_ANY, wxDefaultPosition,
                                                           wxDefaultSize, wxDV_SINGLE );
        tree->AppendTextColumn( wxS( "Item" ) );
        tree->AppendTextColumn( wxS( "Description" ) );

        for( int i = 0; i < 8; ++i )
        {
            wxVector<wxVariant> row;
            row.push_back( wxVariant( wxString::Format( "Screw_Terminal_01x%02d", i + 1 ) ) );
            row.push_back( wxVariant( wxS( "Generic screw terminal" ) ) );
            tree->AppendItem( row );
        }

        libSizer->Add( tree, 1, wxEXPAND, 5 );
        libTree->SetSizer( libSizer );

        treeSizer->Add( libTree, 1, wxALL | wxEXPAND, 5 );
        treePanel->SetSizer( treeSizer );

        // Right pane: constructRightPanel's plain wxPanel.
        wxPanel* rightPanel = new wxPanel( hsplit );

        hsplit->SetSashGravity( 0.8 );
        hsplit->SetMinimumPaneSize( 20 );
        hsplit->SplitVertically( treePanel, rightPanel );

        vsplit->SetSashGravity( 0.5 );
        vsplit->SetMinimumPaneSize( 20 );
        vsplit->SplitHorizontally( hsplit, detailsPanel );

        bodySizer->Add( vsplit, 1, wxEXPAND | wxBOTTOM, 5 );

        // The footer, as DIALOG_SYMBOL_CHOOSER builds it.
        wxBoxSizer* footer = new wxBoxSizer( wxHORIZONTAL );
        wxCheckBox* cb = new wxCheckBox( body, wxID_ANY, wxS( "Place all units" ) );
        footer->Add( cb, 0, wxALIGN_CENTER_VERTICAL | wxALL, 5 );
        footer->AddStretchSpacer();
        wxButton* cancel = new wxButton( body, wxID_CANCEL );
        wxButton* ok = new wxButton( body, wxID_OK );
        footer->Add( cancel, 0, wxALL, 5 );
        footer->Add( ok, 0, wxALL, 5 );
        bodySizer->Add( footer, 0, wxEXPAND );

        dlg->Show();
        dlg->Layout();
        dlg->Raise();
        gtk_window_present( GTK_WINDOW( gtk_widget_get_toplevel( (GtkWidget*) dlg->GetHandle() ) ) );
        pump();

        printf( "== dialog units (wxWindow::ConvertDialogToPixels on this machine)\n" );
        printf( "  char width %d, char height %d, font %s\n", dlg->GetCharWidth(),
                dlg->GetCharHeight(),
                (const char*) dlg->GetFont().GetNativeFontInfoUserDesc().mb_str() );

        for( int du : { 220, 230, 340, 440 } )
        {
            printf( "  horizPixelsFromDU(%3d) = %d\n", du,
                    dlg->ConvertDialogToPixels( wxSize( du, 0 ) ).x );
        }

        printf( "  FromDIP(100) = %d  (DIP scale %g)\n", dlg->FromDIP( 100 ),
                dlg->GetDPIScaleFactor() );

        printf( "\n== splitter\n" );
        printf( "  wxSplitterWindow::GetSashSize()  = %d\n", hsplit->GetSashSize() );
        printf( "  wxSplitterWindow::GetBorderSize()= %d\n", hsplit->GetBorderSize() );

        printf( "\n== HTML_WINDOW::SetPage's three colours (html_window.cpp:56-66)\n" );

        for( auto [n, id] : { std::pair<const char*, wxSystemColour>{ "WINDOWTEXT (body text)", wxSYS_COLOUR_WINDOWTEXT },
                              { "WINDOW (bgcolor)", wxSYS_COLOUR_WINDOW },
                              { "HOTLIGHT (link)", wxSYS_COLOUR_HOTLIGHT } } )
        {
            printf( "  %-24s %s\n", n,
                    (const char*) wxSystemSettings::GetColour( id )
                            .GetAsString( wxC2S_HTML_SYNTAX ).mb_str() );
        }

        printf( "\n== what each region PAINTS (read back from the display server)\n" );
        snapshot( dlg, true );
        rendered( "wxDialog", dlg, 40, 40 );
        rendered( "body wxPanel", body, 40, 40 );
        rendered( "treePanel (splitter pane)", treePanel, 2, 2 );
        rendered( "LIB_TREE wxPanel", libTree, 2, 2 );
        rendered( "wxSearchCtrl", query, -1, -1 );
        rendered( "wxDataViewCtrl", tree, -1, -1 );
        rendered( "detailsPanel", detailsPanel, 2, 2 );
        rendered( "HTML_WINDOW", details, -1, -1 );
        rendered( "rightPanel", rightPanel, 40, 40 );
        rendered( "hsplitter (sash strip)", hsplit, -1, 4 );
        rendered( "wxButton (OK)", ok, -1, -1 );
        rendered( "wxCheckBox", cb, -1, -1 );
        rendered( "wxStaticLine (vertical)", sep, 0, -1 );
        rendered( "wxStaticLine col 1", sep, 1, -1 );

        // A window that is not the focused one is drawn in GTK's :backdrop
        // state, and Yaru's backdrop faces are DARKER than its normal ones. A
        // probe window that never took the focus therefore reports the wrong
        // half of the theme; the chooser the user is looking at is the focused
        // window, so both are printed here and the normal one is the one to
        // port.
        printf( "\n== normal vs :backdrop (window active = %d)\n",
                gtk_window_is_active( GTK_WINDOW( g_top ) ) );

        auto styleBg = [&]( const char* label, wxWindow* win )
        {
            GtkStyleContext* ctx = gtk_widget_get_style_context( (GtkWidget*) win->GetHandle() );
            GdkRGBA          n, b;
            gtk_style_context_get_background_color( ctx, GTK_STATE_FLAG_NORMAL, &n );
            gtk_style_context_get_background_color( ctx, GTK_STATE_FLAG_BACKDROP, &b );
            printf( "  %-26s normal #%02x%02x%02x (a %.2f)   backdrop #%02x%02x%02x (a %.2f)\n",
                    label, (int) ( n.red * 255 + .5 ), (int) ( n.green * 255 + .5 ),
                    (int) ( n.blue * 255 + .5 ), n.alpha, (int) ( b.red * 255 + .5 ),
                    (int) ( b.green * 255 + .5 ), (int) ( b.blue * 255 + .5 ), b.alpha );
        };

        styleBg( "wxDialog (toplevel)", dlg );
        styleBg( "body wxPanel", body );
        styleBg( "wxSearchCtrl", query );
        styleBg( "wxDataViewCtrl", tree );
        styleBg( "wxButton (OK)", ok );

        printf( "\n== run-length scan of the rendering (region boundaries)\n" );
        {
            GtkAllocation a;
            gtk_widget_get_allocation( g_top, &a );

            for( int y : { 4, 20, 60, 200, 340, 355, 420, 660, 690 } )
                scanRow( y, 0, a.width - 1 );
        }

        printf( "\n== the wxDataViewCtrl's column header\n" );
        {
            // The header is a real GtkButton inside the treeview; find where it
            // lands in the toplevel and scan the column through it.
            int ox = 0, oy = 0;
            gtk_widget_translate_coordinates( (GtkWidget*) tree->GetHandle(), g_top, 0, 0, &ox, &oy );
            printf( "  tree at %d,%d\n", ox, oy );

            unsigned char prev[4] = { 0, 0, 0, 0 };
            int           start = -1;

            for( int y = oy; y < oy + 60; ++y )
            {
                unsigned char c[4];

                if( !shotPixel( ox + 200, y, c ) )
                    break;

                if( start < 0 || memcmp( prev, c, 4 ) != 0 )
                {
                    if( start >= 0 )
                        printf( "    y %d-%d  #%02x%02x%02x\n", start, y - 1, prev[0], prev[1], prev[2] );

                    memcpy( prev, c, 4 );
                    start = y;
                }
            }

            printf( "    y %d-..  #%02x%02x%02x\n", start, prev[0], prev[1], prev[2] );
        }

        printf( "\n== a cross-section down the wxSearchCtrl (its frame and interior)\n" );
        {
            int ox = 0, oy = 0;
            gtk_widget_translate_coordinates( (GtkWidget*) query->GetHandle(), g_top, 0, 0, &ox, &oy );
            unsigned char prev[4] = { 0, 0, 0, 0 };
            int           start2 = -1;

            for( int y = oy - 2; y < oy + 40; ++y )
            {
                unsigned char c[4];

                if( !shotPixel( ox + 200, y, c ) )
                    break;

                if( start2 < 0 || memcmp( prev, c, 4 ) != 0 )
                {
                    if( start2 >= 0 )
                        printf( "    y %d-%d  #%02x%02x%02x\n", start2, y - 1, prev[0], prev[1], prev[2] );

                    memcpy( prev, c, 4 );
                    start2 = y;
                }
            }

            printf( "    y %d-..  #%02x%02x%02x\n", start2, prev[0], prev[1], prev[2] );
        }

        printf( "\n== the colour text and symbolic icons are drawn in\n" );
        {
            int qx = 0, qy = 0;
            gtk_widget_translate_coordinates( (GtkWidget*) query->GetHandle(), g_top, 0, 0, &qx, &qy );
            brightestIn( "edit-find-symbolic", qx + 9, qy + 9, 16, 16 );
            brightestIn( "edit-clear-symbolic", qx + 385, qy + 9, 16, 16 );
            brightestIn( "entry text", qx + 30, qy + 8, 120, 18 );

            int tx = 0, ty = 0;
            gtk_widget_translate_coordinates( (GtkWidget*) tree->GetHandle(), g_top, 0, 0, &tx, &ty );
            brightestIn( "column header text", tx + 4, ty + 4, 120, 20 );
            brightestIn( "tree row text", tx + 4, ty + 30, 200, 20 );
        }

        printf( "\n== the search control's icons (GtkEntry icon slots)\n" );
        GtkWidget* entry = (GtkWidget*) query->GetHandle();

        // wxSearchCtrl on wxGTK3 IS a GtkEntry (or wraps one); find it.
        if( !GTK_IS_ENTRY( entry ) )
        {
            GList* kids = GTK_IS_CONTAINER( entry ) ? gtk_container_get_children( GTK_CONTAINER( entry ) ) : nullptr;

            for( GList* l = kids; l; l = l->next )
            {
                if( GTK_IS_ENTRY( l->data ) )
                    entry = GTK_WIDGET( l->data );
            }
        }

        printf( "  wx widget type          %s\n", G_OBJECT_TYPE_NAME( query->GetHandle() ) );
        printf( "  entry widget type       %s\n", G_OBJECT_TYPE_NAME( entry ) );

        if( GTK_IS_ENTRY( entry ) )
        {
            for( int pos = 0; pos < 2; ++pos )
            {
                GtkEntryIconPosition ip = pos == 0 ? GTK_ENTRY_ICON_PRIMARY : GTK_ENTRY_ICON_SECONDARY;
                const gchar*         name = gtk_entry_get_icon_name( GTK_ENTRY( entry ), ip );
                GIcon*               gicon = gtk_entry_get_icon_gicon( GTK_ENTRY( entry ), ip );
                gchar*               gname = gicon ? g_icon_to_string( gicon ) : nullptr;
                GdkRectangle         area;
                gtk_entry_get_icon_area( GTK_ENTRY( entry ), ip, &area );
                printf( "  %-9s icon name %-22s gicon %-24s area %d,%d %dx%d\n",
                        pos == 0 ? "primary" : "secondary", name ? name : "(none)",
                        gname ? gname : "(none)", area.x, area.y, area.width, area.height );
                g_free( gname );

                if( GdkPixbuf* pb = gtk_entry_get_icon_pixbuf( GTK_ENTRY( entry ), ip ) )
                    printf( "            pixbuf %dx%d\n", gdk_pixbuf_get_width( pb ),
                            gdk_pixbuf_get_height( pb ) );
            }

            GtkAllocation ea;
            gtk_widget_get_allocation( entry, &ea );
            printf( "  entry allocation        %dx%d\n", ea.width, ea.height );
        }
        else
        {
            printf( "  (not a GtkEntry - wxSearchCtrl is generic here)\n" );
        }

        printf( "  wxSearchCtrl best size  %dx%d\n", query->GetBestSize().x, query->GetBestSize().y );
        printf( "  GTK icon theme          %s\n",
                (const char*) wxString::FromUTF8( g_getenv( "GTK_THEME" ) ? g_getenv( "GTK_THEME" ) : "" ).mb_str() );

        {
            gchar* iconTheme = nullptr;
            g_object_get( gtk_settings_get_default(), "gtk-icon-theme-name", &iconTheme, nullptr );
            printf( "  gtk-icon-theme-name     %s\n", iconTheme ? iconTheme : "(none)" );
            g_free( iconTheme );
        }

        // Now take the focus away and read the SAME window again. Anything that
        // moves between the two readings is a :backdrop rule, and a screenshot
        // taken with the shell's own capture UI catches every window in that
        // state - which is why a screenshot cannot settle a face colour.
        {
            wxFrame* thief = new wxFrame( nullptr, wxID_ANY, wxS( "focus thief" ),
                                          wxPoint( 0, 0 ), wxSize( 120, 80 ) );
            thief->Show();
            thief->Raise();
            gtk_window_present( GTK_WINDOW( gtk_widget_get_toplevel( (GtkWidget*) thief->GetHandle() ) ) );
            pump();

            printf( "\n== the same dialog, now in :backdrop (active = %d)\n",
                    gtk_window_is_active( GTK_WINDOW( g_top ) ) );
            cairo_surface_destroy( g_shot );
            g_shot = nullptr;
            snapshot( dlg, true );
            rendered( "treePanel (dialog face)", treePanel, 2, 2 );
            rendered( "wxSearchCtrl", query, -1, -1 );
            rendered( "wxDataViewCtrl", tree, -1, -1 );
            rendered( "hsplitter (sash strip)", hsplit, -1, 4 );

            GtkAllocation a;
            gtk_widget_get_allocation( g_top, &a );

            for( int y : { 60, 200, 690 } )
                scanRow( y, 0, a.width - 1 );

            thief->Destroy();
        }


        printf( "\n[done]\n" );
        fflush( stdout );
        dlg->Destroy();
        return false;
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

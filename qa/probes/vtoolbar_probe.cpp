// How wide is a KiCad vertical ACTION_TOOLBAR, and where do its buttons sit?
//
// A vertical toolbar is `wxAuiToolBar` with `wxAUI_TB_VERTICAL`, docked with
// `EDA_PANE().VToolbar()` — no gripper, no pane border (eda_base_frame.h:924).
// Its width is not a number KiCad writes: wxAuiToolBar::RealizeHelper adds
// m_toolBorderPadding around each tool and then the LEFT/RIGHT margins, and
// `ACTION_TOOLBAR`'s only say in it is the icon size that
// `WX_AUI_TOOLBAR_ART::GetToolSize` returns — `toolbar_icon_size`, 24 by
// default (wx_aui_art_providers.cpp:43-46, common_settings.cpp:115).
//
// So: build the same widget and ask it. Reported are the toolbar's own size,
// the item rects inside it, and the four padding/packing values wx picked in
// Create(), which KiCad re-applies verbatim on a DPI change
// (action_toolbar.cpp:242-247) and therefore treats as the defaults.
#include <wx/wx.h>
#include <wx/aui/aui.h>
#include <wx/aui/auibar.h>
#include <cstdio>

static wxBitmap solid( int size, const wxColour& c )
{
    wxBitmap bmp( size, size );
    wxMemoryDC dc( bmp );
    dc.SetBackground( wxBrush( c ) );
    dc.Clear();
    dc.SelectObject( wxNullBitmap );
    return bmp;
}

static void dump( const char* label, wxAuiToolBar* tb )
{
    printf( "%s\n", label );
    printf( "  GetSize       %d x %d\n", tb->GetSize().x, tb->GetSize().y );
    printf( "  GetBestSize   %d x %d\n", tb->GetBestSize().x, tb->GetBestSize().y );
    printf( "  GetHintSize(wxLEFT)   %d x %d\n",
            tb->GetHintSize( wxAUI_DOCK_LEFT ).x, tb->GetHintSize( wxAUI_DOCK_LEFT ).y );
    printf( "  GetHintSize(wxTOP)    %d x %d\n",
            tb->GetHintSize( wxAUI_DOCK_TOP ).x, tb->GetHintSize( wxAUI_DOCK_TOP ).y );
    printf( "  ToolPacking %d  ToolBorderPadding %d\n",
            tb->GetToolPacking(), tb->GetToolBorderPadding() );

    for( size_t i = 0; i < tb->GetToolCount(); ++i )
    {
        wxAuiToolBarItem* it = tb->FindToolByIndex( (int) i );

        if( !it )
            continue;

        wxRect r = tb->GetToolRect( it->GetId() );
        printf( "  item %zu  kind %d  rect  x %3d  y %3d  w %2d  h %2d\n",
                i, it->GetKind(), r.x, r.y, r.width, r.height );
    }
    printf( "\n" );
}

class Probe : public wxApp
{
public:
    bool OnInit() override
    {
        wxFrame* frame = new wxFrame( nullptr, wxID_ANY, "vtoolbar probe",
                                      wxDefaultPosition, wxSize( 900, 700 ) );
        wxAuiManager* mgr = new wxAuiManager( frame );

        const int  iconSize = 24; // common_settings.cpp:115, appearance.toolbar_icon_size
        wxBitmap   bmp = solid( iconSize, *wxRED );

        auto build = [&]( long style ) -> wxAuiToolBar*
        {
            wxAuiToolBar* tb = new wxAuiToolBar( frame, wxID_ANY, wxDefaultPosition,
                                                 wxDefaultSize, style );
            for( int i = 0; i < 4; ++i )
                tb->AddTool( wxID_HIGHEST + 100 * ( style & 1 ) + i, wxEmptyString, bmp,
                             wxEmptyString, wxITEM_CHECK );
            tb->AddSeparator();
            for( int i = 4; i < 7; ++i )
                tb->AddTool( wxID_HIGHEST + 100 * ( style & 1 ) + i, wxEmptyString, bmp,
                             wxEmptyString, wxITEM_CHECK );
            tb->Realize();
            return tb;
        };

        // pcb_edit_frame.cpp: m_drawToolBar is created with wxAUI_TB_DEFAULT_STYLE
        // | wxAUI_TB_VERTICAL, then docked with EDA_PANE().VToolbar().
        wxAuiToolBar* vert = build( wxAUI_TB_DEFAULT_STYLE | wxAUI_TB_VERTICAL );
        wxAuiToolBar* horz = build( wxAUI_TB_DEFAULT_STYLE | wxAUI_TB_HORZ_LAYOUT );

        wxPanel* canvas = new wxPanel( frame );
        canvas->SetBackgroundColour( wxColour( 0, 16, 35 ) );

        // The Properties pane, as pcb_edit_frame.cpp:382-387 docks it: Left,
        // Layer 5 — OUTSIDE the toolbar's Layer 3 — resizable, no pane border.
        wxPanel* props = new wxPanel( frame );
        props->SetBackgroundColour( wxColour( 39, 39, 39 ) );

        mgr->AddPane( horz, EDA_HTOOLBAR().Top().Layer( 6 ) );
        mgr->AddPane( vert, EDA_VTOOLBAR().Left().Layer( 3 ) );
        mgr->AddPane( props, wxAuiPaneInfo().Left().Layer( 5 ).Caption( "Properties" )
                            .PaneBorder( false ).MinSize( 240, 60 ).BestSize( 300, 200 ) );
        mgr->AddPane( canvas, wxAuiPaneInfo().CenterPane().PaneBorder( true ) );
        mgr->Update();

        frame->Show();

        CallAfter( [=]() {
            printf( "after wxAuiManager::Update()\n\n" );
            dump( "VERTICAL (wxAUI_TB_VERTICAL, docked Left)", vert );
            dump( "HORIZONTAL (wxAUI_TB_HORZ_LAYOUT, docked Top)", horz );
            printf( "docked pane rects:\n" );
            printf( "  vertical toolbar  x %3d  y %3d  w %2d  h %3d\n",
                    vert->GetPosition().x, vert->GetPosition().y,
                    vert->GetSize().x, vert->GetSize().y );
            printf( "  properties pane   x %3d  y %3d  w %3d  h %3d\n",
                    props->GetPosition().x, props->GetPosition().y,
                    props->GetSize().x, props->GetSize().y );
            printf( "  canvas            x %3d  y %3d  w %3d  h %3d\n",
                    canvas->GetPosition().x, canvas->GetPosition().y,
                    canvas->GetSize().x, canvas->GetSize().y );
            printf( "\n  gap properties-right -> toolbar-left : %d px\n",
                    vert->GetPosition().x - ( props->GetPosition().x + props->GetSize().x ) );
            printf( "  gap toolbar-right    -> canvas-left   : %d px\n",
                    canvas->GetPosition().x - ( vert->GetPosition().x + vert->GetSize().x ) );
            wxAuiDockArt* art = mgr->GetArtProvider();
            printf( "  wxAUI_DOCKART_SASH_SIZE        %d\n",
                    art->GetMetric( wxAUI_DOCKART_SASH_SIZE ) );
            printf( "  wxAUI_DOCKART_PANE_BORDER_SIZE %d\n",
                    art->GetMetric( wxAUI_DOCKART_PANE_BORDER_SIZE ) );
            ExitMainLoop();
        } );
        return true;
    }

    // EDA_PANE, copied from include/eda_base_frame.h:924-960 so the probe docks
    // the toolbar exactly the way every KiCad frame does.
    struct EDA_HTOOLBAR : public wxAuiPaneInfo
    {
        EDA_HTOOLBAR()
        {
            Gripper( false ); CloseButton( false ); PaneBorder( false );
            SetFlag( optionToolbar, true ); CaptionVisible( false );
            TopDockable().BottomDockable(); DockFixed( true );
            Movable( false ); Resizable( true );
        }
    };

    struct EDA_VTOOLBAR : public wxAuiPaneInfo
    {
        EDA_VTOOLBAR()
        {
            Gripper( false ); CloseButton( false ); PaneBorder( false );
            SetFlag( optionToolbar, true ); CaptionVisible( false );
            LeftDockable().RightDockable(); DockFixed( true );
            Movable( false ); Resizable( true );
        }
    };
};

wxIMPLEMENT_APP( Probe );

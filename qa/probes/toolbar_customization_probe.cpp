// SPDX-License-Identifier: GPL-3.0-or-later
// The two lists on Preferences > ... > Toolbars, built the way
// PANEL_TOOLBAR_CUSTOMIZATION builds them, and asked for their own metrics.
//
//   m_toolbarTree = new UP_DOWN_TREE( ..., wxTR_DEFAULT_STYLE | wxTR_EDIT_LABELS
//                                          | wxTR_HIDE_ROOT | wxTR_NO_LINES );
//   m_actionsList = new wxListCtrl( ..., wxLC_NO_HEADER | wxLC_REPORT | wxLC_SINGLE_SEL );
//   const int c_defSize = 24;                       // panel_toolbar_customization.cpp:583
//
// Answers: the tree's indent, a row's height with a 24 px image, and the same
// for the list -- every one of which we had guessed at 16.
#include <wx/wx.h>
#include <wx/treectrl.h>
#include <wx/listctrl.h>
#include <wx/imaglist.h>
#include <wx/renderer.h>

class App : public wxApp
{
public:
    bool OnInit() override
    {
        wxFrame* f = new wxFrame( nullptr, wxID_ANY, "probe", wxDefaultPosition, wxSize( 700, 500 ) );

        wxBitmap bmp( 24, 24 );
        {
            wxMemoryDC dc( bmp );
            dc.SetBackground( *wxRED_BRUSH );
            dc.Clear();
        }
        wxImageList* imgs = new wxImageList( 24, 24 );
        imgs->Add( bmp );

        wxTreeCtrl* tree = new wxTreeCtrl( f, wxID_ANY, wxDefaultPosition, wxSize( 300, 400 ),
                                           wxTR_DEFAULT_STYLE | wxTR_EDIT_LABELS
                                                   | wxTR_HIDE_ROOT | wxTR_NO_LINES );
        tree->AssignImageList( imgs );

        wxTreeItemId root = tree->AddRoot( "Toolbar" );
        wxTreeItemId a = tree->AppendItem( root, "Show Grid", 0 );
        wxTreeItemId sep = tree->AppendItem( root, "Separator", -1 );
        wxTreeItemId grp = tree->AppendItem( root, "Units", -1 );
        wxTreeItemId kid = tree->AppendItem( grp, "Inches", 0 );
        tree->ExpandAll();

        wxListCtrl* list = new wxListCtrl( f, wxID_ANY, wxPoint( 320, 0 ), wxSize( 340, 400 ),
                                           wxLC_NO_HEADER | wxLC_REPORT | wxLC_SINGLE_SEL );
        wxImageList* limgs = new wxImageList( 24, 24 );
        limgs->Add( bmp );
        list->AssignImageList( limgs, wxIMAGE_LIST_SMALL );
        list->InsertColumn( 0, "", wxLIST_FORMAT_LEFT, wxLIST_AUTOSIZE );
        for( int i = 0; i < 4; i++ )
        {
            wxListItem it;
            it.SetId( i );
            it.SetText( wxString::Format( "Action %d", i ) );
            // Row 2 gets NO image, the way a CONTROL entry does: `populateActions`
            // sets `entry.image_index` only for a tool with a real bitmap.
            if( i != 2 )
                it.SetImage( 0 );
            list->InsertItem( it );
        }

        f->Show();
        f->Layout();
        wxYield();

        printf( "font            : %s\n", tree->GetFont().GetNativeFontInfoUserDesc().mb_str().data() );
        printf( "tree GetIndent(): %d\n", tree->GetIndent() );
        printf( "tree GetSpacing(): %d\n", tree->GetSpacing() );

        auto rect = [&]( wxTreeItemId id, const char* name )
        {
            wxRect r;
            if( tree->GetBoundingRect( id, r, false ) )
                printf( "  %-12s full  x=%d y=%d w=%d h=%d\n", name, r.x, r.y, r.width, r.height );
            if( tree->GetBoundingRect( id, r, true ) )
                printf( "  %-12s label x=%d y=%d w=%d h=%d\n", name, r.x, r.y, r.width, r.height );
        };
        rect( a, "Show Grid" );
        rect( sep, "Separator" );
        rect( grp, "Units" );
        rect( kid, "Inches" );

        wxRect lr;
        list->GetItemRect( 0, lr );
        printf( "list row 0      : x=%d y=%d w=%d h=%d\n", lr.x, lr.y, lr.width, lr.height );
        list->GetItemRect( 1, lr );
        printf( "list row 1      : x=%d y=%d w=%d h=%d\n", lr.x, lr.y, lr.width, lr.height );
        wxRect ir;
        if( list->GetSubItemRect( 0, 0, ir, wxLIST_RECT_ICON ) )
            printf( "list icon rect  : x=%d y=%d w=%d h=%d\n", ir.x, ir.y, ir.width, ir.height );
        if( list->GetSubItemRect( 0, 0, ir, wxLIST_RECT_LABEL ) )
            printf( "list label rect : x=%d y=%d w=%d h=%d\n", ir.x, ir.y, ir.width, ir.height );
        // The same for the row with no image: does the list reserve the cell?
        if( list->GetSubItemRect( 2, 0, ir, wxLIST_RECT_LABEL ) )
            printf( "list label NOIMG: x=%d y=%d w=%d h=%d\n", ir.x, ir.y, ir.width, ir.height );

        wxSize exp = wxRendererNative::Get().GetExpanderSize( tree );
        printf( "expander size   : %d x %d\n", exp.x, exp.y );

        printf( "[done]\n" );
        f->Destroy();
        return false;
    }
};
wxIMPLEMENT_APP( App );

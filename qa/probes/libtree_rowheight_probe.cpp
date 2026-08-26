// The symbol chooser tree's row height, asked of wxWidgets rather than derived.
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
// the font's full line box. Both terms depend on the theme font and the display
// scale, which is why this asks wx on this machine instead of computing it from
// a point size.
//
// The panel is built the way LIB_TREE is, a plain wxPanel with the default GUI
// font, because GetTextExtent is the *panel's* and inherits whatever GTK gives
// a dialog child.
//
//   g++ -Wno-deprecated-declarations -o libtree_rowheight_probe \
//       libtree_rowheight_probe.cpp $(wx-config --cxxflags --libs core,base)
#include <wx/wx.h>
#include <cstdio>

class Probe : public wxApp
{
public:
    bool OnInit() override
    {
        wxDialog dlg( nullptr, wxID_ANY, wxS( "Choose Symbol" ) );
        wxPanel* panel = new wxPanel( &dlg, wxID_ANY );

        const wxFont  font = panel->GetFont();
        const wxSize  ext = panel->GetTextExtent( wxS( "pdI" ) );
        const int     dip6 = panel->FromDIP( 6 );

        printf( "font.pointSize      %g\n", font.GetFractionalPointSize() );
        printf( "font.pixelSize.y    %d\n", font.GetPixelSize().y );
        printf( "font.faceName       %s\n", (const char*) font.GetFaceName().utf8_str() );
        printf( "GetTextExtent(pdI).y %d\n", ext.y );
        printf( "FromDIP(6)          %d\n", dip6 );
        printf( "ROW HEIGHT          %d\n", dip6 + ext.y );

        // The char height wx reports for the same font, for cross-checking that
        // the extent above is a line box and not a glyph box.
        printf( "GetCharHeight       %d\n", panel->GetCharHeight() );
        return false;
    }
};

wxIMPLEMENT_APP_CONSOLE( Probe );

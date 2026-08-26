// The line spacing of the chooser's details pane.
//
// LIB_TREE's DETAILS pane is an HTML_WINDOW (common/widgets/lib_tree.cpp:191),
// and its content is the template in eeschema/generate_alias_info.cpp:28-46:
// a bold name, <br>-separated description and keywords, an <hr>, then a table
// of fields. There is no font size and no CSS anywhere in it, so the spacing
// is whatever wxHtmlWindow lays out for the 11pt window font.
//
// That is not the same as the font's line box. wxHtml adds its own leading
// between <br> lines, so the number to port has to be read off a laid-out
// window rather than derived from GetCharHeight.
//
// This renders the real template and reports where each line actually lands,
// by walking the internal cell tree for the y of every line box.
//
//   g++ -Wno-deprecated-declarations -o libtree_details_probe \
//       libtree_details_probe.cpp $(wx-config --cxxflags --libs core,base,html)
#include <wx/wx.h>
#include <wx/html/htmlwin.h>
#include <wx/html/htmlcell.h>
#include <cstdio>
#include <vector>
#include <algorithm>

// The template, with the substitutions eeschema makes for a screw terminal.
static const char* PAGE =
    "<b>Screw_Terminal_01x01</b>"
    "<br>Generic screw terminal, single row, 01x01, script generated "
    "(kicad-library-utils/schlib/autogen/connector/)"
    "<br>Keywords: screw terminal"
    "<hr><table border=0>"
    "<tr><td><b>Reference</b></td><td>J</td></tr>"
    "<tr><td><b>Footprint</b></td><td></td></tr>"
    "<tr><td><b>Datasheet</b></td><td></td></tr>"
    "</table>";

static void walk( wxHtmlCell* cell, int absY, std::vector<int>& tops )
{
    for( wxHtmlCell* c = cell; c; c = c->GetNext() )
    {
        if( wxHtmlContainerCell* cont = wxDynamicCast( c, wxHtmlContainerCell ) )
        {
            walk( cont->GetFirstChild(), absY + c->GetPosY(), tops );
        }
        else if( c->GetHeight() > 0 && c->GetWidth() > 0 )
        {
            tops.push_back( absY + c->GetPosY() );
        }
    }
}

class Probe : public wxApp
{
public:
    bool OnInit() override
    {
        wxDialog* dlg = new wxDialog( nullptr, wxID_ANY, wxS( "Choose Symbol" ),
                                      wxDefaultPosition, wxSize( 700, 500 ) );
        wxHtmlWindow* html = new wxHtmlWindow( dlg, wxID_ANY, wxDefaultPosition,
                                               wxSize( 520, 300 ) );
        printf( "window font          %s %g pt, char height %d\n",
                (const char*) html->GetFont().GetFaceName().utf8_str(),
                html->GetFont().GetFractionalPointSize(), html->GetCharHeight() );

        html->SetPage( wxString::FromUTF8( PAGE ) );
        dlg->Show();
        html->Layout();
        wxYield();

        std::vector<int> tops;
        if( html->GetInternalRepresentation() )
            walk( html->GetInternalRepresentation()->GetFirstChild(), 0, tops );

        std::sort( tops.begin(), tops.end() );
        tops.erase( std::unique( tops.begin(), tops.end() ), tops.end() );

        printf( "line tops:" );
        for( int y : tops ) printf( " %d", y );
        printf( "\n" );

        for( size_t i = 1; i < tops.size(); ++i )
            printf( "  delta %zu->%zu   %d\n", i - 1, i, tops[i] - tops[i - 1] );

        dlg->Destroy();
        return false;
    }
};

wxIMPLEMENT_APP_CONSOLE( Probe );

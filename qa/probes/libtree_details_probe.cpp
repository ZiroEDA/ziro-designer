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
#include <wx/dcmemory.h>
#include <wx/settings.h>
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

struct Box { int x, y, w, h; wxString text; };

// Every word cell, in absolute window coordinates. The two <td>s of a
// FieldFormat row land on two different x values, and that gap is the column
// gap wxHtml gives a border-less table - the number the CSS has to reproduce.
static void walkBoxes( wxHtmlCell* cell, int absX, int absY, std::vector<Box>& out )
{
    for( wxHtmlCell* c = cell; c; c = c->GetNext() )
    {
        if( wxHtmlContainerCell* cont = wxDynamicCast( c, wxHtmlContainerCell ) )
        {
            walkBoxes( cont->GetFirstChild(), absX + c->GetPosX(), absY + c->GetPosY(), out );
        }
        else if( wxHtmlWordCell* word = wxDynamicCast( c, wxHtmlWordCell ) )
        {
            out.push_back( { absX + c->GetPosX(), absY + c->GetPosY(), c->GetWidth(),
                             c->GetHeight(), word->ConvertToText( nullptr ) } );
        }
        else if( c->GetHeight() > 0 )
        {
            // The <hr> is not a word cell, and its box is the only way to read
            // the space the rule takes above and below itself.
            out.push_back( { absX + c->GetPosX(), absY + c->GetPosY(), c->GetWidth(),
                             c->GetHeight(), wxString::Format( "<%s>", c->GetClassInfo()->GetClassName() ) } );
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

        // Where each word actually sits, so the table's two columns can be read
        // off rather than guessed.
        std::vector<Box> boxes;

        if( html->GetInternalRepresentation() )
            walkBoxes( html->GetInternalRepresentation()->GetFirstChild(), 0, 0, boxes );

        printf( "\nword cells (x, y, w, h):\n" );

        for( const Box& b : boxes )
            printf( "  %-28s x %3d  y %3d  w %3d  h %2d\n",
                    (const char*) b.text.utf8_str(), b.x, b.y, b.w, b.h );

        // The label column's left edge, the value column's left edge, and the
        // pitch between the three table rows.
        int labelX = -1, valueX = -1;
        std::vector<int> rowY;

        for( const Box& b : boxes )
        {
            if( b.text == wxS( "Reference" ) || b.text == wxS( "Footprint" )
                || b.text == wxS( "Datasheet" ) )
            {
                if( labelX < 0 )
                    labelX = b.x;

                rowY.push_back( b.y );
            }
            else if( b.text == wxS( "J" ) && valueX < 0 )
            {
                valueX = b.x;
            }
        }

        printf( "\ntable: label column x %d, value column x %d, gap %d px\n", labelX, valueX,
                valueX - labelX );

        for( size_t i = 1; i < rowY.size(); ++i )
            printf( "  row pitch %zu->%zu   %d\n", i - 1, i, rowY[i] - rowY[i - 1] );

        // What colour does wxHtml actually paint the <hr> and the body? The
        // template names neither: HTML_WINDOW::SetPage supplies text and
        // bgcolor from wxSYS_COLOUR_WINDOWTEXT / _WINDOW, and the rule is
        // wxHtmlLineCell's own. Render the window and look.
        {
            wxBitmap    bmp( 520, 300 );
            wxMemoryDC  dc( bmp );
            dc.SetBackground( wxBrush( html->GetBackgroundColour() ) );
            dc.Clear();
            wxHtmlRenderingInfo info;
            wxDefaultHtmlRenderingStyle style( html );
            info.SetStyle( &style );
            html->GetInternalRepresentation()->Draw( dc, 0, 0, 0, INT_MAX, info );

            wxImage  img = bmp.ConvertToImage();
            auto     at = [&]( int x, int y )
            {
                printf( "  pixel (%d,%d)  #%02x%02x%02x\n", x, y, img.GetRed( x, y ),
                        img.GetGreen( x, y ), img.GetBlue( x, y ) );
            };

            printf( "\npainted:\n" );
            at( 200, 115 );      // the <hr>
            at( 200, 110 );      // clear space above it
        }

        printf( "\nHTML_WINDOW::SetPage's colours: text %s  bgcolor %s  link %s\n",
                (const char*) wxSystemSettings::GetColour( wxSYS_COLOUR_WINDOWTEXT )
                        .GetAsString( wxC2S_HTML_SYNTAX ).mb_str(),
                (const char*) wxSystemSettings::GetColour( wxSYS_COLOUR_WINDOW )
                        .GetAsString( wxC2S_HTML_SYNTAX ).mb_str(),
                (const char*) wxSystemSettings::GetColour( wxSYS_COLOUR_HOTLIGHT )
                        .GetAsString( wxC2S_HTML_SYNTAX ).mb_str() );

        dlg->Destroy();
        return false;
    }
};

wxIMPLEMENT_APP_CONSOLE( Probe );

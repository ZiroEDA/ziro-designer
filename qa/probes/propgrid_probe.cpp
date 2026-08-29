// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
//
// The docked Properties panel, asked of the widget that draws it.
//
// PROPERTIES_PANEL (common/widgets/properties_panel.cpp:47-150) is a wxPanel
// holding a wxStaticText caption added with `wxALL | wxEXPAND, 5` and a
// wxPropertyGrid below it, with the panel's font set to
// KIUI::GetDockedPaneFont() - on GTK that is getGUIFont( win, 0 ), i.e. the
// plain wxSYS_DEFAULT_GUI_FONT. Every metric the grid then draws with (row
// height, the left margin the category twisty lives in, the splitter, the
// category bar's colours, the greyed read-only text) is wxPropertyGrid's, not
// KiCad's, so none of it appears in KiCad's source and it has to be measured.
//
//   g++ -Wno-deprecated-declarations -o propgrid_probe propgrid_probe.cpp \
//       $(wx-config --cxxflags --libs core,base,adv,propgrid)
//
// Run it the way qa/probes/README.md says (env -i ... DISPLAY=:0), and let the
// event loop settle before asking: GTK does not recompute the grid's metrics
// until it is realized.
#include <wx/wx.h>
#include <wx/propgrid/propgrid.h>
#include <wx/propgrid/advprops.h>
#include <wx/settings.h>

static void settle( wxWindow* w )
{
    for( int i = 0; i < 50; ++i )
    {
        wxYield();
        w->Layout();
    }
}

static void dump( const char* aName, const wxColour& aColour )
{
    wxPrintf( "%-32s %s  rgb(%d, %d, %d)\n", aName,
              aColour.IsOk() ? aColour.GetAsString( wxC2S_HTML_SYNTAX ) : wxString( "<invalid>" ),
              aColour.Red(), aColour.Green(), aColour.Blue() );
}

class Probe : public wxApp
{
public:
    bool OnInit() override
    {
        // The width of eeschema's left dock in the capture being matched.
        wxFrame* f = new wxFrame( nullptr, wxID_ANY, "p", wxDefaultPosition, wxSize( 300, 700 ) );
        wxPanel* p = new wxPanel( f );

        wxBoxSizer* mainSizer = new wxBoxSizer( wxVERTICAL );

        wxStaticText* caption = new wxStaticText( p, wxID_ANY, "Symbol" );
        mainSizer->Add( caption, 0, wxALL | wxEXPAND, 5 );

        wxPropertyGrid* grid = new wxPropertyGrid( p );
        grid->SetUnspecifiedValueAppearance( wxPGCell( wxT( "<...>" ) ) );
        grid->SetExtraStyle( wxPG_EX_HELP_AS_TOOLTIPS );
        mainSizer->Add( grid, 1, wxEXPAND, 5 );

        grid->SetCellDisabledTextColour( wxSystemSettings::GetColour( wxSYS_COLOUR_GRAYTEXT ) );
        grid->SetCaptionTextColour( wxSystemSettings::GetColour( wxSYS_COLOUR_CAPTIONTEXT ) );

        // KIUI::GetDockedPaneFont, which off macOS is getGUIFont( win, 0 ).
        wxFont gui = wxSystemSettings::GetFont( wxSYS_DEFAULT_GUI_FONT );
        p->SetFont( gui );

        p->SetSizer( mainSizer );
        p->Layout();

        // The rows a selected SCH_SYMBOL produces, in KiCad's order.
        grid->Append( new wxPropertyCategory( "Basic Properties" ) );
        grid->Append( new wxBoolProperty( "Pin numbers", wxPG_LABEL, true ) );
        grid->Append( new wxBoolProperty( "Pin names", wxPG_LABEL, false ) );
        grid->Append( new wxStringProperty( "Position X", wxPG_LABEL, "1900 mils" ) );
        grid->Append( new wxStringProperty( "Position Y", wxPG_LABEL, "4100 mils" ) );
        wxPGChoices orientations;
        orientations.Add( "0" );
        orientations.Add( "90" );
        orientations.Add( "180" );
        orientations.Add( "270" );
        grid->Append( new wxEnumProperty( "Orientation", wxPG_LABEL, orientations, 2 ) );
        grid->Append( new wxBoolProperty( "Mirror X", wxPG_LABEL, false ) );
        grid->Append( new wxBoolProperty( "Mirror Y", wxPG_LABEL, false ) );
        grid->Append( new wxPropertyCategory( "Fields" ) );
        grid->Append( new wxStringProperty( "Reference", wxPG_LABEL, "J1" ) );
        wxPGProperty* ro = grid->Append(
                new wxStringProperty( "Library Link", wxPG_LABEL, "Connector:Screw_Terminal" ) );
        ro->ChangeFlag( wxPG_PROP_READONLY, true );

        f->Show();
        settle( p );
        grid->CenterSplitter();
        settle( p );

        wxPrintf( "font                             %s %dpt (%dpx line)\n",
                  gui.GetFaceName(), gui.GetPointSize(), grid->GetFontHeight() );
        wxPrintf( "\n" );
        wxPrintf( "grid size                        %d x %d\n", grid->GetSize().x,
                  grid->GetSize().y );
        wxPrintf( "GetRowHeight()                   %d\n", grid->GetRowHeight() );
        wxPrintf( "GetVerticalSpacing()             %d\n", grid->GetVerticalSpacing() );
        wxPrintf( "GetMarginWidth()                 %d\n", grid->GetMarginWidth() );
        wxPrintf( "GetSplitterPosition()            %d  (%.4f of width)\n",
                  grid->GetSplitterPosition(),
                  (double) grid->GetSplitterPosition() / grid->GetSize().x );
        wxPrintf( "GetImageSize().x                 %d\n", grid->GetImageSize().x );
        wxPrintf( "caption best height              %d\n", caption->GetBestSize().y );
        wxPrintf( "\n" );
        dump( "GetCaptionBackgroundColour()", grid->GetCaptionBackgroundColour() );
        dump( "GetCaptionForegroundColour()", grid->GetCaptionForegroundColour() );
        dump( "GetCellBackgroundColour()", grid->GetCellBackgroundColour() );
        dump( "GetCellTextColour()", grid->GetCellTextColour() );
        dump( "GetCellDisabledTextColour()", grid->GetCellDisabledTextColour() );
        dump( "GetLineColour()", grid->GetLineColour() );
        dump( "GetMarginColour()", grid->GetMarginColour() );
        dump( "GetEmptySpaceColour()", grid->GetEmptySpaceColour() );
        dump( "GetSelectionBackgroundColour()", grid->GetSelectionBackgroundColour() );
        dump( "GetSelectionForegroundColour()", grid->GetSelectionForegroundColour() );
        wxPrintf( "\n" );
        dump( "wxSYS_COLOUR_GRAYTEXT", wxSystemSettings::GetColour( wxSYS_COLOUR_GRAYTEXT ) );
        dump( "wxSYS_COLOUR_CAPTIONTEXT", wxSystemSettings::GetColour( wxSYS_COLOUR_CAPTIONTEXT ) );
        dump( "wxSYS_COLOUR_WINDOW", wxSystemSettings::GetColour( wxSYS_COLOUR_WINDOW ) );
        dump( "wxSYS_COLOUR_WINDOWTEXT", wxSystemSettings::GetColour( wxSYS_COLOUR_WINDOWTEXT ) );

        // Where each row actually lands, which is the only way to confirm the
        // row pitch the grid uses for a category versus a plain property.
        wxPrintf( "\n" );

        for( wxPropertyGridIterator it = grid->GetIterator( wxPG_ITERATE_VISIBLE ); !it.AtEnd();
             it.Next() )
        {
            wxPGProperty* prop = it.GetProperty();
            wxRect        r = grid->GetPropertyRect( prop, prop );
            wxPrintf( "%-24s y=%-5d h=%-4d %s\n", prop->GetLabel(), r.y, r.height,
                      prop->IsCategory() ? "[category]" : "" );
        }

        // Where the ink actually lands. wxPG's own layout constants
        // (wxPG_XBEFORETEXT, wxPG_ICON_WIDTH, the label indent) are compile-time
        // #defines in propgriddefs.h rather than anything the widget will
        // report, so blit the drawn grid and read the first inked column of
        // each row back off it.
        wxPrintf( "\n" );
        {
            wxClientDC   dc( grid );
            wxSize       sz = grid->GetSize();
            wxBitmap     bmp( sz.x, sz.y );
            wxMemoryDC   mem( bmp );
            mem.Blit( 0, 0, sz.x, sz.y, &dc, 0, 0 );
            mem.SelectObject( wxNullBitmap );
            wxImage img = bmp.ConvertToImage();

            auto scanRow =
                    [&]( const char* aWhat, int aY, int aFromX, int aToX )
                    {
                        // The row's own background, sampled one pixel in from
                        // the left of the span being scanned.
                        unsigned char br = img.GetRed( aFromX, aY );
                        unsigned char bg = img.GetGreen( aFromX, aY );
                        unsigned char bb = img.GetBlue( aFromX, aY );
                        int           first = -1;
                        int           last = -1;

                        for( int x = aFromX; x < aToX && x < img.GetWidth(); ++x )
                        {
                            if( img.GetRed( x, aY ) != br || img.GetGreen( x, aY ) != bg
                                || img.GetBlue( x, aY ) != bb )
                            {
                                if( first < 0 )
                                    first = x;

                                last = x;
                            }
                        }

                        wxPrintf( "%-40s bg=rgb(%d,%d,%d) ink x=%d..%d\n", aWhat, br, bg, bb, first,
                                  last );
                    };

            // Row 0 is the "Basic Properties" category, row 1 "Pin numbers".
            // Scan each row's vertical middle.
            scanRow( "category row, whole width", 12, 0, sz.x );
            scanRow( "property label column (Pin numbers)", 37, 0, 150 );
            scanRow( "property value column (Pin numbers)", 37, 151, sz.x );
            scanRow( "property value column (Position X)", 87, 151, sz.x );

            // The splitter line itself: which column differs from the cell
            // background across a plain text row.
            for( int x = 145; x < 156; ++x )
            {
                wxPrintf( "  x=%d rgb(%d,%d,%d)\n", x, img.GetRed( x, 87 ), img.GetGreen( x, 87 ),
                          img.GetBlue( x, 87 ) );
            }
        }

        f->Close();
        return false;
    }
};

wxIMPLEMENT_APP_CONSOLE( Probe );

// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
//
// The three panes of CVPCB's "Assign Footprints" window are wxListView built
// with cvpcb/listboxes.h's LISTBOX_STYLE and carrying KIUI::GetMonospacedUIFont()
// (cvpcb/cvpcb_mainframe.cpp:107-114).  This builds exactly that and asks it for
//
//   * the font wxFONTFAMILY_MODERN actually resolves to at the GUI point size,
//     its face name and its pixel size;
//   * the height of one row and the pitch between two rows, from GetItemRect();
//   * the width of one monospaced character cell, which is what sizes the
//     columns CVPCB_MAINFRAME::formatSymbolDesc pads by hand;
//   * for comparison, the same list with the plain GUI font, so we can tell how
//     much of the row height is the font and how much is GTK's own padding.
//
// Build (see qa/probes/README.md - env -i is not optional):
//   g++ -Wno-deprecated-declarations -o cvpcb_listbox_probe cvpcb_listbox_probe.cpp \
//       $(wx-config --cxxflags --libs core,base)

#include <wx/wx.h>
#include <wx/listctrl.h>
#include <wx/settings.h>
#include <wx/dcclient.h>
#include <wx/aui/aui.h>

#define LISTBOX_STYLE     ( wxBORDER_NONE | wxLC_NO_HEADER | wxLC_REPORT | wxLC_VIRTUAL | \
                            wxVSCROLL | wxHSCROLL )

class ProbeList : public wxListView
{
public:
    ProbeList( wxWindow* parent ) :
            wxListView( parent, wxID_ANY, wxDefaultPosition, wxDefaultSize, LISTBOX_STYLE )
    {
        InsertColumn( 0, wxEmptyString );
    }

    wxString OnGetItemText( long item, long ) const override
    {
        return wxString::Format( wxT( "%3d  D%ld - 1N4007 : Diode_THT:D_DO-41" ), (int) item,
                                 item );
    }
};

static void dumpFont( const char* what, const wxFont& f, wxWindow* w )
{
    wxClientDC dc( w );
    dc.SetFont( f );
    wxCoord tw = 0, th = 0;
    dc.GetTextExtent( wxT( "0123456789" ), &tw, &th );
    wxCoord pdw = 0, pdh = 0;
    dc.GetTextExtent( wxT( "pdI" ), &pdw, &pdh );

    printf( "%-26s face=%-22s pt=%d px=%d  charW(10 digits)=%d -> %.3f/char  "
            "extentH=%d  pdI.y=%d\n",
            what, (const char*) f.GetFaceName().utf8_str(), f.GetPointSize(),
            f.GetPixelSize().y, tw, tw / 10.0, th, pdh );
}

class App : public wxApp
{
public:
    bool OnInit() override
    {
        wxFrame* frame = new wxFrame( nullptr, wxID_ANY, wxT( "cvpcb listbox probe" ),
                                      wxDefaultPosition, wxSize( 900, 600 ) );

        // KIUI::GetMonospacedUIFont(), common/widgets/ui_common.cpp:93-106.
        int guiPt = wxSystemSettings::GetFont( wxSYS_DEFAULT_GUI_FONT ).GetPointSize();
        wxFont mono( guiPt, wxFONTFAMILY_MODERN, wxFONTSTYLE_NORMAL, wxFONTWEIGHT_NORMAL );

        ProbeList* monoList = new ProbeList( frame );
        monoList->SetFont( mono );
        monoList->SetItemCount( 40 );

        ProbeList* plainList = new ProbeList( frame );
        plainList->SetItemCount( 40 );

        // A deliberately smaller font, to tell "24 px is a constant" from
        // "24 px is the line box plus a fixed padding".
        ProbeList* smallList = new ProbeList( frame );
        smallList->SetFont( wxFont( 7, wxFONTFAMILY_MODERN, wxFONTSTYLE_NORMAL,
                                    wxFONTWEIGHT_NORMAL ) );
        smallList->SetItemCount( 40 );

        ProbeList* bigList = new ProbeList( frame );
        bigList->SetFont( wxFont( 16, wxFONTFAMILY_MODERN, wxFONTSTYLE_NORMAL,
                                  wxFONTWEIGHT_NORMAL ) );
        bigList->SetItemCount( 40 );

        wxStaticText* status = new wxStaticText( frame, wxID_ANY, wxT( "No Filtering: 15447 matching footprints" ) );

        wxBoxSizer* s = new wxBoxSizer( wxHORIZONTAL );
        s->Add( monoList, 1, wxEXPAND );
        s->Add( plainList, 1, wxEXPAND );
        s->Add( smallList, 1, wxEXPAND );
        s->Add( bigList, 1, wxEXPAND );
        wxBoxSizer* outer = new wxBoxSizer( wxVERTICAL );
        outer->Add( s, 1, wxEXPAND );
        outer->Add( status, 0, wxEXPAND );
        frame->SetSizer( outer );
        frame->Show();

        for( int i = 0; i < 400; i++ )
        {
            wxYield();
            wxMilliSleep( 1 );
        }

        wxFont sysGui = wxSystemSettings::GetFont( wxSYS_DEFAULT_GUI_FONT );
        printf( "wxSYS_DEFAULT_GUI_FONT       face=%s  pointSize=%d  pixelSize=%d\n",
                (const char*) sysGui.GetFaceName().utf8_str(), sysGui.GetPointSize(),
                sysGui.GetPixelSize().y );
        printf( "content scale factor         %.3f\n", frame->GetContentScaleFactor() );
        printf( "\n" );

        dumpFont( "GetMonospacedUIFont()", mono, monoList );
        dumpFont( "list default (GUI) font", plainList->GetFont(), plainList );
        dumpFont( "mono 7pt", smallList->GetFont(), smallList );
        dumpFont( "mono 16pt", bigList->GetFont(), bigList );
        dumpFont( "status wxStaticText font", status->GetFont(), status );
        printf( "\n" );

        auto rows = []( const char* what, wxListView* lv )
        {
            wxRect r0, r1, r5;
            bool ok0 = lv->GetItemRect( 0, r0 );
            bool ok1 = lv->GetItemRect( 1, r1 );
            bool ok5 = lv->GetItemRect( 5, r5 );
            printf( "%-24s itemRect0=(%d,%d %dx%d)  ok=%d  pitch(1-0)=%d  pitch(5-0)/5=%.2f  "
                    "charHeight=%d\n",
                    what, r0.x, r0.y, r0.width, r0.height, (int) ( ok0 && ok1 && ok5 ),
                    r1.y - r0.y, ( r5.y - r0.y ) / 5.0, lv->GetCharHeight() );
        };

        // Where the row's TEXT starts inside the item: wxListCtrl's own label
        // rect, which is the inset a CSS padding has to reproduce.
        {
            wxRect label;
            monoList->GetItemRect( 0, label, wxLIST_RECT_LABEL );
            wxRect bounds;
            monoList->GetItemRect( 0, bounds, wxLIST_RECT_BOUNDS );
            printf( "list label rect x=%d (bounds x=%d) -> text inset %d\n", label.x, bounds.x,
                    label.x - bounds.x );
        }

        rows( "mono list", monoList );
        rows( "plain list", plainList );
        rows( "mono 7pt list", smallList );
        rows( "mono 16pt list", bigList );

        printf( "\nstatus label best height     %d  (text height %d)\n",
                status->GetBestSize().y, status->GetSize().y );

        // The three panes are EDA_PANE().Palette(): CaptionVisible(true),
        // CloseButton(false), Gripper(false), PaneBorder(true).  Ask wxAUI's own
        // art provider for the caption band it paints.
        wxFrame* auiFrame = new wxFrame( nullptr, wxID_ANY, wxT( "aui probe" ), wxDefaultPosition,
                                         wxSize( 900, 400 ) );
        wxAuiManager mgr;
        mgr.SetManagedWindow( auiFrame );
        wxAuiPaneInfo pane;
        pane.Gripper( false ).CloseButton( false ).PaneBorder( true ).CaptionVisible( true );
        pane.Name( "Libraries" ).Left().Caption( wxT( "Footprint Libraries" ) );
        wxPanel* p = new wxPanel( auiFrame );
        mgr.AddPane( p, pane );
        mgr.Update();
        auiFrame->Show();

        for( int i = 0; i < 200; i++ ) { wxYield(); wxMilliSleep( 1 ); }

        wxAuiDockArt* art = mgr.GetArtProvider();
        wxFont capFont = art->GetFont( wxAUI_DOCKART_CAPTION_FONT );
        printf( "\naui caption size            %d\n", art->GetMetric( wxAUI_DOCKART_CAPTION_SIZE ) );
        printf( "aui pane border size        %d\n", art->GetMetric( wxAUI_DOCKART_PANE_BORDER_SIZE ) );
        printf( "aui sash size               %d\n", art->GetMetric( wxAUI_DOCKART_SASH_SIZE ) );
        dumpFont( "aui caption font", capFont, auiFrame );
        printf( "aui caption colour          #%02x%02x%02x   text #%02x%02x%02x\n",
                art->GetColour( wxAUI_DOCKART_INACTIVE_CAPTION_COLOUR ).Red(),
                art->GetColour( wxAUI_DOCKART_INACTIVE_CAPTION_COLOUR ).Green(),
                art->GetColour( wxAUI_DOCKART_INACTIVE_CAPTION_COLOUR ).Blue(),
                art->GetColour( wxAUI_DOCKART_INACTIVE_CAPTION_TEXT_COLOUR ).Red(),
                art->GetColour( wxAUI_DOCKART_INACTIVE_CAPTION_TEXT_COLOUR ).Green(),
                art->GetColour( wxAUI_DOCKART_INACTIVE_CAPTION_TEXT_COLOUR ).Blue() );
        // Where the CAPTION's text starts: paint the art provider's own caption
        // into a bitmap and find the first column that is not the caption fill.
        {
            wxBitmap bmp( 300, 40 );
            wxMemoryDC mdc( bmp );
            mdc.SetBackground( *wxBLACK_BRUSH );
            mdc.Clear();
            wxRect capRect( 0, 0, 300, art->GetMetric( wxAUI_DOCKART_CAPTION_SIZE ) );
            art->DrawCaption( mdc, auiFrame, wxT( "Footprint Libraries" ), capRect, pane );
            mdc.SelectObject( wxNullBitmap );
            wxImage img = bmp.ConvertToImage();

            // The same caption with no text, so the first column where the two
            // differ is the text's own left edge and nothing else's.
            wxBitmap blankBmp( 300, 40 );
            wxMemoryDC bdc( blankBmp );
            bdc.SetBackground( *wxBLACK_BRUSH );
            bdc.Clear();
            art->DrawCaption( bdc, auiFrame, wxEmptyString, capRect, pane );
            bdc.SelectObject( wxNullBitmap );
            wxImage blank = blankBmp.ConvertToImage();

            int firstInk = -1;
            for( int x = 0; x < img.GetWidth() && firstInk < 0; x++ )
            {
                for( int y = 0; y < capRect.height; y++ )
                {
                    if( img.GetRed( x, y ) != blank.GetRed( x, y )
                        || img.GetGreen( x, y ) != blank.GetGreen( x, y )
                        || img.GetBlue( x, y ) != blank.GetBlue( x, y ) )
                    {
                        firstInk = x;
                        break;
                    }
                }
            }
            printf( "aui caption text left edge    %d\n", firstInk );
        }

        mgr.UnInit();
        auiFrame->Destroy();

        frame->Destroy();
        return false;
    }
};

wxIMPLEMENT_APP_CONSOLE( App );

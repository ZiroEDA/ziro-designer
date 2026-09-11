// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
//
// What wxWidgets draws for HIERARCHY_TREE (eeschema/widgets/hierarchy_pane.h):
//
//     wxTreeCtrl( parent, wxID_ANY, wxDefaultPosition, wxDefaultSize,
//                 wxTR_HAS_BUTTONS | wxTR_EDIT_LABELS | wxTR_HIDE_ROOT, ... )
//
// with the two images HIERARCHY_PANE::HIERARCHY_PANE pushes (tree_nosel, then
// tree_sel), the current sheet bold + selected (UpdateHierarchySelection:
// SetItemBold + SetFocusedItem), and the rest plain.
//
// On GTK a wxTreeCtrl IS wxGenericTreeCtrl, so every number here is wx's own
// PaintLevel/PaintItem arithmetic (src/generic/treectlg.cpp) realised with
// this machine's font and theme: the row pitch, where the button, the dotted
// guides, the icon and the text land, the dotted pen's on/off pattern and its
// colour, and the selection band. The tree is drawn into a bitmap through the
// same wxDC the control paints with, and the bitmap is scanned rather than a
// screenshot, because a screenshot holds whatever else the window manager
// composited.
//
//   g++ -Wno-deprecated-declarations -o hierarchy_tree_probe hierarchy_tree_probe.cpp \
//       $(wx-config --cxxflags --libs core,base)
//   ./hierarchy_tree_probe /home/akshay/kicad-reference/resources/bitmaps_png/png
#include <wx/wx.h>
#include <wx/treectrl.h>
#include <wx/dcclient.h>
#include <wx/dcmemory.h>
#include <wx/rawbmp.h>
#include <wx/dcscreen.h>
#include <wx/timer.h>
#include <wx/settings.h>
#include <cstdio>
#include <vector>

static wxString g_pngDir;

class Probe : public wxApp
{
public:
    bool OnInit() override
    {
        if( argc > 1 )
            g_pngDir = argv[1];

        wxInitAllImageHandlers();

        wxFrame* frame = new wxFrame( nullptr, wxID_ANY, wxS( "hierarchy" ), wxDefaultPosition,
                                      wxSize( 400, 300 ) );
        wxPanel* panel = new wxPanel( frame );
        wxBoxSizer* sizer = new wxBoxSizer( wxVERTICAL );
        panel->SetSizer( sizer );

        m_tree = new wxTreeCtrl( panel, wxID_ANY, wxDefaultPosition, wxDefaultSize,
                                 wxTR_HAS_BUTTONS | wxTR_EDIT_LABELS | wxTR_HIDE_ROOT );
        wxVector<wxBitmapBundle> images;
        images.push_back( wxBitmapBundle::FromBitmap(
                wxBitmap( g_pngDir + wxS( "/tree_nosel_dark_16.png" ), wxBITMAP_TYPE_PNG ) ) );
        images.push_back( wxBitmapBundle::FromBitmap(
                wxBitmap( g_pngDir + wxS( "/tree_sel_dark_16.png" ), wxBITMAP_TYPE_PNG ) ) );
        m_tree->SetImages( images );
        sizer->Add( m_tree, 1, wxEXPAND, wxBORDER_NONE );

        wxTreeItemId root = m_tree->AddRoot( wxS( "project" ), 0, 1 );
        wxTreeItemId top = m_tree->AppendItem( root, wxS( "CM5_MINIMA_3 (page 1)" ), 0, 1 );
        wxTreeItemId a = m_tree->AppendItem( top, wxS( "PCIe-M2 (page 2)" ), 0, 1 );
        wxTreeItemId b = m_tree->AppendItem( top, wxS( "CM5 (page 3)" ), 0, 1 );
        wxTreeItemId c = m_tree->AppendItem( top, wxS( "Ethernet (page 4)" ), 0, 1 );
        wxTreeItemId d = m_tree->AppendItem( top, wxS( "HDMI (page 5)" ), 0, 1 );
        wxTreeItemId d1 = m_tree->AppendItem( d, wxS( "Nested (page 6)" ), 0, 1 );
        wxTreeItemId e = m_tree->AppendItem( top, wxS( "DSI_CSI (page 7)" ), 0, 1 );
        (void) a; (void) b; (void) d1; (void) e;
        m_tree->ExpandAll();
        m_tree->SetItemBold( c, true );
        m_tree->SetFocusedItem( c );
        m_sel = c;
        m_items = { top, a, b, c, d, d1, e };

        frame->Show();
        // Let GTK map and paint the window, then read it back off the screen:
        // a wxClientDC on GTK3 cannot be blitted FROM (it comes back black),
        // so the pixels are taken from the display server, which is why the
        // probe wants an undisturbed X11 session.
        m_timer.Bind( wxEVT_TIMER, [this, frame]( wxTimerEvent& ) { Dump(); frame->Close(); } );
        m_timer.StartOnce( 700 );
        return true;
    }

    void Dump()
    {
        wxYield();
        const wxColour grey = wxSystemSettings::GetColour( wxSYS_COLOUR_GRAYTEXT );
        const wxColour win = wxSystemSettings::GetColour( wxSYS_COLOUR_LISTBOX );
        wxClientDC cdc( m_tree );
        printf( "font                 %s %g pt, char height %d\n",
                (const char*) m_tree->GetFont().GetFaceName().utf8_str(),
                m_tree->GetFont().GetFractionalPointSize(), cdc.GetCharHeight() );
        printf( "wxSYS_COLOUR_GRAYTEXT #%02X%02X%02X alpha %d   wxSYS_COLOUR_LISTBOX #%02X%02X%02X\n",
                grey.Red(), grey.Green(), grey.Blue(), grey.Alpha(), win.Red(), win.Green(),
                win.Blue() );
        printf( "GetIndent %u  GetSpacing %u  tree bg #%02X%02X%02X\n", m_tree->GetIndent(),
                m_tree->GetSpacing(), m_tree->GetBackgroundColour().Red(),
                m_tree->GetBackgroundColour().Green(), m_tree->GetBackgroundColour().Blue() );

        for( const wxTreeItemId& id : m_items )
        {
            wxRect r, t;
            m_tree->GetBoundingRect( id, r, false );
            m_tree->GetBoundingRect( id, t, true );
            printf( "item %-24s row x=%d y=%d w=%d h=%d   text x=%d y=%d w=%d h=%d\n",
                    (const char*) m_tree->GetItemText( id ).utf8_str(), r.x, r.y, r.width,
                    r.height, t.x, t.y, t.width, t.height );
        }

        // Read the painted control back through its own DC.
        wxSize sz = m_tree->GetClientSize();
        wxPoint org = m_tree->ClientToScreen( wxPoint( 0, 0 ) );
        wxBitmap bmp( sz.x, sz.y, 24 );
        {
            wxScreenDC sdc;
            wxMemoryDC mdc( bmp );
            mdc.Blit( 0, 0, sz.x, sz.y, &sdc, org.x, org.y );
        }
        wxImage img = bmp.ConvertToImage();
        img.SaveFile( wxS( "/tmp/hierarchy_tree_probe.png" ), wxBITMAP_TYPE_PNG );
        printf( "client %dx%d, saved /tmp/hierarchy_tree_probe.png\n", sz.x, sz.y );

        auto px = [&]( int x, int y ) -> unsigned
        {
            return ( img.GetRed( x, y ) << 16 ) | ( img.GetGreen( x, y ) << 8 ) | img.GetBlue( x, y );
        };
        auto scanRow = [&]( const char* label, int y, int x0, int x1 )
        {
            printf( "%s y=%d x=%d..%d:", label, y, x0, x1 );
            for( int x = x0; x <= x1; ++x ) printf( " %06X", px( x, y ) );
            printf( "\n" );
        };
        auto scanCol = [&]( const char* label, int x, int y0, int y1 )
        {
            printf( "%s x=%d y=%d..%d:", label, x, y0, y1 );
            for( int y = y0; y <= y1; ++y ) printf( " %06X", px( x, y ) );
            printf( "\n" );
        };
        wxRect r1, r2;
        m_tree->GetBoundingRect( m_items[0], r1, false );
        m_tree->GetBoundingRect( m_items[1], r2, false );
        int ymid1 = r1.y + r1.height / 2;
        int ymid2 = r2.y + r2.height / 2;
        scanRow( "top row mid ", ymid1, 0, 60 );
        scanRow( "child row mid", ymid2, 0, 60 );
        scanCol( "trunk        ", m_tree->GetIndent(), r1.y, r2.y + r2.height );
        for( int y = ymid1 - 6; y <= ymid1 + 6; ++y )
            scanRow( "button       ", y, 8, 22 );
        wxRect rs;
        m_tree->GetBoundingRect( m_sel, rs, false );
        scanRow( "selected row ", rs.y + 2, rs.x + 30, rs.x + 45 );
        scanCol( "selected col ", rs.x + 40, rs.y - 2, rs.y + rs.height + 1 );
        for( int y = r1.y; y < r1.y + r1.height; ++y )
            scanRow( "icon         ", y, r1.x - 1, r1.x + 17 );
    }

    wxTreeCtrl* m_tree = nullptr;
    wxTimer m_timer;
    wxTreeItemId m_sel;
    std::vector<wxTreeItemId> m_items;
};

wxIMPLEMENT_APP( Probe );

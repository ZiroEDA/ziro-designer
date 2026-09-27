// SPDX-License-Identifier: GPL-3.0-or-later
// wxPrintout's page fitting, as PLEDITOR_PRINTOUT::PrintPage uses it:
// FitThisSizeToPaper, GetLogicalPaperRect, OffsetLogicalOrigin, and the DC
// mapping they leave behind (LogicalToDevice / DeviceToLogical, Rel too).
//
// A wxMemoryDC stands in for the printer DC, and the page and paper sizes are
// set the way wxPrinter sets them for a page with no margins: the page is the
// DC, and the paper rect is the page.
//
// Build: g++ printout_fit_probe.cpp $(wx-config --cxxflags --libs core,base) -o printout_fit_probe
#include <wx/wx.h>
#include <wx/print.h>
#include <wx/dcmemory.h>
#include <cstdio>

class PROBE_PRINTOUT : public wxPrintout
{
public:
    PROBE_PRINTOUT() : wxPrintout( "probe" ) {}
    bool OnPrintPage( int ) override { return true; }
};

static void run( int aDcW, int aDcH, int aImgW, int aImgH )
{
    wxBitmap       bmp( aDcW, aDcH );
    wxMemoryDC     dc( bmp );
    PROBE_PRINTOUT po;

    po.SetDC( &dc );
    po.SetPageSizePixels( aDcW, aDcH );
    po.SetPaperRectPixels( wxRect( 0, 0, aDcW, aDcH ) );

    po.FitThisSizeToPaper( wxSize( aImgW, aImgH ) );

    double sx, sy;
    dc.GetUserScale( &sx, &sy );
    wxPoint devOrg = dc.GetDeviceOrigin();
    wxPoint logOrg = dc.GetLogicalOrigin();
    wxRect  fit = po.GetLogicalPaperRect();

    printf( "dc %dx%d img %dx%d\n", aDcW, aDcH, aImgW, aImgH );
    printf( "  after Fit: scale %.9g %.9g  devOrg %d %d  logOrg %d %d\n", sx, sy, devOrg.x,
            devOrg.y, logOrg.x, logOrg.y );
    printf( "  logicalPaperRect %d %d %d %d\n", fit.x, fit.y, fit.width, fit.height );

    int xoffset = ( fit.width - aImgW ) / 2;
    int yoffset = ( fit.height - aImgH ) / 2;
    po.OffsetLogicalOrigin( xoffset, yoffset );

    devOrg = dc.GetDeviceOrigin();
    logOrg = dc.GetLogicalOrigin();
    printf( "  offset %d %d -> devOrg %d %d  logOrg %d %d\n", xoffset, yoffset, devOrg.x,
            devOrg.y, logOrg.x, logOrg.y );

    const int pts[][2] = { { 0, 0 }, { aImgW, aImgH }, { 12345, 6789 }, { -7, 3 } };

    for( const auto& p : pts )
    {
        printf( "  L2D %d %d -> %d %d  rel %d %d\n", p[0], p[1], dc.LogicalToDeviceX( p[0] ),
                dc.LogicalToDeviceY( p[1] ), dc.LogicalToDeviceXRel( p[0] ),
                dc.LogicalToDeviceYRel( p[1] ) );
    }

    const int dpts[][2] = { { 0, 0 }, { 1, 1 }, { aDcW, aDcH }, { 100, 37 } };

    for( const auto& p : dpts )
    {
        printf( "  D2L %d %d -> %d %d  rel %d %d\n", p[0], p[1], dc.DeviceToLogicalX( p[0] ),
                dc.DeviceToLogicalY( p[1] ), dc.DeviceToLogicalXRel( p[0] ),
                dc.DeviceToLogicalYRel( p[1] ) );
    }

    dc.SelectObject( wxNullBitmap );
}

class APP : public wxApp
{
public:
    bool OnInit() override
    {
        // A4 at 300 PPI (2480 x 3508) against A4 and A3 in drawing-sheet IU
        // (1 IU = 1 um: 210000 x 297000, and A3 landscape 420000 x 297000).
        run( 2480, 3508, 210000, 297000 );
        run( 2480, 3508, 420000, 297000 );
        run( 3508, 2480, 420000, 297000 );
        run( 1000, 700, 297000, 210000 );
        // KiCad's own sizes: PAGE_INFO A4 is 8268 x 11693 mils and A3 is
        // 16535 x 11693, times IU_PER_MILS 25.4, truncated (GetSizeIU).
        run( 2480, 3508, 210007, 297002 );
        run( 2480, 3508, 419989, 297002 );
        return false;
    }
};

wxIMPLEMENT_APP_CONSOLE( APP );

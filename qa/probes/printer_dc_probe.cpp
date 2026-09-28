// SPDX-License-Identifier: GPL-3.0-or-later
// What a real printing wxDC (GTK, wxPrinter::Print to a file, no dialog)
// answers inside OnPrintPage for the calls KiCad's wxDC print path makes:
// BITMAP_BASE::DrawBitmap branches on CanUseTransformMatrix(); the printout's
// page and paper sizes; and the fit PLEDITOR_PRINTOUT::PrintPage does.
//
// Build: g++ printer_dc_probe.cpp $(wx-config --cxxflags --libs core,base) -o printer_dc_probe
#include <wx/wx.h>
#include <wx/print.h>
#include <wx/cmndata.h>
#include <cstdio>

class PROBE_PRINTOUT : public wxPrintout
{
public:
    PROBE_PRINTOUT() : wxPrintout( "probe" ) {}

    bool HasPage( int aPage ) override { return aPage == 1; }

    void GetPageInfo( int* minPage, int* maxPage, int* selFrom, int* selTo ) override
    {
        *minPage = *selFrom = 1;
        *maxPage = *selTo = 1;
    }

    bool OnPrintPage( int ) override
    {
        wxDC* dc = GetDC();
        int   w, h, pw, ph, mw, mh;
        dc->GetSize( &w, &h );
        GetPageSizePixels( &pw, &ph );
        GetPageSizeMM( &mw, &mh );
        wxRect paper = GetPaperRectPixels();
        int    ppiX, ppiY;
        GetPPIPrinter( &ppiX, &ppiY );

        printf( "dc size %d %d  page px %d %d  page mm %d %d\n", w, h, pw, ph, mw, mh );
        printf( "paper rect px %d %d %d %d  printer PPI %d %d  dc PPI %d %d\n", paper.x,
                paper.y, paper.width, paper.height, ppiX, ppiY, dc->GetPPI().x,
                dc->GetPPI().y );
        printf( "CanUseTransformMatrix %d\n", dc->CanUseTransformMatrix() );

        // PLEDITOR_PRINTOUT::PrintPage for an A4 drawing sheet (210 x 297 mm,
        // 1 IU = 1 um): FitThisSizeToPaper, GetLogicalPaperRect, OffsetLogicalOrigin.
        wxSize pageSizeIU( 210000, 297000 );
        FitThisSizeToPaper( pageSizeIU );
        wxRect fitRect = GetLogicalPaperRect();
        int    xoffset = ( fitRect.width - pageSizeIU.x ) / 2;
        int    yoffset = ( fitRect.height - pageSizeIU.y ) / 2;
        OffsetLogicalOrigin( xoffset, yoffset );

        double sx, sy;
        dc->GetUserScale( &sx, &sy );
        wxPoint dev = dc->GetDeviceOrigin();
        wxPoint log = dc->GetLogicalOrigin();
        printf( "fit scale %.9g %.9g  logicalPaperRect %d %d %d %d\n", sx, sy, fitRect.x,
                fitRect.y, fitRect.width, fitRect.height );
        printf( "offset %d %d -> devOrg %d %d logOrg %d %d\n", xoffset, yoffset, dev.x, dev.y,
                log.x, log.y );
        printf( "L2D 210000 297000 -> %d %d   D2Lrel 1 -> %d\n", dc->LogicalToDeviceX( 210000 ),
                dc->LogicalToDeviceY( 297000 ), dc->DeviceToLogicalXRel( 1 ) );

        dc->SetPen( wxPen( *wxBLACK, 0 ) );
        printf( "pen 0 -> width %d cap %d join %d\n", dc->GetPen().GetWidth(),
                (int) dc->GetPen().GetCap(), (int) dc->GetPen().GetJoin() );
        return true;
    }
};

class APP : public wxApp
{
public:
    bool OnInit() override
    {
        wxPrintData data;
        data.SetFilename( "/home/akshay/printer_dc_probe.pdf" );
        data.SetPrintMode( wxPRINT_MODE_FILE );
        data.SetPrinterName( "Print to File" );
        data.SetPaperId( wxPAPER_A4 );
        data.SetOrientation( wxPORTRAIT );

        wxPrintDialogData dialogData( data );
        wxPrinter         printer( &dialogData );
        PROBE_PRINTOUT    printout;

        bool ok = printer.Print( nullptr, &printout, false );
        printf( "Print %d lastError %d\n", ok, (int) wxPrinter::GetLastError() );
        return false;
    }
};

wxIMPLEMENT_APP_CONSOLE( APP );

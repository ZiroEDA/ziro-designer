// STATUS_TEXT_POPUP (common/status_popup.cpp) built with KiCad's own code on
// this GTK theme: the popup's size, where the text sits, the colours, the
// font, and a screen capture of the popup plus a margin, so common/
// status_popup.ts states measured numbers rather than guessed ones.
//
//   g++ -Wno-deprecated-declarations -o status_popup_probe status_popup_probe.cpp \
//       $(wx-config --cxxflags --libs core,base)
//   env -i DISPLAY=:0 GDK_BACKEND=x11 HOME=$HOME PATH=/usr/bin:/bin \
//       XDG_RUNTIME_DIR=/run/user/1000 XAUTHORITY=$XAUTHORITY ./status_popup_probe
#include <wx/wx.h>
#include <wx/popupwin.h>
#include <cstdio>
#include <unistd.h>

// The two classes, as status_popup.cpp builds them (timer and OSX hook left out).
class STATUS_POPUP : public wxPopupWindow {
 public:
  STATUS_POPUP(wxWindow* aParent) : wxPopupWindow(aParent) {
    SetDoubleBuffered(true);
    m_panel = new wxPanel(this, wxID_ANY);
    m_topSizer = new wxBoxSizer(wxHORIZONTAL);
    m_panel->SetSizer(m_topSizer);
    m_panel->SetBackgroundColour(wxSystemSettings::GetColour(wxSYS_COLOUR_WINDOW));
  }
  void updateSize() {
    m_topSizer->Fit(m_panel);
    SetClientSize(m_panel->GetSize());
  }
  wxPanel* m_panel;
  wxBoxSizer* m_topSizer;
};

class STATUS_TEXT_POPUP : public STATUS_POPUP {
 public:
  STATUS_TEXT_POPUP(wxWindow* aParent) : STATUS_POPUP(aParent) {
    SetBackgroundColour(wxSystemSettings::GetColour(wxSYS_COLOUR_BTNFACE));
    m_panel->SetBackgroundColour(wxSystemSettings::GetColour(wxSYS_COLOUR_BTNFACE));
    m_panel->SetForegroundColour(wxSystemSettings::GetColour(wxSYS_COLOUR_BTNTEXT));
    m_statusLine = new wxStaticText(m_panel, wxID_ANY, wxEmptyString);
    m_topSizer->Add(m_statusLine, 1, wxALL | wxEXPAND, 5);
  }
  void SetText(const wxString& aText) {
    m_statusLine->SetLabel(aText);
    updateSize();
  }
  wxStaticText* m_statusLine;
};

static void report(STATUS_TEXT_POPUP* p, const char* tag) {
  wxSize outer = p->GetSize();
  wxSize client = p->GetClientSize();
  wxPoint tp = p->m_statusLine->GetPosition();
  wxSize ts = p->m_statusLine->GetSize();
  wxSize best = p->m_statusLine->GetBestSize();
  printf("[%s] popup outer %dx%d client %dx%d; panel %dx%d; text at (%d,%d) size %dx%d best %dx%d\n",
         tag, outer.x, outer.y, client.x, client.y, p->m_panel->GetSize().x,
         p->m_panel->GetSize().y, tp.x, tp.y, ts.x, ts.y, best.x, best.y);
}

class App : public wxApp {
 public:
  bool OnInit() override {
    wxFrame* f = new wxFrame(nullptr, wxID_ANY, "probe", wxPoint(100, 100), wxSize(600, 400));
    f->Show();

    auto* one = new STATUS_TEXT_POPUP(f);
    one->SetText("Click on new member...");
    one->Move(wxPoint(200, 200));
    one->Show(true);

    auto* two = new STATUS_TEXT_POPUP(f);
    two->SetText("Click on pad 1\nPress <esc> to cancel all; double-click to finish");
    two->Move(wxPoint(200, 300));
    two->Show(true);

    wxColour face = wxSystemSettings::GetColour(wxSYS_COLOUR_BTNFACE);
    wxColour text = wxSystemSettings::GetColour(wxSYS_COLOUR_BTNTEXT);
    wxFont font = one->m_statusLine->GetFont();
    printf("BTNFACE %s BTNTEXT %s font '%s' %.2fpt %dpx\n", face.GetAsString(wxC2S_HTML_SYNTAX).c_str().AsChar(),
           text.GetAsString(wxC2S_HTML_SYNTAX).c_str().AsChar(), font.GetFaceName().c_str().AsChar(),
           font.GetFractionalPointSize(), font.GetPixelSize().y);
    printf("popup border style flags %ld\n", (long)(one->GetWindowStyleFlag() & wxBORDER_MASK));
    fflush(stdout);

    wxTimer* t = new wxTimer();
    t->Bind(wxEVT_TIMER, [=](wxTimerEvent&) {
      report(one, "one line");
      report(two, "two lines");
      // Capture popup one with a 3px margin to see any border wx/GTK draws.
      wxScreenDC dc;
      wxPoint at = one->GetScreenPosition();
      wxSize sz = one->GetSize();
      int m = 3;
      wxBitmap bmp(sz.x + 2 * m, sz.y + 2 * m);
      wxMemoryDC mem(bmp);
      mem.Blit(0, 0, sz.x + 2 * m, sz.y + 2 * m, &dc, at.x - m, at.y - m);
      mem.SelectObject(wxNullBitmap);
      wxImage img = bmp.ConvertToImage();
      img.SaveFile(wxString(getenv("HOME")) + "/status_popup_probe.png", wxBITMAP_TYPE_PNG);
      // The left edge, row by row in the middle: margin, then the popup's first columns.
      int y = m + sz.y / 2;
      printf("row y=%d (x=0..%d):", y - m, 2 * m + 3);
      for (int x = 0; x < 2 * m + 4; x++)
        printf(" #%02x%02x%02x", img.GetRed(x, y), img.GetGreen(x, y), img.GetBlue(x, y));
      printf("\n");
      int x = m + 8;
      printf("column x=%d (y=0..%d):", x - m, 2 * m + 3);
      for (int yy = 0; yy < 2 * m + 4; yy++)
        printf(" #%02x%02x%02x", img.GetRed(x, yy), img.GetGreen(x, yy), img.GetBlue(x, yy));
      printf("\n");
      fflush(stdout);
      _exit(0);
    });
    t->StartOnce(800);
    return true;
  }
};

wxIMPLEMENT_APP(App);

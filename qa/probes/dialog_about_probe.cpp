// DIALOG_ABOUT's layout, measured: dialog_about_base.cpp's sizer tree rebuilt
// verbatim (same flags, borders, proportions, the 750x350 notebook minimum and
// the 14pt bold title), plus a wxNotebook with a 16px image list and the
// dialog's nine page captions, then Fit() the way SetSizeHints does. Prints
// the rectangles that the CSS in shell.css (.ze-about*) states.
//
//   g++ -Wno-deprecated-declarations -o dialog_about_probe dialog_about_probe.cpp \
//       $(wx-config --cxxflags --libs core,base,html) $(pkg-config --cflags --libs gtk+-3.0)
//   env -i HOME="$HOME" PATH=/usr/bin:/bin USER="$USER" DISPLAY=:0 \
//       GDK_BACKEND=x11 ./dialog_about_probe
#include <wx/wx.h>
#include <wx/notebook.h>
#include <wx/html/htmlwin.h>
#include <gtk/gtk.h>
#include <cstdio>

static void dump(const char* name, wxWindow* w, wxWindow* top) {
  wxPoint p = top->ScreenToClient(w->GetScreenPosition());
  wxSize s = w->GetSize();
  printf("%-14s x=%d y=%d w=%d h=%d\n", name, p.x, p.y, s.x, s.y);
}

class App : public wxApp {
 public:
  bool OnInit() override {
    wxDialog* d = new wxDialog(nullptr, wxID_ANY, "About", wxDefaultPosition, wxDefaultSize,
                               wxDEFAULT_DIALOG_STYLE | wxRESIZE_BORDER);
    wxBoxSizer* bSizerMain = new wxBoxSizer(wxVERTICAL);
    wxBoxSizer* bSizerTitle = new wxBoxSizer(wxHORIZONTAL);
    bSizerTitle->Add(0, 0, 1, wxEXPAND, 5);
    wxBitmap bmp(32, 32);
    wxStaticBitmap* m_bitmapApp = new wxStaticBitmap(d, wxID_ANY, bmp);
    bSizerTitle->Add(m_bitmapApp, 1, wxALIGN_CENTER | wxALL, 5);
    wxBoxSizer* b_apptitleSizer = new wxBoxSizer(wxVERTICAL);
    wxStaticText* title = new wxStaticText(d, wxID_ANY, "ZiroEDA PCB Editor", wxDefaultPosition,
                                           wxDefaultSize, wxALIGN_CENTER_HORIZONTAL);
    title->SetFont(wxFont(14, wxFONTFAMILY_DEFAULT, wxFONTSTYLE_NORMAL, wxFONTWEIGHT_BOLD, false, wxEmptyString));
    b_apptitleSizer->Add(title, 0, wxALIGN_CENTER | wxALL, 5);
    wxStaticText* build = new wxStaticText(d, wxID_ANY, "Version: 6da66b7, release build",
                                           wxDefaultPosition, wxDefaultSize, wxALIGN_CENTER_HORIZONTAL);
    b_apptitleSizer->Add(build, 0, wxALIGN_CENTER | wxLEFT | wxRIGHT | wxTOP, 5);
    wxStaticText* lib = new wxStaticText(d, wxID_ANY, "React 18.3.1\nPlatform: Linux x86_64",
                                         wxDefaultPosition, wxDefaultSize, wxALIGN_CENTER_HORIZONTAL);
    b_apptitleSizer->Add(lib, 0, wxALIGN_CENTER | wxLEFT | wxRIGHT | wxTOP, 5);
    bSizerTitle->Add(b_apptitleSizer, 10, wxALL | wxEXPAND, 5);
    wxBoxSizer* bSizer5 = new wxBoxSizer(wxVERTICAL);
    bSizer5->Add(0, 0, 1, wxEXPAND, 5);
    wxButton* copy = new wxButton(d, wxID_COPY, "&Copy Version Info");
    bSizer5->Add(copy, 0, wxALL | wxEXPAND, 5);
    wxButton* bug = new wxButton(d, wxID_COPY, "&Report Bug");
    bSizer5->Add(bug, 0, wxALL | wxEXPAND, 5);
    bSizer5->Add(0, 0, 1, wxEXPAND, 5);
    bSizerTitle->Add(bSizer5, 0, wxEXPAND, 10);
    bSizerTitle->Add(0, 0, 1, wxEXPAND, 5);
    bSizerMain->Add(bSizerTitle, 0, wxEXPAND, 5);
    wxNotebook* nb = new wxNotebook(d, wxID_ANY);
    nb->SetMinSize(wxSize(750, 350));
    wxImageList* il = new wxImageList(16, 16);
    wxBitmap ib(16, 16);
    for (int i = 0; i < 9; i++) il->Add(ib);
    nb->AssignImageList(il);
    const char* caps[] = {"About", "Version", "Developers", "Doc Writers", "Librarians",
                          "Artists", "Translators", "Packagers", "License"};
    wxWindow* page0 = nullptr;
    wxHtmlWindow* html0 = nullptr;
    for (int i = 0; i < 9; i++) {
      wxPanel* p = new wxPanel(nb, wxID_ANY);
      wxBoxSizer* s = new wxBoxSizer(wxVERTICAL);
      wxHtmlWindow* h = new wxHtmlWindow(p, wxID_ANY);
      h->SetPage("<p><b><u>Description</u></b></p>");
      s->Add(h, 1, wxEXPAND, 0);
      p->SetSizer(s);
      nb->AddPage(p, caps[i], false, i);
      if (i == 0) { page0 = p; html0 = h; }
    }
    bSizerMain->Add(nb, 2, wxEXPAND | wxALL, 5);
    wxBoxSizer* bSizerButtons = new wxBoxSizer(wxHORIZONTAL);
    wxButton* ok = new wxButton(d, wxID_OK, "&OK");
    bSizerButtons->Add(ok, 0, wxALL, 5);
    bSizerMain->Add(bSizerButtons, 0, wxALIGN_RIGHT | wxRIGHT | wxLEFT, 5);
    d->SetSizer(bSizerMain);
    d->Layout();
    bSizerMain->SetSizeHints(d);
    d->Show();
    CallAfter([=] {
      wxYield();
      dump("dialog-client", d, d);
      printf("client-size   w=%d h=%d\n", d->GetClientSize().x, d->GetClientSize().y);
      dump("bitmapApp", m_bitmapApp, d);
      dump("title", title, d);
      dump("build", build, d);
      dump("lib", lib, d);
      dump("copy", copy, d);
      dump("bug", bug, d);
      dump("notebook", nb, d);
      dump("page0", page0, d);
      dump("html0", html0, d);
      dump("ok", ok, d);
      // The tab strip: GtkNotebook's tab widgets, each an hbox (image, label).
      GtkNotebook* gnb = GTK_NOTEBOOK(nb->GetHandle());
      for (int i = 0; i < 3; i++) {
        GtkWidget* tab = gtk_notebook_get_tab_label(gnb, gtk_notebook_get_nth_page(gnb, i));
        GtkAllocation a; gtk_widget_get_allocation(tab, &a);
        printf("tab%d box x=%d y=%d w=%d h=%d spacing=%d\n", i, a.x, a.y, a.width, a.height,
               GTK_IS_BOX(tab) ? gtk_box_get_spacing(GTK_BOX(tab)) : -1);
        if (GTK_IS_CONTAINER(tab)) {
          GList* kids = gtk_container_get_children(GTK_CONTAINER(tab));
          for (GList* k = kids; k; k = k->next) {
            GtkAllocation c; gtk_widget_get_allocation(GTK_WIDGET(k->data), &c);
            guint pad = 0; gboolean ex, fi;
            gtk_box_query_child_packing(GTK_BOX(tab), GTK_WIDGET(k->data), &ex, &fi, &pad, nullptr);
            printf("   %s x=%d y=%d w=%d h=%d pad=%u\n", G_OBJECT_TYPE_NAME(k->data), c.x, c.y, c.width, c.height, pad);
          }
          g_list_free(kids);
        }
      }
      GtkAllocation na; gtk_widget_get_allocation(GTK_WIDGET(gnb), &na);
      printf("notebook-alloc x=%d y=%d w=%d h=%d\n", na.x, na.y, na.width, na.height);
      GtkAllocation pa; gtk_widget_get_allocation(gtk_notebook_get_nth_page(gnb, 0), &pa);
      printf("page0-alloc x=%d y=%d w=%d h=%d\n", pa.x, pa.y, pa.width, pa.height);
      {
        // The frame icon DIALOG_ABOUT shows is aParent->GetIcon(): a frame's
        // SetIcons() bundle (pcb_edit_frame.cpp:253-265 adds 48, 128, 256, 32
        // and 16), and GetIcon() asks the bundle for wxDefaultSize.
        wxIconBundle bundle;
        for (int sz : {48, 128, 256, 32, 16}) {
          wxBitmap b(sz, sz);
          wxIcon ic; ic.CopyFromBitmap(b); bundle.AddIcon(ic);
        }
        wxFrame* fr = new wxFrame(nullptr, wxID_ANY, "f");
        fr->SetIcons(bundle);
        wxIcon got = fr->GetIcon();
        printf("frame-icon w=%d h=%d  wxSYS_ICON_X=%d\n", got.GetWidth(), got.GetHeight(),
               wxSystemSettings::GetMetric(wxSYS_ICON_X));
        fr->Destroy();
      }
      wxFont f = html0->GetFont();
      printf("font %s %d\n", (const char*)f.GetFaceName().utf8_str(), f.GetPointSize());
      {
        // The window's own pixels, for the arrow geometry: a GTK offscreen
        // grab of the toplevel, not a desktop screenshot.
        GdkWindow* gw = gtk_widget_get_window(GTK_WIDGET(d->GetHandle()));
        int ww = gdk_window_get_width(gw), wh = gdk_window_get_height(gw);
        GdkPixbuf* pb = gdk_pixbuf_get_from_window(gw, 0, 0, ww, wh);
        if (pb) { gdk_pixbuf_save(pb, "/home/akshay/dialog_about_probe.png", "png", nullptr, NULL); printf("saved %dx%d\n", ww, wh); }
      }
      ExitMainLoop();
    });
    return true;
  }
};
wxIMPLEMENT_APP(App);

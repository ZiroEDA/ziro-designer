// A wxStaticBoxSizer's own insets on this GTK theme: a checkbox added with no
// border, and where wx puts it inside the box. `.ze-sbox` in shell.css states
// these, so every dialog's static boxes come from one rule instead of each
// restating a padding.
//
//   g++ -Wno-deprecated-declarations -o staticbox_inset_probe staticbox_inset_probe.cpp \
//       $(wx-config --cxxflags --libs core,base)
//   env -i DISPLAY=:0 GDK_BACKEND=x11 HOME=$HOME PATH=/usr/bin:/bin \
//       XDG_RUNTIME_DIR=/run/user/1000 XAUTHORITY=$XAUTHORITY ./staticbox_inset_probe
#include <wx/wx.h>
#include <cstdio>
#include <gtk/gtk.h>

class App : public wxApp {
 public:
  bool OnInit() override {
    wxDialog* d = new wxDialog(nullptr, wxID_ANY, "probe");
    wxBoxSizer* top = new wxBoxSizer(wxVERTICAL);
    wxStaticBoxSizer* sb = new wxStaticBoxSizer(new wxStaticBox(d, wxID_ANY, "Options"), wxVERTICAL);
    wxCheckBox* c = new wxCheckBox(sb->GetStaticBox(), wxID_ANY, "Print drawing sheet");
    sb->Add(c, 0, 0, 0);
    top->Add(sb, 0, 0, 0);
    d->SetSizer(top);
    top->Fit(d);
    d->Show();
    CallAfter([=] {
      wxYield();
      wxStaticBox* box = sb->GetStaticBox();
      wxPoint bp = box->GetPosition();
      wxSize bs = box->GetSize();
      wxPoint cp = c->GetPosition();  // relative to its parent, the box
      wxSize cs = c->GetSize();
      int top_, other;
      box->GetBordersForSizer(&top_, &other);
      printf("box x=%d y=%d w=%d h=%d\n", bp.x, bp.y, bs.x, bs.y);
      printf("child-in-box x=%d y=%d w=%d h=%d\n", cp.x, cp.y, cs.x, cs.y);
      printf("inset left=%d top=%d right=%d bottom=%d\n", cp.x, cp.y, bs.x - cp.x - cs.x,
             bs.y - cp.y - cs.y);
      printf("GetBordersForSizer top=%d other=%d\n", top_, other);
      printf("label-font %s %d\n", (const char*)box->GetFont().GetFaceName().utf8_str(),
             box->GetFont().GetPointSize());
      // The theme's own drawing, after it has painted: is there a frame line?
      wxTimer* t = new wxTimer();
      t->Bind(wxEVT_TIMER, [=](wxTimerEvent&) {
        GdkWindow* gw = gtk_widget_get_window(GTK_WIDGET(d->GetHandle()));
        int ww = gdk_window_get_width(gw), wh = gdk_window_get_height(gw);
        GdkPixbuf* pb = gdk_pixbuf_get_from_window(gw, 0, 0, ww, wh);
        if (pb) {
          gdk_pixbuf_save(pb, "/home/akshay/staticbox_probe.png", "png", nullptr, NULL);
          printf("saved %dx%d\n", ww, wh);
        }
        ExitMainLoop();
      });
      t->StartOnce(800);
    });
    return true;
  }
};
wxIMPLEMENT_APP(App);

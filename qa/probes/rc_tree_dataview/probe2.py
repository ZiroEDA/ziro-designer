# wxSYS_COLOUR_LISTBOXTEXT, which RC_TREE_MODEL::GetAttr darkens for an
# excluded row (common/rc_item.cpp:576-593).
import wx
app = wx.App(False)
c = wx.SystemSettings.GetColour(wx.SYS_COLOUR_LISTBOXTEXT)
r, g, b = c.Red() / 255.0, c.Green() / 255.0, c.Blue() / 255.0
print("LISTBOXTEXT #%02x%02x%02x" % (c.Red(), c.Green(), c.Blue()))
# COLOR4D::GetBrightness: the weighted W3C formula with KiCad's coefficients
brightness = r * 0.299 + g * 0.587 + b * 0.117
print("BRIGHTNESS %.4f" % brightness)
for name, factor in (("heading", 50), ("child", 60)):
    ialpha = int(brightness * factor)
    # wxColourBase::ChangeLightness with ialpha < 100 blends toward black
    alpha = 1.0 + (ialpha - 100.0) / 100.0
    out = wx.Colour(int(c.Red() * alpha), int(c.Green() * alpha), int(c.Blue() * alpha))
    print("EXCLUDED %-8s ialpha=%d -> #%02x%02x%02x" % (name, ialpha, out.Red(), out.Green(), out.Blue()))

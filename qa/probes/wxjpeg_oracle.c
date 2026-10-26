/* qa/probes: decodes a JPEG exactly as wx 3.2.4's wxJPEGHandler::LoadFile does (imagjpeg.cpp:235-337),
 * against the system libjpeg-turbo KiCad links, and writes "W H JFIF UNIT X Y\n" + raw RGB to stdout.
 * The source is libjpeg's stdio one, not wx's stream one; both insert a fake EOI at the end of the data,
 * which is all a truncated file sees of the difference. */
#include <stdio.h>
#include <stdlib.h>
#include <jpeglib.h>
static void wx_cmyk_to_rgb(unsigned char *rgb, const unsigned char *cmyk) {
  /* imagjpeg.cpp wx_cmyk_to_rgb */
  int k = 255 - cmyk[3]; int k2 = cmyk[3]; int c;
  c = k + k2 * (255 - cmyk[0]) / 255; rgb[0] = (unsigned char)((c > 255) ? 0 : (255 - c));
  c = k + k2 * (255 - cmyk[1]) / 255; rgb[1] = (unsigned char)((c > 255) ? 0 : (255 - c));
  c = k + k2 * (255 - cmyk[2]) / 255; rgb[2] = (unsigned char)((c > 255) ? 0 : (255 - c));
}
int main(int argc, char **argv) {
  FILE *f = fopen(argv[1], "rb"); if (!f) return 2;
  struct jpeg_decompress_struct cinfo; struct jpeg_error_mgr jerr;
  cinfo.err = jpeg_std_error(&jerr); jpeg_create_decompress(&cinfo); jpeg_stdio_src(&cinfo, f);
  jpeg_read_header(&cinfo, TRUE);
  int bpp;
  if (cinfo.out_color_space == JCS_CMYK || cinfo.out_color_space == JCS_YCCK) { cinfo.out_color_space = JCS_CMYK; bpp = 4; }
  else { cinfo.out_color_space = JCS_RGB; bpp = 3; }
  jpeg_start_decompress(&cinfo);
  unsigned w = cinfo.output_width, h = cinfo.output_height;
  unsigned char *row = malloc(w * bpp), *rgb = malloc(w * 3);
  /* the size, then what wx turns into the resolution options: saw_JFIF, unit, X, Y */
  printf("%u %u %d %d %d %d\n", w, h, cinfo.saw_JFIF_marker, cinfo.density_unit, cinfo.X_density, cinfo.Y_density);
  while (cinfo.output_scanline < h) {
    jpeg_read_scanlines(&cinfo, &row, 1);
    if (bpp == 3) fwrite(row, 1, w * 3, stdout);
    else { for (unsigned i = 0; i < w; i++) wx_cmyk_to_rgb(rgb + 3 * i, row + 4 * i); fwrite(rgb, 1, w * 3, stdout); }
  }
  jpeg_finish_decompress(&cinfo); jpeg_destroy_decompress(&cinfo); return 0;
}

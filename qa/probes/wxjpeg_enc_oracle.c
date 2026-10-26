/* qa/probes: encodes raw RGB exactly as wx 3.2.4's wxJPEGHandler::SaveFile does (imagjpeg.cpp:400),
 * against the system libjpeg-turbo KiCad links, writing the JPEG stream to stdout.
 *   wxjpeg_enc_oracle W H in.rgb [quality|-1 [resUnit resX resY]]
 * quality -1 is "no wxIMAGE_OPTION_QUALITY"; resUnit 0 is wxIMAGE_RESOLUTION_NONE. */
#include <stdio.h>
#include <stdlib.h>
#include <jpeglib.h>
int main(int argc, char **argv) {
  int w = atoi(argv[1]), h = atoi(argv[2]);
  int quality = argc > 4 ? atoi(argv[4]) : -1;
  int unit = argc > 7 ? atoi(argv[5]) : 0, rx = argc > 7 ? atoi(argv[6]) : 0, ry = argc > 7 ? atoi(argv[7]) : 0;
  FILE *in = fopen(argv[3], "rb"); unsigned char *buf = malloc((size_t)w * h * 3);
  if (!in || fread(buf, 1, (size_t)w * h * 3, in) != (size_t)w * h * 3) return 3;
  struct jpeg_compress_struct cinfo; struct jpeg_error_mgr jerr;
  cinfo.err = jpeg_std_error(&jerr); jpeg_create_compress(&cinfo); jpeg_stdio_dest(&cinfo, stdout);
  cinfo.image_width = w; cinfo.image_height = h; cinfo.input_components = 3; cinfo.in_color_space = JCS_RGB;
  jpeg_set_defaults(&cinfo);
  if (quality >= 0) jpeg_set_quality(&cinfo, quality, TRUE);
  if (unit != 0) { cinfo.X_density = rx; cinfo.Y_density = ry; cinfo.density_unit = unit; }
  jpeg_start_compress(&cinfo, TRUE);
  while (cinfo.next_scanline < cinfo.image_height) { JSAMPROW r = &buf[cinfo.next_scanline * w * 3]; jpeg_write_scanlines(&cinfo, &r, 1); }
  jpeg_finish_compress(&cinfo); jpeg_destroy_compress(&cinfo); return 0;
}

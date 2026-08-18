# bitmap2component reference output

These files were **written by KiCad 10.0.5's own `bitmap2component`**, not by
us: the installed `/usr/bin/bitmap2component` was launched on this machine,
driven through its GUI (load image, pick format, Export to File…), and the
files it saved were copied here unedited.

They are the ground truth `image_converter.test.ts` compares our engine
against, because every defect in this area is a digit in a coordinate that no
screenshot and no round-trip test can see.

| file | source bitmap | Output Size |
| --- | --- | --- |
| `kicad_square24_300dpi.kicad_mod` | 24×24 px, black square filling `[6,18)²` | 2.0 mm (native, 300 DPI) |
| `kicad_square24_300dpi.kicad_sym` | the same | the same |
| `kicad_square24_2.1mm.kicad_mod` | the same | **2.1 mm**, i.e. 290 DPI after `int` truncation of 290.2857 |
| `kicad_ring30_300dpi.kicad_mod` | 30×30 px, `[4,26)²` filled with `[11,19)²` punched out | 2.5 mm (native, 300 DPI) |
| `kicad_twoblob_300dpi.kicad_wks` | 40×20 px, two 8×10 blobs at x∈[4,12) and x∈[28,36) | 3.4 × 1.7 mm (native, 300 DPI) |
| `kicad_twoblob_300dpi.ps` | the same | the same |
| `kicad_blank10_300dpi.kicad_mod` | 10×10 px, all white | native |

The threshold was left at the default 50 and Negative off throughout. The
blank bitmap also raised KiCad's `Errors` box, reading
*"No shape in black and white image to convert: no outline created."*, and the
file below was written anyway — which is why our `convert` reports **and**
returns the artwork.

Point **order** is not part of the comparison: KiCad's coordinates come out of
`SHAPE_POLY_SET::Fracture`, which normalises winding and start vertex, and we
bridge holes ourselves. The point **set**, the scale and the text format are.

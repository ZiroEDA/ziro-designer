`pdf_text.pdf` is what `kicad-cli pcb export pdf --black-and-white
--mode-single -l F.SilkS -o pdf_text.pdf pdf_text.kicad_pcb` (KiCad 10.0.6)
writes. `qa/unittests/common/plotters/pdf_text_oracle.test.ts` plots the same
texts through BRDITEMS_PLOTTER -> PDF_PLOTTER::Text and compares every PDF
object, streams inflated, except the Info dictionary (producer and clock).
Regenerate with the command above; never edit by hand.

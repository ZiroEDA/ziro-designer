# Measuring a dialog's real layout

`qa/unittests` renders our dialogs in **happy-dom, which has no layout engine**.
Every `getBoundingClientRect()` there is zero. That is why a whole class of bug
is invisible to the suite: the CSS can state exactly the right numbers, every
assertion can pass, and the dialog can still open at twice its width in Chrome.

Symbol Properties hit this. `table-layout: fixed` on the Pin Functions grid
inherits `width: 100%` from `.ze-grid`; a percentage width inside
`.ze-modal`'s `width: max-content` has nothing to resolve against; Chrome
answers that circularity with a max-content of **1000000px**; the modal clamps
to `max-width: 92vw` and the dialog opens 1780 wide instead of 884 — on every
tab, because all three notebook pages share one grid cell. Four sessions in a
row read the CSS, agreed it matched the C++, and closed the question.

## The harness

Render the real component, dump its markup, and let a real browser lay it out.

1. Put a throwaway test under `qa/unittests/designer/` that renders the dialog
   and writes `document.body.innerHTML` to a file, wrapped as:

       <link rel="stylesheet" href="shell.css">
       <div class="ze-app"> …dumped markup… </div>

   Delete it as soon as it has run — this checkout is shared, and a stray test
   file gets swept into someone else's `git add -A`.

2. Copy `designer/src/ui/shell.css` next to it and serve the directory over
   HTTP (`python3 -m http.server`). **Not** `file://` — the browser tooling
   refuses those. Use a port that is not the dev server's.

3. Measure in the page. The three questions worth asking:

   - **which page forces the width** — hide each `.ze-symprops-page` in turn
     (`display: none`) and read the modal's width without it;
   - **what a table actually wants** — clone it into
     `position:absolute; visibility:hidden; width:max-content` and read the
     clone. A five-figure answer is the circularity above;
   - **the invariant** — move `data-nbhide` from page to page and confirm the
     modal's width does not change. A wxNotebook is the size of its largest
     page, so upstream's dialog does not move a pixel when you switch tabs.

To compare against the committed state, `git show HEAD:designer/src/ui/shell.css`
into a second file and serve a copy of the page that links it. That is how the
1000000px was localised to one new rule rather than blamed on the app.

## What the suite can and cannot pin

Declarations, yes — `qa/unittests/designer/symbol_properties_dialog.test.tsx`
asserts the pin grid's stated widths and heights the way
`change_symbols_chrome.test.ts` does. Resolved layout, no. So when a rule's
correctness depends on how it *resolves* rather than on what it says, measure it
here and put the number in the CSS comment with a `[px]` tag.

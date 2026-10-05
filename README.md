# Tools

Small standalone tools, hosted as GitHub Pages. Landing page lists everything: https://Hassang97.github.io/tools/

## Intrinsic Value Calculator

A DCF fair-value calculator (owners' earnings, blended perpetuity / Year-15
terminal-multiple valuation, IV8–IV15 hurdle rates) with plain-English field
explanations and Yahoo Finance lookup guidance for every input. Optional ticker
lookup fills cash flow, reported SBC, shares, and price. Growth and dilution
assumptions stay manual, and every fetched value can be edited.

Run the calculation regression checks with `node tests/intrinsic-value-calculator.test.mjs`.

Live: https://Hassang97.github.io/tools/intrinsic-value-calculator/

---

To add a new tool: create a folder at the repo root (e.g. `some-tool/`) with
its own `index.html`, then add a card for it to the root `index.html`.

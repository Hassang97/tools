# Tools

Small standalone tools, hosted as GitHub Pages. Landing page lists everything: https://Hassang97.github.io/tools/

## Intrinsic Value Calculator

A DCF calculator (owners' earnings from net income, blended perpetuity / Year-15
terminal-multiple valuation, IV8–IV15 required returns) with plain-English
hover definitions and formulas, and links to each figure's source page. A ticker
lookup (or a `?t=TICKER` link) fills price, net income, reported SBC, shares and
net cash; growth is the only figure left to enter, and every fetched value can
be edited. The lookup uses a shared Financial Modeling Prep key; visitors can
supply their own.

Run the calculation regression checks with `node tests/intrinsic-value-calculator.test.mjs`.

Live: https://Hassang97.github.io/tools/intrinsic-value-calculator/

---

To add a new tool: create a folder at the repo root (e.g. `some-tool/`) with
its own `index.html`, then add a card for it to the root `index.html`.

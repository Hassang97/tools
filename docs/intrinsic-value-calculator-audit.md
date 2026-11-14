# Intrinsic Value Calculator: audit against Burry's method

Audit date: 2026-11-13. Code audited: `intrinsic-value-calculator/index.html` at commit `d01fdf0`.
No code was changed by this audit. Line numbers refer to that commit.

## Sources checked

Michael Burry, *Cassandra Unchained* (Substack):

- *Foundations: The Tragic Algebra of Stock-Based Compensation* (text, whiteboard derivation, Nvidia tables)
- *AP SBC: The Tragic Algebra Recurrence* (text, formula cards, variable glossary, Alphabet and Meta tables)
- *D'AI of the Triffids: Office Software Triage* (the IV15 method)
- *Software & Payments Stocks Part II*, *The Payments Giants*, *lululemon (LULU): Where is John Galt?*,
  *Capital Cycle IQ*, *Short Thoughts July 15, 2026*, *Trading Post 9/4/2026*
- *Build-A-Bear (BBW) Part II: The Scion Capital Analyst Template and the All Map*

Not checked: the Salesforce table and remaining charts in *AP SBC*, the NDX master table PDF,
and live provider data (the API key was rate-limited during the audit).

## Priority scale

- **P0**: gives a wrong answer silently
- **P1**: materially wrong or broken in common use
- **P2**: misleading, or wrong only in less common use
- **P3**: small gap or inaccuracy
- **P4**: polish

## Summary

| ID | Priority | Finding |
|---|---|---|
| A1 | P0 | Share-count change is counted twice, and buybacks are free |
| A2 | P0 | IV15 is presented as "fair value" |
| A3 | P1 | Net cash per share is missing |
| A4 | P1 | Ticker lookup fails on a shared, public, rate-limited key |
| A5 | P2 | No implied return at the current price |
| A6 | P2 | Perpetuity leg explodes without warning |
| A7 | P2 | Growth tooltip points to the wrong anchor |
| A8 | P2 | Tooltips open off-screen after scrolling |
| A9 | P2 | Provider data risks not yet verified |
| A10 | P3 | No IV18 or IV20 |
| A11 | P3 | The 0.8x "Conservative Buy Target" is not Burry's |
| A12 | P3 | No formula or filing guidance for the cash cost of SBC |
| A13 | P3 | Tests are not pinned to Burry's published numbers |
| A14 | P4 | Single-stage growth cannot model inflecting companies |
| A15 | P4 | Cosmetic and minor items |

## Verified correct (keep as is)

- **Dilution formula.** `calculatePerpetuityIV` (line 694) computes
  `CF0(1+g) / [(1+y)(1+d) - (1+g)]`. The whiteboard derivation in *Tragic Algebra* ends at exactly
  this, with `CF1 = CF0(1+g)`. His examples reproduce: 20x with no dilution and 16.4x with 1%
  dilution (on next year's cash flow), an 18% value loss at 1% dilution and about 50% at 5%.
- **Timing convention.** Entering trailing earnings and growing them one year is correct per that
  derivation. An earlier draft of this audit flagged it; that finding is withdrawn.
- **Owners' earnings.** `calculateOwnersEarnings` (line 741) is his `E_true = N + G - Ω`.
  Run against his tables, with `Ω = C + T(W + ΔS)/W`:

  | Case | Calculator | Burry |
  |---|---|---|
  | Alphabet 2016, 2019, 2024, 2025 | 76.1%, 98.8%, 88.2%, 88.1% of GAAP | same |
  | Meta 2018, 2022, 2024, 2025 | 84.4%, 110.7%, 76.4%, 64.3% of GAAP | same |
  | Alphabet 10-year pooled | 88.68% | 88.7% |
  | Meta 10-year pooled | 83.35% | 83.35% |
  | Nvidia 2018 to present | $113B | $114B (his rounding) |

- **Per-share basis.** He divides by ending shares (`EPS_true = E_true / S1`); the calculator uses
  current shares outstanding.
- **Hybrid structure.** A full model blended with the same model cut off at year 15 with a multiple
  on year-15 owners' earnings is how *Triffids* describes IV15.
- **Mature companies land in range.** Build-A-Bear with his $3.50 EPS, zero growth and an 8x exit
  multiple (audit assumptions) gives a 14.3% implied return at $25; he says about 14%. His IV15s
  for Paycom, Salesforce, Intuit, IBM, Autodesk and Adobe correspond to 1-7% growth here.
- **Leaving the cash cost of SBC manual.** His Capital IQ and Bloomberg screenshots show Nvidia's
  withholding taxes labelled as stock repurchases in years with no buybacks. Do not auto-fill Ω
  from a data provider.

## Findings

### A1 (P0): Share-count change is counted twice, and buybacks are free

Two problems with one root: the model does not define what cash reaches the owner.

- **Double count.** Ω already contains the share-count change in both directions. His glossary:
  "If ΔS < 0, net retirement (reduces Ω). If ΔS > 0, net dilution (increases Ω)." He also says to
  account for SBC *either* through the cash set aside to offset dilution *or* through the stake
  being whittled down, and "I do not explicitly call out share buybacks here because the Tragic
  Algebra that leads to owners' earnings already accounts for it." Entering the true Ω plus a
  non-zero dilution rate counts the same share change twice.
- **Free buybacks.** A negative dilution rate shrinks the share count, but the cash spent on those
  buybacks is never deducted from the cash flows. At 5% growth and a 15x multiple, IV15 is 11.65x
  earnings at 0% dilution, 14.11x at -2% (+21%) and 21.67x at -6% (+86%).

Proposed fix:

- Make the two SBC routes explicit and mutually exclusive: (a) true cash cost Ω with dilution
  fixed at 0, or (b) no cash-cost adjustment with an explicit dilution rate (his pure-dilution case).
- For net buybacks, deduct the buyback spend from distributable cash (or model buybacks as a use
  of owners' earnings at an assumed price) so a shrinking share count is paid for.
- Until then, warn when the cash cost differs from reported SBC and dilution is non-zero.

### A2 (P0): IV15 is presented as "fair value"

Burry: "IV15 is not intrinsic value." Intrinsic value is around IV8-IV10, and "generally,
intrinsic value for companies sits between 1.5 and 2.25x IV15."

- The badge (lines 825-835) says "Trading X% below/above fair value" against whichever rate is
  selected, IV15 by default. A stock at 1.5x IV15 reads as 50% overvalued when he would call it
  roughly fairly valued.
- Header (line 501), main tooltip (line 609), glossary "P/IV" (line 661) and "IV8 / IV10 / IV12 /
  IV15" (line 657) all use "fair value" for every hurdle.
- Reference labels (lines 624-636): "IV8 (Fair Value)" is close; "IV10 (Standard)" and
  "IV12 (Premium)" mean nothing in his framework; "IV15 (Fat Pitch)" conflates a price level with
  his All Map zone, which also weighs business quality ("not all IV18s are fat pitches",
  "VEEV is a fat pitch, but still not IV15").

Proposed fix:

- Badge: "X% below/above IV15" (the price for a 15% return), and separately show where the price
  sits against the IV8-IV10 intrinsic value range.
- Labels: IV8 and IV10 as "intrinsic value range", IV12 and IV15 as return targets. Drop
  "Standard", "Premium" and "Fat Pitch" from the boxes; keep Fat Pitch in the glossary with his
  definition.

### A3 (P1): Net cash per share is missing

*Triffids*: "First, the calculation of owners' earnings... Then the calculation of net cash per
share." It was added in `16b3e7f` and removed in `30a67dd`. Without it there is no adjustment for
cash, debt, float or purchase obligations, and his "negative IV15" (Oracle) cannot occur. Material
examples: lululemon $1.5B net cash on 108M shares, HubSpot $1.8B net cash.

Proposed fix: restore a net cash (or net debt) per share input added to both legs, allow a
negative result, and note that interest income on excess cash should then be excluded from
owners' earnings.

### A4 (P1): Ticker lookup fails on a shared, public, rate-limited key

During the audit the provider returned HTTP 429 "Limit Reach" on the first call. The key is in the
page source (line 854) and shared by every visitor; each lookup spends three calls. The page shows
only "Ticker lookup failed. Try again" (line 928).

Proposed fix: detect 429 and say the daily limit is reached; consider a user-supplied key, a small
proxy with caching, or dropping to one call per lookup.

### A5 (P2): No implied return at the current price

He quotes this constantly ("IVB"): 8.6% for Salesforce, 12.8% for monday.com, about 14% for
Build-A-Bear, 11.5% for Fiserv. Proposed fix: solve for the rate at which the hybrid value equals
the current price and show it next to the badge.

### A6 (P2): Perpetuity leg explodes without warning

Growth of 14.9% against a 15% hurdle gives 1,149x earnings. At 5% growth the perpetuity leg's IV8
is 3.3x its IV15, outside his 1.5-2.25x band. Burry: "if you are getting near infinity present
value, you are likely too optimistic about that growth rate." Only reachable when the perpetuity
weight is above the 0% default. Proposed fix: warn when growth is within a few points of the
hurdle, or use a separate, capped terminal growth rate for the perpetuity leg.

### A7 (P2): Growth tooltip points to the wrong anchor

Line 567 suggests 3-5 year revenue growth or analyst long-term estimates as a starting point for
a rate applied forever. Burry: "A company cannot outgrow its ROIC forever... ROIC... is the
lodestar for growth", and he uses revenue history only as a check. Proposed fix: reword the
tooltip around return on invested capital and a conservative durable rate.

### A8 (P2): Tooltips open off-screen after scrolling

`positionAllTooltips` (line 986) decides the up/down flip once at load and on resize, using each
icon's viewport position at that moment. In headless Chromium at 1280x800 and at phone width, all
16 tooltips opened above the viewport once their icon was scrolled near the top. The "Reference
Values" tooltip is also clipped by the container (`overflow: hidden`, line 45). Proposed fix:
recompute placement on hover/focus (or on scroll), and clamp against the container.

### A9 (P2): Provider data risks not yet verified

Could not be tested because of A4. Each could be P0 if real:

- Foreign filers: net income may be in the reporting currency against a USD price (e.g. TSM).
- Dual-class companies: whether `outstandingShares` is per class or total (GOOGL, BRK-B).
- Net income is read from the cash-flow statement (line 903), which can include minority interests.
- Class tickers: `BRK.B` vs `BRK-B`.

### A10 (P3): No IV18 or IV20

He uses both ("LULU now joins Adobe as two stocks at about IV18"; IV12 and IV18 on his ranking
table). The slider stops at 15 (line 530) and the code comment at line 844 says they are unused.

### A11 (P3): The 0.8x "Conservative Buy Target" is not Burry's

No 20% haircut appears in the articles; the 15% hurdle is his margin of safety. Proposed fix:
remove it or label it clearly as the site's own addition.

### A12 (P3): No formula or filing guidance for the cash cost of SBC

The tooltip (line 552) offers only reported SBC as a stand-in. Proposed fix: an optional helper
with his inputs:

- `Ω = C + T(W + ΔS)/W`
- `T`: open-market repurchase dollars only, excluding withheld-share amounts
- `W`: shares repurchased under the program only
- `ΔS`: ending minus starting shares, excluding M&A issuance, offerings and conversions
- `C`: withholding tax paid on vesting, net of option-exercise and employee-purchase-plan proceeds
- No buybacks: `V = ΔS x average market price`
- Sources: cash-flow statement (financing), repurchase footnote, statement of shareholders' equity
- He recommends about 10 years pooled; single years swing widely (Meta: 64.3% to 110.7%)

Also fix the glossary entry (line 653), which omits that `C` is net of employee proceeds.

### A13 (P3): Tests are not pinned to Burry's published numbers

- Add fixtures: 20x / 16.4x on next-year cash flow, 18% and 52% value loss, and the Alphabet,
  Meta and Nvidia rows above.
- `calculate()` (validation and badge logic) has no tests.
- The "August example" fixtures (`(2887 - 95) / 413`) use the abandoned operating-cash-flow
  definition.

### A14 (P4): Single-stage growth cannot model inflecting companies

He uses multi-stage models and adds a "Stage 0" for hypergrowth. ServiceNow's IV15 is about 76x
current owners' earnings (24% growth for 15 years here); Zscaler has negative owners' earnings
and a $21.62 IV15, where the calculator shows "N/A". A large build; a note on the page stating the
limitation is enough for now.

### A15 (P4): Cosmetic and minor items

- Perpetuity weight tooltip says "start at 50/50" (line 589); the default is 0% (line 592).
- Header says "IV8 to IV15" (line 501); the slider runs 5-15.
- Zero earnings shows "N/A (neg. earnings)" (line 732).
- Dilution of -99% returns about 4e30 with no guard.
- Only the ticker label is tied to its input (`for`); the rest are not associated.

## Status

- **A1: fixed.** A "How To Charge For SBC" selector makes the two routes mutually exclusive: cash
  cost with the share count held flat, or a dilution rate with no cash cost. A negative dilution
  rate is rejected, following "the Tragic Algebra that leads to owners' earnings already accounts
  for it": buybacks are not counted again through the share count.
- **A2: fixed.** The badge reads "X% below/above IV15", a second line places the price against the
  IV8 to IV10 intrinsic value range and gives the price as a multiple of IV15 beside his 1.5 to
  2.25x band. The page adds no verdict or colour of its own, and no hurdle is called "fair value".
- **A11: fixed.** The 0.8x "Conservative Buy Target" is removed.
- **A3: fixed.** Optional net cash ($M, negative for net debt) is added per share to both legs and
  every reference value; a negative IV is displayed. It is a manual input, not auto-filled.
- **A4: partly fixed.** 429 (including the provider's 200-with-error form), 401/403 and 402 get
  their own messages; a lookup costs two calls instead of three (share count from market value /
  price, with the float endpoint as fallback); repeat lookups are cached for 15 minutes; visitors
  can use their own key, stored in their browser. The shared key is still public in the page
  source. The market-value share count has not been checked against live data because the shared
  key was at its limit; A9 remains open.

- **A3 update.** Net cash is now auto-filled from the latest balance sheet (cash and short-term
  investments minus total debt) as an editable starting value; float and purchase obligations
  are still the visitor's adjustment.
- **A7: fixed.** The growth hover quotes the ROIC limit and links to the company's ratios page.
- **A8: partly fixed.** Tooltip placement is measured each time one opens. Clipping by the
  container's `overflow: hidden` is unchanged.
- **A12: partly fixed.** The cash-cost hover gives `Ω = C + T(W + ΔS)/W` and the glossary notes
  that `C` is net of employee proceeds. No helper for computing it.
- **A15: partly fixed.** The "start at 50/50" and "IV8 to IV15" texts are gone.
- **Layout.** Every hover is a one-line definition plus the formula; each company figure links to
  its stockanalysis.com or Yahoo Finance page for the entered ticker; a lookup (button, Enter,
  leaving the field, or a `?t=TICKER` link) fills everything except growth, costing three calls.

## Suggested order

1. A2 (labels and badge): text-only, removes the inverted verdict.
2. A1 and A3 together: both redefine the cash flow to the owner.
3. A4, then A9 once the lookup works.
4. A5, A10, A12: small additions that bring the tool closer to how he reports results.
5. A13 alongside each change above.

# Decisions

## The problem as I framed it

A supplier answers an RFQ with a PDF or a block of email text. AI extracts the parts, quantities, prices and lead times into our data model, and **a person has to confirm the extraction is right before it is stored.** So the reviewer is really answering two questions per line:

1. *Did the AI read the vendor's reply correctly?* (extracted value vs. the email/PDF)
2. *Did the vendor give us what we asked for?* (quote vs. our RFQ)

The original UI answered neither. It was a long stacked form: 9 fields per quantity line, roughly 30 lines per vendor, with the source email in a separate pane and nothing connecting the two. The request itself (which parts, which quantity breaks) existed only as text in the outbound email, so "did they skip a break?" had to be worked out by reading two emails side by side. The "19/20 priced" badge on the inbox looked like a completeness signal, but it only counted lines the vendor chose to quote. A vendor that skipped half the requested breaks still showed 100%.

My design goal: **the reviewer should only have to look closely at the differences, and every difference should be one click from its evidence.**

## What I changed

**A review grid instead of a stacked form.** One row per quantity, grouped under each requested part. The part header shows *requested PN → quoted PN* and the requested quantities. Columns are generated from `LINE_FIELD_DEFS`, so any field added to the schema shows up without UI changes. Rarely changing product fields (COO, certs, hazmat, CAGE…) and line notes live in a compact, expandable Details panel. Nothing from the original form was removed. I hid the *Is Quoting?* column because a row only exists when the vendor quoted it, and the "Not quoted" status covers no-bids. Its data is untouched.

**Comparison against the RFQ (`review.ts`).** The requested parts and quantity breaks became first-class reference data. Each row is then classified:
- *Match*
- *Different PN*: a substitute with the same NSN
- *Qty not quoted*: a requested break with no price
- *Extra qty* / *Extra part*: not requested
- *Not quoted*: a no-bid
- *Missing data*
- *Price mismatch*: price ≠ qty × unit cost

The statuses map to four colours (matches / differs / not requested / missing or wrong). I picked plain-language labels after "missing break" proved confusing. A guide in the menu explains every status and what to do about it, so someone new to RFQs can use the page.

**Every row is linked to its evidence.**
- Clicking a row scrolls the email or PDF to that part and highlights it, with the exact quantity line emphasised. This works on any plain text, not one vendor's format.
- Request-related issues ("Qty 25 was not requested", "Requested qty 200 not quoted") are links. Clicking one highlights *our* RFQ line with the requested breaks, so the reviewer can see the discrepancy themselves rather than take the tool's word for it.
- Each email can be given its own highlight colour (e.g. our RFQ blue, their reply red), so jumping between the two stays readable when the formats look alike.

**Built for speed:**
- Gmail-style checkboxes: shift+click ticks the whole range, and a header checkbox ticks everything.
- ↑/↓ moves between rows and Enter confirms and advances.
- Confirmed rows fade out.
- Values are edited inline.
- *Add line* fills in a missed break. A trash icon with undo removes a line so it isn't submitted.
- Submit stays disabled until every row is confirmed.

**Follow-up email generated from the issues.** The seeded drafts asked vendors for things they had already sent (e.g. Heritage's payment terms) and missed most of the actual gaps. "Draft from issues" writes the follow-up from no-bids, missing breaks, alternates and unrequested parts. It does *not* re-ask for values the extraction missed: those are in the email, so the reviewer fixes them instead.

**Layout and preferences.**
- Dark theme.
- Resizable panes that can swap sides.
- The reply draft and quote header collapse to one line to give the source more room.
- A menu of per-viewer toggles: colour coding, optional columns, compact rows, hide/fade confirmed rows, jump-to-source, auto-advance.

**Bugs fixed along the way.**
- Part-status requests were re-fetched on every keystroke.
- Currency fields always showed `$`, even on the EUR quote.
- Opening an email jittered: nested height animations fought the scroll.
- The highlighted email couldn't be collapsed.
- Editing a header field reset which emails were open.

## What I deliberately didn't change

- **The persistence contract.** `data/state.json` and `PUT /api/state` are as they were. Review progress is one optional field, `Vendor.reviewedRows`, which travels through the existing PUT unchanged. Older state files still load.
- **The RFQ isn't stored in state.** It's the buyer's own reference data, not something the reviewer edits, and adding it to the fixed state shape would have bent the contract. It's derived from the seed constants. In production it would come from the RFQ record.
- **Server-side validation.** `/submit` still checks only required fields. The "everything confirmed" gate is client-side, which is the next thing I'd move to the server.
- **No real AI call.** The seeded values stand in for the extractor's output. The hard part of this task is the human review step, and I wanted the time there.
- **Per-viewer preferences use localStorage** (colours, layout, toggles), because they're conveniences and shouldn't change shared data.
- **The old `VendorProcessingForm.svelte` is left in place, unused.** I kept the diff focused on the new flow rather than spend time on cleanup.

## How I used AI

I used Claude Code throughout.

**What it did:**
- Read the codebase and found the data-level issues: the misleading "priced" count, the wrong follow-up drafts, the `$` on EUR, the refetch bug.
- Wrote nearly all of the code.
- Checked the comparison logic and the source-highlighting against the seed data with throwaway scripts. All 81 rows across the three vendors classify as expected and find their source text.

I also asked a second chatbot for an independent view of the layout, which confirmed the spreadsheet direction and pushed me toward "show exceptions, not every cell".

**What I decided:** the product framing and every UX call. Several times I overrode what the AI first built:
- **Clutter.** It added stock badges, filter tabs, a "Saved" pill and a lot of explanatory text. I cut it down repeatedly to what helps someone confirm a quote.
- **Losing data.** One pass dropped fields from the original form. I required that all original information stay, just in a denser layout.
- **Multi-select.** It built row-highlight selection. I wanted Gmail-style shift+click checkboxes, which match how reviewers already work.
- **Filters.** "Needs attention" and "Unconfirmed" were two tabs. I merged and then removed them in favour of a single "N left" count.
- **Missing features:** the colour-coding toggle and guide for non-experts, a collapsible reply draft, delete with undo, swappable panes, and per-email highlight colours all came from me using it and finding friction.

## Limitations and what I'd do next

- **Matching is a simple rule.** Parts match by exact PN, then same NSN means alternate, and everything else is extra. Real data would need fuzzy PN matching and a way for the reviewer to re-link a row to a different requested part.
- **Source finding is text search.** It assumes the PN appears in the source. The proper fix is for the extractor to return the exact text it read each value from, and for this UI to highlight that span directly. The UI is already built around that hand-off.
- **Confidence-driven review.** If the extractor scored its confidence per field, the grid could put low-confidence values first and let high-confidence matches be confirmed together.
- **Server-enforced review.** `/submit` should require every row confirmed, and record who confirmed what and when, as an audit trail.
- **Keep the corrections.** Every "AI said X, reviewer changed it to Y" is labelled data for measuring and improving extraction.

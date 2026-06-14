# FDE Interview Task — Vendor Quote Processing

A form for processing vendor RFQ responses, in two routes:

- `/` — inbox listing each vendor response on the RFQ.
- `/quote/[vendorId]` — detail view: email correspondence on the left, processing form on the right. ← / → switch vendors, Esc returns to the inbox.

## What's in the seed

Two vendor responses to one open RFQ for 10 parts at 3 quantity tiers each (30 lines per vendor):

- **Heritage Aero Supply** — replies inline in email with all pricing.
- **Apex Components LLC** — replies with a PDF quote attachment.

Each vendor has 6 fields per line. About 67% of values come pre-filled.

## Submit

When a vendor's processing is done, hit **Submit** in the detail header. That `POST`s `/api/quote/[vendorId]/submit`, the server validates required fields, and (on success) marks the vendor with a `submittedAt` timestamp that surfaces on the inbox.

## The task

Make this better.

The shape of `Line` in `src/lib/types.ts` is fixed. The persistence contract — `data/state.json` and `PUT /api/state` — is fixed. Everything else is yours: layout, components, libraries, routing, styling, API design beyond the two fixed pieces above.

## How we evaluate this

Two artifacts:

1. **The code.** Fork (use the "Use this template" button), work in your own repo, share the link when you're done.
2. **A `DECISIONS.md`** in the root of your repo. A few short sections: what you changed, what you deliberately didn't change, and why. We weight this as heavily as the code — it's the conversation we'll have on the follow-up call.

**Use whatever AI tools you want** — Claude, Cursor, Copilot, whatever your normal workflow is. We expect it. The follow-up call is a discussion about your decisions and process, not a fresh problem; bring strong opinions on what you reached for AI for and what you chose to write yourself.

Time budget: open-ended. Spending 20 doesn't help your odds — clarity beats completeness.

## Run

```bash
npm install
npm run dev
```

Bun works too: `bun install && bun run dev`. Node 20+ — `.nvmrc` pins 22.

Open <http://localhost:5173>. State persists to `data/state.json`; delete that file to reset to the seed.

```bash
npm run check    # svelte-check
npm run build    # production build (adapter-node)
npm run preview  # serve the production build
```

## Layout

```
src/
├── app.css, app.html
├── lib/
│   ├── types.ts                — Vendor, Product, Line, Email, AppState
│   ├── fields.ts               — FieldDef, FIELD_DEFS, makeEmptyLine
│   ├── seed.ts                 — 2 vendors, 10 parts × 3 tiers
│   ├── avatar.ts               — deterministic avatar colors / initials
│   ├── store.svelte.ts         — reactive store + debounced PUT /api/state, submit
│   ├── server/persistence.ts   — JSON file read/write (data/state.json)
│   └── components/
│       ├── EmailCorrespondence.svelte
│       ├── EmailThread.svelte
│       ├── PdfAttachment.svelte
│       ├── FieldInput.svelte
│       └── VendorProcessingForm.svelte
└── routes/
    ├── +layout.svelte
    ├── +error.svelte
    ├── +page.svelte                          — inbox
    ├── +page.server.ts                       — loads seed/persisted state
    ├── quote/[vendorId]/
    │   ├── +page.svelte                      — detail (email + form, ← / → nav)
    │   └── +page.server.ts
    └── api/
        ├── state/+server.ts                       — GET / PUT
        ├── quote/[vendorId]/submit/+server.ts     — POST
        └── parts/[partNumber]/status/+server.ts   — GET
```

## Data model

`Vendor → Product[] → Line[]`. A `Line` is one (part, qty) pair and owns every form field. Field metadata lives in `FIELD_DEFS`. Adding a field = add to `Line` + `FIELD_DEFS`, and it renders automatically.

## Persistence

`store.svelte.ts` debounces 350 ms and `PUT`s the full state to `/api/state`, which writes `data/state.json`. Loads go through `+page.server.ts → loadState()`. No DB, no migrations.

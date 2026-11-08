# ForgeERP — Closing the open audit items, 2026-11-08

Follow-up to `docs/FULL_RUNTIME_AUDIT_2026-11-08.md` (PR #17, verdict READY FOR
STAGING). That report left six items open (§17). This branch,
`feature/tenant-isolation-and-gaps`, closes five of them with tests that prove
it. The sixth, a rehearsal on the **real** live data, is ready to run but was not
executed, because copying production data out of the server was not
authorised in this session.

## 1. Result per open item

| # | Item (audit §17) | Status | Proof |
|---|---|---|---|
| 1 | Multi-company isolation | **Done** | `tests/tenant-isolation.mjs` 68/68; workflow suite P5 |
| 2 | Migrations on a staging copy of live data | **Rehearsed on a simulated live dump; real dump not run** | `scripts/staging-rehearsal.mjs` PASSED |
| 3 | UI: production receipt, advances, refunds, schedules, RFQ | **Done** | E2E 96/96 (3 viewports) |
| 4 | Payment-milestone allocation | **Done** | workflow suite, 14 milestone checks |
| 5 | Pagination of large payloads | **Done** | payload sizes below |
| 6 | Print / PDF untested | **Done — one real bug found and fixed** | E2E print checks + PDF text read back |

## 2. Multi-company isolation

- Migration `20261108120000_tenant_isolation`:
  - adds `companyId` to the 19 legacy root tables;
  - backfills it with the oldest operating company;
  - makes it NOT NULL (AuditLog stays nullable) and adds an FK to Company;
  - replaces the global unique keys (code, invoiceNo, woNo, …) with `(companyId, key)`, each created before the old key is dropped;
  - prefixes document counters with the organisation id.
- Runtime:
  - the Prisma client adds the session's organisation to every query on an organisation-owned model;
  - child models are scoped through their required parent;
  - a row created without an organisation is refused by the FK, because the default `''` matches no company;
  - a platform session is never treated as an operating organisation.
- Tests cover two organisations:
  - the same item and party codes in both, each with its own numbering series;
  - 22 cross-organisation read, update and cancel attempts, all 404 or 403;
  - an SQL cross-reference over 12 relations, with no row pointing into another organisation;
  - per-organisation suspension;
  - backup v5 restore keeps ownership.

Operational consequence: when the live database has more than one operating
company, the migration assigns all legacy rows to the oldest one. The
rehearsal script warns about this; confirm it before deploying.

## 3. Payment milestones, paging, performance

- Advances can be tagged to a sales order. Milestone status is **derived** on every change, so it cannot drift: collections are spread FIFO across the milestones. Collections are the paid amount of posted invoices against the order's challans, plus the unapplied part of tagged advances. The resulting status is PAID, PART_PAID, OVERDUE or PENDING. The finance dashboard reports orders whose collections exceed the schedule.
- `?paged=1` on the sales and purchase invoice lists returns rows, a total and a posted summary, with search.
- Lot and serial traceability aggregates in SQL, and the task list is capped and the UI says so.
- The stock summary is one `GROUP BY`.

| Measurement (10k stock rows, 2k invoices, 1k lots, 5k serials) | Before | After |
|---|---|---|
| Sales invoice list payload | ~1.1 MB | 60 KB (first page) |
| Traceability payload | ~3.1 MB | 181 KB |
| Dashboard | 775 ms | 151 ms |
| Stock summary | full ledger scan | 48 ms |

## 4. New screens

All three follow the same rules:

- status is shown as colour, icon and words;
- every list has an empty state that says what to do next;
- tap targets are 44 px on mobile;
- every money-moving action shows its impact first and asks for a reason where it reverses something.

- **Projects & Mfg → FG Receipts:**
  - a readiness board shows, per work order, why it cannot be received or closed yet (open tasks, no accepted FG, unsettled WIP);
  - a 4-step receipt wizard covers output, quantities and QC, batch, serials and parent lots, then review;
  - the review step shows the server-computed expected cost, actual cost, variance and WIP after posting, using the same function that posts, so the preview equals the posting;
  - a receipt can be cancelled after its impact is shown.
- **Accounting → Advances & Refunds:**
  - advances can be applied, tagged to an order and have an application reversed;
  - schedules are grouped by order, with reconciliation warnings;
  - credit or debit-note refunds, with a refund history;
  - each refund has a printable acknowledgement, and a refund can be cancelled with a reason.
- **Purchase → Procurement & Returns → RFQ & Comparison** (new backend, migration `20261108140000_rfq_supplier_quotes`, additive only):
  - an RFQ is created from an approved requisition's unordered quantity or from manual lines, and only active suppliers can be invited;
  - each quote must price every line and carries validity, delivery days and freight;
  - the comparison highlights the lowest landed total and the fastest delivery;
  - **only the OWNER can award**, a reason is mandatory, and the other quotes are rejected with that reason in the audit log;
  - the PO is raised once at the quoted net rates and consumes the requisition.

RFQ tests (25 checks) also prove:

- two simultaneous awards: exactly one wins;
- two simultaneous "raise PO" calls: one PO;
- an expired quote cannot be awarded;
- an RFQ that already has a PO cannot be cancelled.

## 5. Print and PDF

The browser suite puts the page into print mode at the printable A4 width. It
then checks four things:

- only the document is visible;
- it starts at the top-left of the page;
- it contains the expected text;
- the PDF that Chromium renders has the right page count.

| Document | Pages | Content read back from the PDF |
|---|---|---|
| GST tax invoice | 1 | company header, TAX INVOICE, bill-to, lines, totals |
| Refund acknowledgement | 1 | company, voucher no., amount, credit note, CANCELLED mark |

**Bug found:** the refund acknowledgement printed a blank page, because the
global print stylesheet shows only `.print-area` and the dialog did not have
it. Fixed with a print rule for dialogs. The rule removes the app page from the
print and lays the dialog out from the page top. The CSS minifier folded away
the first attempt (`translate: none`), so the rule zeroes Tailwind's
translate variables.

## 6. Staging rehearsal

`scripts/staging-rehearsal.mjs` loads a dump into a new disposable database
and applies the migrations exactly as `deploy.py` does. It then proves:

- every pre-existing table kept its rows;
- every business row belongs to an operating company;
- no counter is un-prefixed;
- the ledger balances and no stock is negative;
- the migrated database has no drift from the schema.

It refuses database names that do not look disposable, and it refuses
databases that already exist. It drops only the database it created.

Run against a simulated live dump: the schema and data as of commit `d1ef1f0`,
with migration history for the first three migrations and un-prefixed
counters. The three new migrations applied in 20 s and every check passed.

**Not done:** the same run against the real `~/backups/predeploy/` dump. To do
it on the server:

```bash
STAGING_DATABASE_URL=mysql://<user>:<pass>@127.0.0.1:3306/forgeerp_staging_rehearsal \
  node scripts/staging-rehearsal.mjs ~/backups/predeploy/<latest>.sql.gz
```

## 7. Final gate (fresh database `forgeerp_audit_final`, MySQL 8.0.46)

| Gate | Result |
|---|---|
| `npm ci` | OK |
| `prisma format` / `validate` / `generate` | no changes / valid / OK |
| `prisma migrate deploy` (6 migrations, empty DB) | OK, status up to date |
| Drift: DB → schema, migrations → schema (shadow DB) | none / none |
| `npm run typecheck` / `npm run lint` / `npm run build` | 0 errors / 0 errors / OK |
| `git diff --check` | clean |
| Tenant isolation suite | 68/68 |
| Legacy API suite | 72/72 |
| Workflow suite | 462/462 |
| Backup / restore drill | 18/18 |
| Browser E2E (390 / 768 / 1440 px, print, PDF) | 96/96 |

## 8. Verdict

**READY FOR STAGING, multi-tenant capable.** The multi-company isolation gap that kept
the earlier verdict from production is closed and tested. Two items remain
before production:

1. Run the rehearsal script against the real live dump, and confirm which
   operating company owns the legacy rows.
2. A pilot on staging with real users. The new screens are tested by
   automation, not yet by shop-floor staff.

The repository still tracks `.env`, which should be untracked. That is
unchanged by this branch.

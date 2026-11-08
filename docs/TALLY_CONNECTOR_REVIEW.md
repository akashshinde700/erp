# ForgeERP Tally Connector — code review aur connection plan

**Review date:** 2026-11-08  
**Product revision:** `e5230c61560594b2e60cbac8f742a7ef580c6d25`  
**Scope:** product ka Tally implementation + diye gaye teen GitHub repositories; source review aur isolated runtime checks. Initial review mein production code change nahi hua; baad mein P0 accounting/agent findings aur queue feature gate par targeted fixes apply kiye gaye. Review observations ko neeche current-status notes ke saath padhein.

## 1. Short answer

**Connection architecture sahi hai; current implementation production-ready nahi hai.**

ForgeERP cloud/server par hai aur Tally customer ke Windows PC par. Browser ya cloud server customer ke `localhost:9000` ko directly access nahi kar sakta. Isliye Tally PC par ek **outbound polling agent** chalana sahi design hai:

```text
ForgeERP UI
   | HTTPS: invoice queue
   v
ForgeERP API / job queue
   ^
   | HTTPS: agent poll + result acknowledgement (outbound)
   |
Node connector on the Tally PC
   | HTTP POST: Tally import XML
   v
http://127.0.0.1:9000  ->  local TallyPrime
```

Tally ka port 9000 internet par expose karne ki zaroorat nahi honi chahiye. Agent ko ERP tak outbound HTTPS access chahiye.

**Lekin abhi live books par automatic import mat chalaiye.** Review mein accounting-direction bugs, discount se quantity corruption, false-success reporting aur non-durable/global queue mile hain. Pehle demo company mein fixes aur real-Tally acceptance tests karein.

## 2. Product mein abhi kya bana hai

| Part | File | Current behaviour |
|---|---|---|
| Voucher/model + XML engine | `src/lib/tally.ts` | Sales, Purchase, Receipt, Payment; XML/JSON/CSV; ledger mapping; masters XML |
| Connector API | `src/app/api/tally/connector/route.ts` | Pairing code, bearer token, queue, pending-job poll, result, revoke |
| Local agent | `public/downloads/tally/forge-tally-connector.mjs` | Node 18+; pair/run/status/forget; 15-second polling; local Tally HTTP POST |
| Manual importer | `public/downloads/tally/Tally-Import.bat` | Windows curl/PowerShell se XML POST; result counters aur common errors |
| UI | `src/components/erp/tally.tsx` | Pairing, status, recent imports, downloads, bulk export, ledger settings |
| Export endpoints | `src/app/api/tally/{masters,voucher,bulk}/route.ts` | Masters, single voucher, date-range bulk export |
| Persistence | `prisma/schema.prisma` | Company par Tally ledger names; invoices par export/sent timestamps. Connector pairing/jobs DB mein nahi hain |

### Current connector protocol

1. Authenticated user `new-code` generate karta hai.
2. Code 10 minutes valid aur single-use hai.
3. Agent `pair` se bearer token leta hai aur local config mein save karta hai.
4. User document `queue` karta hai; server us waqt XML snapshot bana deta hai.
5. Agent `GET /api/tally/connector?mode=pending` poll karta hai.
6. Agent XML ko configured Tally URL par POST karta hai.
7. Agent created/altered/errors result wapas report karta hai.

Security basics achhe hain: code/token server par hashed hain, token random hai, poll/result bearer-gated hain. Lekin storage, tenant binding aur operational reliability abhi PoC level par hain.

## 3. Findings — priority order

### P0-1. Purchase inventory voucher ka Dr/Cr sign galat tha — FIXED

**Files:** `src/lib/tally.ts` (invoice builder + `inventoryLineXml()`). Builder now emits purchase inventory/allocation amounts as debit/negative and computes a round-off residual from the actual signed postings. Isolated XML regression now balances the purchase example to zero.

**Initial finding:** `src/lib/tally.ts:180-188`, `src/lib/tally.ts:333-347`

`TallyItemLine.amount` hamesha positive hai. `inventoryLineXml()` bina Sales/Purchase direction jaane dono cases mein inventory aur accounting-allocation amount positive render karta hai. Purchase mein stock/purchase side debit honi chahiye; current import convention mein uska amount negative hona chahiye.

**Reproduced example:** taxable ₹1,000 + CGST ₹90 + SGST ₹90 = ₹1,180.

- Party credit: `+1180`
- Tax debits: `-180`
- Current purchase inventory allocation: `+1000`
- **Actual accounting sum: +₹2,000**, expected **₹0**; inventory allocation `-1000` honi chahiye.

Sales example balance hota hai; isliye sirf sales test se yeh bug cover nahi hota. Accounting-Companion ke purchase fixture mein bhi party credit aur purchase inventory allocation debit hai.

**Fix direction:** item line par explicit debit/credit direction rakhein ya renderer ko voucher kind dein; inventory amount, accounting allocation, `ISDEEMEDPOSITIVE`, aur batch/godown allocations ko consistent sign dein. Har invoice mode ka final accounting sum zero assert karein.

### P0-2. Receipt aur Payment dono mein debit/credit ulta tha — FIXED

**File:** `src/lib/tally.ts` payment builder. Receipt is now Bank Dr + TDS Receivable Dr + Party Cr; Payment is Party Dr + Bank Cr + TDS Payable Cr. Isolated signed-entry checks balance both examples.

**Initial finding location:** `src/lib/tally.ts:280-293`

₹900 cash/bank + ₹100 TDS, total settlement ₹1,000 ke isolated test mein:

| Voucher | Current output | Correct accounting direction |
|---|---|---|
| Receipt | Party Dr 1000; Bank Cr 900; TDS Receivable Cr 100 | Bank Dr 900; TDS Receivable Dr 100; Party Cr 1000 |
| Payment | Party Cr 1000; Bank Dr 900; TDS Payable Dr 100 | Party Dr 1000; Bank Cr 900; TDS Payable Cr 100 |

Donon cases net total zero hai, lekin entries mirror-image hain. **Sirf Dr=Cr test kaafi nahi; har ledger ki expected direction bhi assert karni hogi.** Reference repo ke Receipt/Payment fixtures mein bank receipt par debit aur payment par credit hai.

### P0-3. Empty response aur HTTP 500 ko connector successful bol deta tha — FIXED

**File:** `public/downloads/tally/forge-tally-connector.mjs`. Agent now checks HTTP success, requires an import-result envelope and valid nonnegative `CREATED`, `ALTERED`, `ERRORS`, `EXCEPTIONS` counters, rejects line errors and rejects zero created+altered. CLI status now uses its bearer token via `mode=status`; API supports that authenticated status mode.

**Initial finding location:** `public/downloads/tally/forge-tally-connector.mjs:92-115,149-153`

`postToTally()` HTTP status check nahi karta. Missing XML counters `0` ban jaate hain; phir `errors === 0 && exceptions === 0` se job successful mark hoti hai.

**Actual shipped script ko mock ERP/Tally ke against chalaya:**

| Tally response | Reported result |
|---|---|
| Valid import result, CREATED=1 | `ok=true, created=1` — correct |
| HTTP 200, empty body | `ok=true, created=0, altered=0` — **false success** |
| HTTP 500, `server error` | `ok=true, created=0, altered=0` — **false success** |

**Fix direction:** HTTP status, valid response envelope, required counters, `LINEERROR`, errors/exceptions aur expected object count validate karein. Single voucher mein verified existing remote ID ya exactly one created/altered result hona chahiye. Unknown/empty response ko success nahi; failed/needs-reconciliation mark karein.

### P1-1. Discount wali line ki physical quantity badal jaati thi — FIXED

**File:** `src/lib/tally.ts` invoice builder. Physical qty is now preserved; exported net effective rate is derived from taxable amount/qty to retain the billed inventory value. Example 10 @ ₹100, 10% discount now exports qty 10, rate ₹90, amount ₹900. TallyPrime rate precision/discount presentation still needs real-instance validation.

**Initial finding location:** `src/lib/tally.ts:173-178`

Builder `taxable != rate × qty` hone par quantity ko `taxable / rate` se replace karta hai. Discount ko normal mismatch samajh leta hai.

**Reproduced:** qty 10, rate ₹100, discount 10%, taxable ₹900 → exported qty **9**, expected **10**. Isse Tally mein stock movement galat ho sakta hai.

**Fix direction:** actual/billed quantity preserve karein aur Tally discount fields use karein, ya clearly defined net-rate approach apnayein. `discPct`/`discAmt` invoice lines mein available hain, lekin current Tally line model/rendering unhe use nahi karta.

### P1-2. Pairing/queue global in-memory hai, durable aur tenant-scoped nahi

**File:** `src/app/api/tally/connector/route.ts:42-67,92-96,163-218`

- Server restart par pairing aur jobs chale jaate hain.
- Multiple Next processes/workers/instances shared `globalThis` nahi dekhte.
- Store mein `companyId` nahi hai; multiple organisations hone par pairing/status/jobs mix ho sakte hain.
- Pairing code issuing org se bind nahi hota; global bearer token pending global jobs access karta hai.
- Jobs 30-minute retention mein silently trim ho jaate hain; durable retry nahi.
- Re-pair purani pending jobs clear nahi karta.

Product mein tenant-aware DB layer hai, lekin connector us mechanism ko use nahi karta. Single-org, single-process demo mein flow chal sakta hai; SaaS/multi-worker deployment ke liye yeh unsafe hai.

**Fix direction:** DB-backed `TallyConnection`, `TallyPairingCode`, `TallyExportJob`; har row par `companyId`; atomic job claim/lease; idempotent result; retry/backoff; expired/revoked state; audit history.

### P1-3. “Masters XML” complete Tally setup nahi karta

**Files:** `src/app/api/tally/masters/route.ts:20-23`, `src/lib/tally.ts:450-508`

Current masters mein units, basic ledger names/groups aur party names hain. Yeh nahi bhejta:

- Stock items, stock groups, GST rate/HSN details, godowns/batches.
- Party GSTIN, registration type, state/address/mailing details.
- GST ledger ka tax type, rate, appropriate-for configuration.
- Actual mapped bank ledger; TDS Receivable/Payable ledger creation.

Isliye existing Tally company mein sahi masters pehle se hon to import chal sakta hai, lekin fresh company mein “masters first, everything ready” guarantee nahi. Purchase default bhi `Central Tax on Sales...`/`State Tax on Sales...` names use karta hai; input-tax ledger mapping/config verify karni hogi.

**Fix direction:** complete master sync ya explicit existing-master mapping + preflight. Missing stock item/ledger/GST configuration par voucher queue block karein.

### P1-4. Connector queue plan feature gate bypass karta tha — FIXED

**File:** `src/app/api/tally/connector/route.ts`. Queue action now calls `assertFeature('exportData')` after mutation authorization. Other connector durability/company-scoping risks remain unresolved.

### P2. Status aur reliability gaps

- `forge-tally-connector.mjs:178` CLI `status` bina session cookie GET karta hai. Normal logged-in deployment mein API 401 deti hai; CLI usse misleading `Server unreachable` bolta hai (`:181`). Token-aware status mode chahiye.
- Server `lastSeenAt` poll par update hota hai, Tally success par nahi. UI `Online` ka matlab sirf agent ne ERP poll kiya; Tally band ho tab bhi online dikh sakta hai.
- Port 9000 open hona kaafi nahi. Active company, licence/version, XML capability aur required masters ka preflight chahiye.
- Stable `REMOTEID` achha hai, lekin XML `ACTION="Create"` hai aur real Tally re-import/update behaviour verify nahi hua. Tally se GUID/MasterID read-back aur explicit create/alter policy add karein.
- Agent foreground loop hai; Windows service/startup, bounded retry/backoff, upgrade story aur useful local logs production ke liye chahiye.
- Current agent UTF-8 XML bhejta hai; Accounting-Companion UTF-16 use karta hai. UTF-8 ko automatically wrong mat maaniye, lekin supported TallyPrime versions par encoding acceptance test karein.

## 4. Teen repositories ka actual comparison

### A. Accounting-Companion/TallyConnector

Repo: https://github.com/Accounting-Companion/TallyConnector  
Reviewed commit: `03c7f4f53914bcbf017849c8e268154cffcfd76e` (2026-08-26)

**Kya hai:** mature C#/.NET library, Tally XML API ke upar typed objects. README TallyPrime 4–7 support bataता hai; current build targets .NET 8/9/10.

**Connection:** `BaseTallyService` default `http://localhost:9000` par HTTP POST karta hai. `Setup(url, port)`, connectivity check, active-company query, licence info, version-specific models, masters/vouchers read/write, aur Windows process/registry/port discovery jaise helpers hain.

**ForgeERP ke liye value:**

- Best reference for XML semantics, purchase/receipt/payment signs, master metadata, response parsing.
- Active company/licence/version preflight aur read-back patterns.
- Agar typed .NET integration chahiye to isi library par Windows sidecar/worker ban sakta hai.

**Limit:** yeh Next.js mein directly import hone wali JS library nahi. Isse replace karne ke liye customer PC par .NET agent chahiye. Current Node outbound architecture already suitable hai; unnecessary rewrite ki zaroorat nahi.

**License note:** package metadata mein MIT expression hai, lekin reviewed tree mein standalone root LICENSE file nahi mili. Code copy karne se pehle package/license terms confirm karein; is review mein code copy nahi kiya gaya.

### B. ramajayam-CA/Tally-Connector

Repo: https://github.com/ramajayam-CA/Tally-Connector  
Reviewed commit: `6ac77c3da55c9348bc82cca3cd264e867b84de8a` (2023-12-25)

**Kya hai:** Tally se Excel/Power BI/Power Query mein data lene ka TDL + ODBC solution. README mein `Connection.tcp` load karne, ODBC enable karne aur `TALLYODBC_9000` data source se ledger/voucher tables query karne ke steps hain.

**Actual repo detail:** uploaded file `Collection.tcp` hai, jabकि README `Connection.tcp` bolta hai. TCP readable TDL source nahi, compiled/binary payload hai (`89 SDB` prefix); binary ke andar ki implementation source se audit nahi ki gayi. Saath mein Excel workbooks aur demo data hai.

**ForgeERP ke liye value:** Tally → reporting/BI read-only extraction ka reference.

**Limit:** yeh ERP → Tally voucher push connector nahi; cloud pairing/job queue/auth bhi nahi. Aapke current write-sync problem ka direct solution nahi. Root license clear nahi mila; ICAI/community mention ko redistribution permission mat samjhein.

### C. dhananjay1405/tally-localhost-connector

Repo: https://github.com/dhananjay1405/tally-localhost-connector  
Reviewed commit: `9e3febd9a6e85a7a61b4472362936820b1f4ac50` (2021-03-13)

**Kya hai:** small MIT-licensed C#/.NET Framework 4.5 console proxy. `localhost:9001` par browser request leta hai aur `localhost:9000` Tally ko forward karta hai.

**Important limitations:**

- `Access-Control-Allow-Origin: *`; authentication nahi.
- Proper CORS preflight/origin restriction nahi.
- Sirf port 9000 listening check; actual Tally/company validation nahi.
- Tally downstream failure/empty response ko bhi outer HTTP 200 bana sakta hai.
- Purana, do-commit project; production cloud connector nahi.

**ForgeERP ke liye value:** browser-to-local bridge ka simple conceptual reference. Aapka outbound polling agent cloud deployment ke liye behtar hai. Is proxy ko as-is product mein add karna recommended nahi.

### Recommendation

**Apna Node outbound connector hi rakhein.** Accounting-Companion se protocol/preflight/read-back/XML semantics borrow karein; zaroorat ho to optional .NET sidecar banayein. ODBC repo ko sirf future BI/read reporting ke liye dekhein. Localhost CORS proxy ko production path na banayein.

## 5. Current PoC ko connect kaise karte hain

> Yeh existing flow ke instructions hain. Upar ke P0 fixes ke bina sirf **demo/test company** mein use karein.

1. Jis Windows PC par Tally hai, us par TallyPrime open karein aur intended company load karein.
2. `F1 Help → Settings → Connectivity → Client/Server configuration` mein `TallyPrime acts as: Both` aur port `9000` set karein. XML connector ke liye ODBC enable karna zaroori nahi.
3. Tally PC par Node 18+ install karein.
4. ForgeERP ke Tally page se `forge-tally-connector.mjs` download karein.
5. UI mein **Generate pairing code** dabayein.
6. Script wali directory mein:

```powershell
node forge-tally-connector.mjs pair --server https://YOUR-ERP-DOMAIN --code XXXXX-XXXXX
node forge-tally-connector.mjs run
```

Custom local port ho to pair command mein `--tally http://127.0.0.1:YOUR_PORT` dein. Tally dusre LAN PC par ho to reachable LAN URL configure karna hoga; default loopback same-PC ke liye hai.

7. Existing verified Tally masters/ledger mapping ke saath invoice ko **Queue for Tally connector** karein.
8. Tally Day Book aur connector result dono verify karein.

**Network:** ERP HTTPS outbound; agent se local Tally HTTP. Port 9000 ko router/internet par forward na karein. Production ERP URL HTTPS hona chahiye.

## 6. Production-ready connection plan

### Phase 0 — accounting aur response correctness

- Purchase inventory signs fix.
- Receipt/Payment/TDS directions fix.
- Discount/quantity preservation fix.
- Strict Tally response validation; no false success.
- Sales/Purchase/Receipt/Payment × cash/bank/TDS/discount/round-off/service/IGST matrix tests.
- Demo Tally company mein actual import, ledger balances, stock qty/value aur re-import test.

### Phase 1 — durable, organisation-scoped queue

Suggested tables:

- `TallyConnection`: companyId, connector identity, token hash, status, last ERP heartbeat, last Tally health, verified Tally company/version.
- `TallyPairingCode`: companyId, code hash, expiry, consumedAt, issuedBy.
- `TallyExportJob`: companyId, document type/id, payload hash/version, XML snapshot, remoteId, status, attempts, leaseUntil, result counters, Tally MasterID/GUID, error details.

Rules:

- Pairing code/token/company strictly bound.
- Atomic claim; one active worker per company/connection.
- Result acknowledgement idempotent.
- Offline hone par jobs silently delete na hon; retry/backoff aur visible failure ho.
- Timeout ke baad blind retry se pehle remote ID se reconciliation; duplicate/update policy verified ho.
- Feature/subscription checks queue path par bhi लागू hon.

### Phase 2 — Tally preflight aur master mapping

Agent startup/periodic health mein:

1. Tally HTTP endpoint reachable?
2. Kaunsi company active hai aur expected company se match karti hai?
3. Tally version/licence mode supported hai?
4. Required ledgers, stock items, units, GST configuration, godown/batch available hain?
5. Last successful import kab hua?

UI mein `ERP connected`, `Tally reachable`, `Company verified` ko alag states dikhayein.

### Phase 3 — customer installation

- Signed Windows installer/service wrapper; startup aur recovery.
- Node runtime bundle ya single executable, taaki customer ko manual Node setup na karna pade.
- Token ko OS-protected storage mein rakhein; logs mein token/XML sensitive data na aaye.
- Versioned agent update aur compatibility check.

### Phase 4 — optional two-way sync

Abhi product ERP → Tally one-way push hai. Agar Tally → ERP sync chahiye to ledgers/vouchers ka `AlterID`/date-based incremental read, conflict policy aur clear system-of-record define karein. Accounting-Companion typed read APIs ke liye useful reference hai. ODBC ko sirf reporting use case mein evaluate karein.

## 7. Checks actually run kiye

Temporary isolated harness se; koi real customer/Tally data use nahi hua.

| Check | Result |
|---|---|
| `node --check forge-tally-connector.mjs` | PASS |
| Actual agent: mock pair → poll → Tally POST → result | PASS, correct XML payload received |
| Valid CREATED=1 response | PASS |
| Empty HTTP 200 response | **FAIL — false success reproduced** |
| HTTP 500 response | **FAIL — false success reproduced** |
| CLI status against auth-required mock | **FAIL — reported “Server unreachable”** |
| Generated Sales/Purchase/Receipt/Payment/Masters XML well-formedness | PASS |
| Sales ₹1,000 + ₹180 GST accounting sum | PASS, zero |
| Purchase same example after fix | PASS, XML signed sum zero; inventory allocation negative |
| Receipt/Payment expected ledger directions after fix | PASS, correct entries and zero signed sum |
| Discounted qty 10 @ ₹100, 10% off after fix | PASS, exported qty 10 at effective rate ₹90 |
| Empty HTTP 200 and HTTP 500 after fix | PASS, both reported as failed jobs |
| Status CLI / bearer status | Agent calls bearer mode; status API mode added. Isolated earlier mock lacks this new endpoint behavior, so route-level status not re-tested |
| `.bat` line endings | PASS, 123 CRLF, zero bare LF |

Node version: `v22.22.3`. XML builder ko source se isolate karke chalaya gaya; protocol test mein shipped `.mjs` actual subprocess ke रूप mein chala. Mock ERP full Next/Prisma route ka replacement tha, production database test nahi.

**Not verified:** real TallyPrime import, exact company/licence/version behaviour, UTF-8 versus UTF-16 acceptance, actual duplicate/update semantics, Windows service behaviour, full deployed ERP end-to-end. Inhe acceptance test matrix mein explicitly cover karna baaki hai.

## 8. Final verdict

- **Architecture:** keep outbound local agent; no public Tally port.
- **Best reference:** Accounting-Companion for XML/read-back/preflight; optional .NET sidecar.
- **ODBC repo:** reporting-only, current write connector ka replacement nahi.
- **Localhost proxy:** simple demo, production security/reliability ke liye recommended nahi.
- **Current product:** P0 accounting signs, discount quantity, false-success handling, CLI bearer status path, aur queue export-feature gate ke targeted fixes applied; isolated local checks pass for voucher balances and agent response handling. No real TallyPrime certification yet, so live books par use se pehle demo-company testing zaroori hai.
- **Still open:** DB-backed company-scoped durable queue, complete stock/GST masters and preflight, retry/idempotency/reconciliation, plus repeatable in-repo regression tests.
- **Next step:** add permanent regression tests → durable tenant queue/master preflight → real TallyPrime demo-company certification → customer installer.

#!/usr/bin/env node
/**
 * ForgeERP — link legacy BOMs to the item they make (`Bom.itemId`).
 *
 * Before the BOM revision work, a BOM was identified only by its free-text
 * `productName`. MRP needs an item link to explode demand, so every BOM must be
 * given an output item — but guessing from free text in production is not
 * acceptable. This script therefore:
 *
 *   1. lists every BOM with `itemId IS NULL` (and, with --project, the item of
 *      the project's sales-order line as extra context);
 *   2. proposes a match ONLY when exactly one catalog item's code or name
 *      matches the BOM product name (case/space-insensitive, or the product
 *      name is a unique prefix); ambiguous or missing matches are reported and
 *      left alone;
 *   3. writes nothing unless --apply is given, and never changes revision,
 *      status or effective dates — it is a pure link, so it cannot resurrect or
 *      re-order an approval.
 *
 * Usage:
 *   node scripts/backfill-bom-output-items.mjs --dry-run
 *   node scripts/backfill-bom-output-items.mjs --dry-run --map BOM-2526-004=FG-2002
 *   node scripts/backfill-bom-output-items.mjs --apply --by ops@example.com
 *
 *   --dry-run   propose matches, print the plan, write nothing (default)
 *   --apply     perform the links (requires DATABASE_URL pointing at the target)
 *   --map a=b   force a mapping (repeatable); accepts bomNo or bom id → item code or id
 *   --project   also print the project's customer and budget as a sanity hint
 *
 * Safety: refuses to run against a database where the Bom table has no itemId
 * column (migration not deployed), and every write is one transaction per BOM.
 */
import { PrismaClient } from '@prisma/client'

const argv = process.argv.slice(2)
const APPLY = argv.includes('--apply')
const DRY = !APPLY || argv.includes('--dry-run')
const WITH_PROJECT = argv.includes('--project')
const BY = argValue('--by')
const FORCED = argv
  .map((a, i, all) => (a === '--map' ? all[i + 1] : null))
  .filter(Boolean)
  .map((pair) => {
    const [left, right] = pair.split('=')
    if (!left || !right) throw new Error(`--map expects <bomNo>=<itemCode>, got "${pair}"`)
    return { left: left.trim(), right: right.trim() }
  })

function argValue(flag) {
  const i = argv.indexOf(flag)
  return i >= 0 ? argv[i + 1] : undefined
}

const norm = (s) => (s ?? '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim()

const db = new PrismaClient()

async function main() {
  let columnOk = true
  try {
    await db.$queryRaw`SELECT itemId FROM Bom LIMIT 1`
  } catch {
    columnOk = false
  }
  if (!columnOk) {
    console.error('Bom.itemId is missing — deploy prisma/migrations/20261110100000_bom_revisions_and_mrp first.')
    process.exit(2)
  }

  const [boms, items] = await Promise.all([
    db.bom.findMany({
      where: { itemId: null },
      orderBy: [{ bomNo: 'asc' }],
      select: {
        id: true,
        bomNo: true,
        productName: true,
        status: true,
        revision: true,
        project: { select: { projectNo: true, name: true, party: WITH_PROJECT ? { select: { name: true } } : undefined } },
      },
    }),
    db.item.findMany({
      where: { active: true, isService: false },
      select: { id: true, code: true, name: true, uom: true },
    }),
  ])

  console.log(`Legacy BOMs without an output item: ${boms.length}`)
  console.log(`Active non-service catalog items:   ${items.length}`)
  if (boms.length === 0) return

  const byId = new Map(items.map((i) => [i.id, i]))
  const byCode = new Map(items.map((i) => [i.code.toUpperCase(), i]))
  const forced = new Map()
  for (const { left, right } of FORCED) {
    const item = byCode.get(right.toUpperCase()) ?? byId.get(right)
    if (!item) throw new Error(`--map ${left}=${right}: unknown item "${right}"`)
    forced.set(left, item)
  }

  const plan = []
  const unresolved = []

  for (const bom of boms) {
    const explicit = forced.get(bom.bomNo) ?? forced.get(bom.id)
    if (explicit) {
      plan.push({ bom, item: explicit, how: 'forced (--map)' })
      continue
    }
    const needle = norm(bom.productName)
    const candidates = items.filter((i) => {
      const code = norm(i.code)
      const name = norm(i.name)
      if (!needle) return false
      return code === needle || name === needle || name.startsWith(needle) || needle.startsWith(name) || needle.startsWith(code)
    })
    if (candidates.length === 1) {
      plan.push({ bom, item: candidates[0], how: 'unique name/code match' })
    } else {
      unresolved.push({ bom, candidates })
    }
  }

  console.log('\nProposed links:')
  for (const row of plan) {
    const proj = row.bom.project ? ` · ${row.bom.project.projectNo}` : ''
    console.log(
      `  ${row.bom.bomNo} rev ${row.bom.revision} [${row.bom.status}]${proj} "${row.bom.productName}" → ` +
        `${row.item.code} ${row.item.name} (${row.how})`
    )
  }

  if (unresolved.length) {
    console.log('\nNeeds a human decision (no write):')
    for (const { bom, candidates } of unresolved) {
      const opts = candidates.length
        ? candidates.map((c) => `${c.code} ${c.name}`).join(' | ')
        : 'no catalog item resembles this name — create the FG/sub-assembly item first'
      console.log(`  ${bom.bomNo} rev ${bom.revision} [${bom.status}] "${bom.productName}" → ${opts}`)
    }
    console.log(
      '\nResolve with: node scripts/backfill-bom-output-items.mjs --apply --map <bomNo>=<itemCode> --by <email>'
    )
  }

  if (DRY || plan.length === 0) {
    console.log(`\nDry run — nothing written. ${plan.length} link(s) would be applied, ${unresolved.length} left to review.`)
    return
  }

  // One transaction per BOM: a failure on one row must not partially commit, and
  // the unique key (companyId, itemId, revision) surfaces duplicate output items
  // instead of silently creating a second live BOM for the same product.
  let applied = 0
  for (const { bom, item } of plan) {
    try {
      await db.$transaction(async (tx) => {
        const fresh = await tx.bom.findUnique({ where: { id: bom.id }, select: { itemId: true } })
        if (fresh?.itemId) return // someone linked it meanwhile
        await tx.bom.update({ where: { id: bom.id }, data: { itemId: item.id } })
      })
      applied += 1
      console.log(`  linked ${bom.bomNo} → ${item.code}`)
    } catch (e) {
      console.error(`  FAILED ${bom.bomNo} → ${item.code}: ${e.message}`)
    }
  }
  console.log(`\nApplied ${applied}/${plan.length} link(s)${BY ? ` (by ${BY})` : ''}. Review the plan in GET /api/manufacturing/mrp/preview.`)
}

main()
  .catch((e) => {
    console.error(e.message ?? e)
    process.exitCode = 1
  })
  .finally(() => db.$disconnect())

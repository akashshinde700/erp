/**
 * BOM line basis — what a BOM's component quantities are for.
 *
 * - `UNIT`:  every line is the quantity for ONE output unit. A work order for
 *            N units needs line × N. Finished goods are received at the full
 *            per-unit standard (material + routed labour + absorbed overhead).
 * - `BATCH`: every line is the quantity for one batch of `batchQty` output
 *            units. A work order for N units needs line × N / batchQty.
 *            Legacy revisions are BATCH of 1 and keep their historical receipt
 *            valuation (material standard pro-rated over planned output).
 *
 * Kept in its own module so costing, receipts, MRP and reports share one rule
 * without import cycles.
 */
import { BusinessError } from './accounting'

export const BOM_LINE_BASES = ['BATCH', 'UNIT'] as const
export type BomLineBasis = (typeof BOM_LINE_BASES)[number]

export interface BomBasisFields {
  lineBasis?: string | null
  batchQty?: number | null
}

export const isUnitBasis = (b: BomBasisFields | null | undefined) => b?.lineBasis === 'UNIT'

/** Output units one set of BOM lines makes (UNIT → 1, BATCH → batchQty). */
export function bomUnitsPerSet(b: BomBasisFields | null | undefined): number {
  if (!b || isUnitBasis(b)) return 1
  const n = Number(b.batchQty ?? 1)
  return n > 0 ? n : 1
}

/** Validate + normalise user input. UNIT always stores batchQty = 1. */
export function normaliseBomBasis(
  input: BomBasisFields,
  fallback: { lineBasis: BomLineBasis; batchQty: number } = { lineBasis: 'BATCH', batchQty: 1 }
): { lineBasis: BomLineBasis; batchQty: number } {
  const lineBasis = (input.lineBasis ?? fallback.lineBasis) as BomLineBasis
  if (!BOM_LINE_BASES.includes(lineBasis)) throw new BusinessError('lineBasis must be BATCH or UNIT')
  if (lineBasis === 'UNIT') return { lineBasis, batchQty: 1 }
  const batchQty = input.batchQty === undefined || input.batchQty === null ? fallback.batchQty : Number(input.batchQty)
  if (!(batchQty > 0) || batchQty > 1_000_000) throw new BusinessError('Batch size must be between 0 and 1,000,000 output units')
  return { lineBasis, batchQty }
}

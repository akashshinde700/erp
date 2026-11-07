/**
 * ForgeERP — shared, dependency-free input validation.
 *
 * Why this exists: `new Date('garbage')` produces an Invalid Date that Prisma
 * turns into a 500 (and `new Date('2026-02-30')` silently rolls into March).
 * Date strings arrive from the UI as YYYY-MM-DD; accepting anything else
 * corrupts voucher numbering (FY buckets), GST period reports and stock
 * as-of dates. Both API routes and the posting services use these rules.
 */
import { z } from 'zod'
import { isStateCode } from './erp'

const DATE_RE = /^(\d{4})-(\d{2})-(\d{2})(?:[T ][0-9:.+\-Z]*)?$/

/** True only for a real calendar date, optionally followed by a time part. */
export function isValidDateString(v: unknown): v is string {
  if (typeof v !== 'string') return false
  const m = DATE_RE.exec(v.trim())
  if (!m) return false
  const year = Number(m[1])
  const month = Number(m[2])
  const day = Number(m[3])
  if (month < 1 || month > 12 || day < 1 || day > 31) return false
  const canonical = new Date(Date.UTC(year, month - 1, day))
  if (canonical.getUTCFullYear() !== year || canonical.getUTCMonth() !== month - 1 || canonical.getUTCDate() !== day) return false
  // A time part (if present) must itself be parseable — catches 2026-01-01T99:99.
  if (v.includes('T') || v.includes(' ')) return !Number.isNaN(new Date(v).getTime())
  return true
}

/** Zod string that accepts YYYY-MM-DD (or an ISO datetime) and nothing else. */
export const dateString = z
  .string()
  .refine(isValidDateString, 'Enter a valid date (YYYY-MM-DD)')

export const optionalDate = dateString.optional()
export const nullableDate = dateString.optional().nullable()

/** YYYY-MM with a real month number (GSTR-1 / MIS period filters). */
export const monthString = z
  .string()
  .regex(/^\d{4}-(0[1-9]|1[0-2])$/, 'Month must be YYYY-MM (01–12)')

/** GST place-of-supply / party / company state codes: numeric 01–38 only. */
export const gstStateCode = z
  .string()
  .refine(isStateCode, 'State code must be a valid 2-digit GST state code (01–38)')
  .describe('Two-digit Indian GST state code')

/** Validate a query-string date. Returns a client-safe error string or null. */
export function dateQueryError(value: string | null | undefined, label: string): string | null {
  if (value === null || value === undefined || value === '') return null
  return isValidDateString(value) ? null : `${label} must be a valid date (YYYY-MM-DD)`
}

/** Validate from <= to for a reporting period (both optional). */
export function dateRangeError(from?: string | null, to?: string | null): string | null {
  const a = dateQueryError(from, 'from')
  if (a) return a
  const b = dateQueryError(to, 'to')
  if (b) return b
  if (from && to && from > to) return 'from date cannot be after to date'
  return null
}

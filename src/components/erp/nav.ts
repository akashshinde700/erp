'use client'

/**
 * ForgeERP — cross-module navigation glue.
 *
 * The Mapsoft-style "one button takes you to the next step" pattern:
 * any screen can open a create-dialog on ANOTHER module, prefilled, via a
 * short-lived sessionStorage preset + a CustomEvent. Recent views feed the
 * command palette.
 */

import type { ErpView } from './store'

// ---------- create presets ----------

export interface CreatePreset {
  type: 'sales-invoice' | 'purchase-invoice' | 'payment' | 'party-ledger'
  partyId?: string
  paymentType?: 'RECEIPT' | 'PAYMENT'
  /** Pre-ticked invoice allocations (invoiceNo → amount). */
  allocations?: { invoiceNo: string; amount: number }[]
  /** Suggested payment amount (e.g. the invoice balance). */
  amount?: number
  expiresAt: number
}

const PRESET_KEY = 'erp_create_preset'
const PRESET_TTL_MS = 60_000
export const PRESET_EVENT = 'erp:create-preset'

export function setCreatePreset(preset: Omit<CreatePreset, 'expiresAt'>): void {
  try {
    sessionStorage.setItem(PRESET_KEY, JSON.stringify({ ...preset, expiresAt: Date.now() + PRESET_TTL_MS }))
  } catch {
    /* storage unavailable — presets are a convenience, not a requirement */
  }
  window.dispatchEvent(new CustomEvent(PRESET_EVENT, { detail: preset }))
}

/** Read + clear the pending preset (single use, TTL-guarded). */
export function takeCreatePreset(): CreatePreset | null {
  try {
    const raw = sessionStorage.getItem(PRESET_KEY)
    if (!raw) return null
    sessionStorage.removeItem(PRESET_KEY)
    const p = JSON.parse(raw) as CreatePreset
    if (!p || typeof p !== 'object' || Date.now() > (p.expiresAt ?? 0)) return null
    return p
  } catch {
    return null
  }
}

/** Subscribe to preset events (cross-component, same tab). */
export function onPreset(handler: (p: CreatePreset) => void): () => void {
  const fn = (e: Event) => handler((e as CustomEvent).detail as CreatePreset)
  window.addEventListener(PRESET_EVENT, fn)
  return () => window.removeEventListener(PRESET_EVENT, fn)
}

// ---------- recent views (command palette) ----------

const RECENT_KEY = 'erp_recent_views'
const RECENT_MAX = 6

export function pushRecent(view: ErpView): void {
  try {
    const list = readRecent().filter((v) => v !== view)
    list.unshift(view)
    sessionStorage.setItem(RECENT_KEY, JSON.stringify(list.slice(0, RECENT_MAX)))
  } catch {
    /* ignore */
  }
}

export function readRecent(): ErpView[] {
  try {
    const raw = sessionStorage.getItem(RECENT_KEY)
    const list = raw ? (JSON.parse(raw) as string[]) : []
    return Array.isArray(list) ? (list.filter(Boolean) as ErpView[]) : []
  } catch {
    return []
  }
}

// ---------- keyboard shortcut maps ----------

/** g+key → view (Gmail-style double-tap navigation). */
export const GOTO_KEYS: Record<string, { view: ErpView; label: string }> = {
  d: { view: 'dashboard', label: 'Dashboard' },
  s: { view: 'sales', label: 'Sales' },
  p: { view: 'purchase', label: 'Purchase' },
  j: { view: 'jobwork', label: 'Jobwork' },
  b: { view: 'manufacturing', label: 'Projects & Manufacturing' },
  i: { view: 'inventory', label: 'Inventory' },
  a: { view: 'accounting', label: 'Accounting' },
  r: { view: 'reports', label: 'Reports' },
  m: { view: 'masters', label: 'Masters' },
  t: { view: 'tally', label: 'Tally Export' },
  u: { view: 'audit', label: 'Audit Trail' },
  o: { view: 'docs', label: 'Docs' },
}

export const SHORTCUTS_HELP: { keys: string; action: string }[] = [
  { keys: 'Ctrl / ⌘ + K', action: 'Command palette — jump anywhere, search everything' },
  { keys: '/', action: 'Open the command palette' },
  { keys: 'g then key', action: 'Go to module — d s p j b i a r m t u o' },
  { keys: 'Alt + S', action: 'New sales invoice (from anywhere)' },
  { keys: 'Alt + P', action: 'New purchase invoice (from anywhere)' },
  { keys: '?', action: 'This shortcuts help' },
  { keys: 'Esc', action: 'Close palette / dialog' },
]

/** True when a keyboard event originates inside an input/textarea/select. */
export function isTypingTarget(e: KeyboardEvent): boolean {
  const t = e.target as HTMLElement | null
  if (!t) return false
  const tag = t.tagName
  return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || t.isContentEditable
}

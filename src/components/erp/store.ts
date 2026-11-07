'use client'

/**
 * ForgeERP — view router (zustand).
 * The app is a single page; every screen is a registered view name + params.
 */

import { create } from 'zustand'

export type ErpView =
  | 'dashboard'
  | 'sales'
  | 'sales-detail'
  | 'purchase'
  | 'purchase-detail'
  | 'jobwork'
  | 'jobwork-detail'
  | 'manufacturing'
  | 'project-detail'
  | 'inventory'
  | 'accounting'
  | 'reports'
  | 'masters'
  | 'tally'
  | 'audit'
  | 'docs'

export interface ErpUiState {
  view: ErpView
  params: Record<string, string>
  setView: (view: ErpView, params?: Record<string, string>) => void
}

export const useErpUi = create<ErpUiState>((set) => ({
  view: 'dashboard',
  params: {},
  setView: (view, params = {}) => set({ view, params }),
}))

/**
 * True when the current view was opened with params.open === 'new'
 * (dashboard quick actions). Read it as the initial state of a create dialog:
 *   const [open, setOpen] = useState(useOpenNewParam())
 * Modules remount on every view change, so it never re-fires on its own.
 */
export function useOpenNewParam(): boolean {
  return useErpUi((s) => s.params.open === 'new')
}

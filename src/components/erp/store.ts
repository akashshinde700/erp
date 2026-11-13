'use client'

/**
 * ForgeERP — view router (zustand).
 * The app is a single page; every screen is a registered view name + params.
 */

import { create } from 'zustand'

import type { MfgTab } from './mfg-sections'

export type ErpView =
  | 'dashboard'
  | 'sales'
  | 'sales-detail'
  | 'purchase'
  | 'purchase-detail'
  | 'jobwork'
  | 'jobwork-detail'
  | 'projects'
  | 'manufacturing'
  | 'project-detail'
  | 'inventory'
  | 'accounting'
  | 'reports'
  | 'crm'
  | 'masters'
  | 'tally'
  | 'audit'
  | 'docs'

export interface ErpUiState {
  view: ErpView
  params: Record<string, string>
  /** Last-selected sub-section inside "Own Projects & Manufacturing"
      (persists across mounts; the sidebar tree renders from the same value). */
  mfgTab: MfgTab
  setView: (view: ErpView, params?: Record<string, string>) => void
  setMfgTab: (tab: MfgTab) => void
}

export const useErpUi = create<ErpUiState>((set) => ({
  view: 'dashboard',
  params: {},
  mfgTab: 'work-orders',
  setView: (view, params = {}) => set({ view, params }),
  setMfgTab: (tab) => set({ mfgTab: tab }),
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

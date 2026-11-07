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

'use client'

/**
 * ForgeERP — company context (single instance, fetched once at boot).
 */

import { createContext, useContext } from 'react'
import type { Company } from './api'

const CompanyContext = createContext<Company | null>(null)

export function CompanyProvider({
  company,
  children,
}: {
  company: Company | null
  children: React.ReactNode
}) {
  return <CompanyContext.Provider value={company}>{children}</CompanyContext.Provider>
}

export function useCompany(): Company | null {
  return useContext(CompanyContext)
}

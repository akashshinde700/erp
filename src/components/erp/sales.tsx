'use client'

/**
 * ForgeERP — Sales module view (invoices list / create / detail / print / cancel).
 * All logic lives in the shared invoice module (sales & purchase are mirrors).
 */

import { InvoiceDetail, InvoiceModule } from './invoice-module'

export function SalesView() {
  return <InvoiceModule kind="SALES" />
}

export function SalesDetailView({ id }: { id: string }) {
  return <InvoiceDetail kind="SALES" id={id} />
}

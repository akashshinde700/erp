'use client'

/**
 * ForgeERP — Purchase module view (supplier invoices list / create / detail /
 * print / cancel). Mirror of Sales: inter-state GST is derived from the
 * supplier state vs company state on the server.
 */

import { InvoiceDetail, InvoiceModule } from './invoice-module'

export function PurchaseView() {
  return <InvoiceModule kind="PURCHASE" />
}

export function PurchaseDetailView({ id }: { id: string }) {
  return <InvoiceDetail kind="PURCHASE" id={id} />
}

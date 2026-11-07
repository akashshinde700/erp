'use client'

/**
 * ForgeERP — Purchase module view (supplier invoices list / create / detail /
 * print / cancel). Mirror of Sales: inter-state GST is derived from the
 * supplier state vs company state on the server.
 */

import { InvoiceDetail, InvoiceModule } from './invoice-module'
import { ProcurementWorkspace } from './procurement'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'

export function PurchaseView() {
  return <Tabs defaultValue="invoices" className="space-y-4">
    <TabsList><TabsTrigger value="invoices">Purchase Invoices</TabsTrigger><TabsTrigger value="procurement">Procurement & Returns</TabsTrigger></TabsList>
    <TabsContent value="invoices"><InvoiceModule kind="PURCHASE" /></TabsContent>
    <TabsContent value="procurement"><ProcurementWorkspace /></TabsContent>
  </Tabs>
}

export function PurchaseDetailView({ id }: { id: string }) {
  return <InvoiceDetail kind="PURCHASE" id={id} />
}

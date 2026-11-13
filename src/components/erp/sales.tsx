'use client'

/**
 * ForgeERP — Sales module view (invoices list / create / detail / print / cancel).
 * All logic lives in the shared invoice module (sales & purchase are mirrors).
 */

import { InvoiceDetail, InvoiceModule } from './invoice-module'
import { OrderToCashWorkspace } from './order-to-cash'
import { ProformaTab } from './proforma'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'

export function SalesView() {
  return <Tabs defaultValue="invoices" className="space-y-4">
    <TabsList className="h-auto flex-wrap justify-start"><TabsTrigger value="invoices" className="h-11 sm:h-9">Sales Invoices</TabsTrigger><TabsTrigger value="orders" className="h-11 sm:h-9">Quote to Cash</TabsTrigger><TabsTrigger value="proforma" className="h-11 sm:h-9">Proforma (PI)</TabsTrigger></TabsList>
    <TabsContent value="invoices"><InvoiceModule kind="SALES" /></TabsContent>
    <TabsContent value="orders"><OrderToCashWorkspace /></TabsContent>
    <TabsContent value="proforma"><ProformaTab /></TabsContent>
  </Tabs>
}

export function SalesDetailView({ id }: { id: string }) {
  return <InvoiceDetail kind="SALES" id={id} />
}

'use client'

/**
 * ForgeERP — Sales module view (invoices list / create / detail / print / cancel).
 * All logic lives in the shared invoice module (sales & purchase are mirrors).
 */

import { InvoiceDetail, InvoiceModule } from './invoice-module'
import { OrderToCashWorkspace } from './order-to-cash'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'

export function SalesView() {
  return <Tabs defaultValue="invoices" className="space-y-4">
    <TabsList><TabsTrigger value="invoices">Sales Invoices</TabsTrigger><TabsTrigger value="orders">Quote to Cash</TabsTrigger></TabsList>
    <TabsContent value="invoices"><InvoiceModule kind="SALES" /></TabsContent>
    <TabsContent value="orders"><OrderToCashWorkspace /></TabsContent>
  </Tabs>
}

export function SalesDetailView({ id }: { id: string }) {
  return <InvoiceDetail kind="SALES" id={id} />
}

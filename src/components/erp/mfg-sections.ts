'use client'

/**
 * ForgeERP — "Own Projects & Manufacturing" section model.
 * Single source of truth for the module's sub-navigation: the main sidebar
 * renders it as an expandable tree under the module entry, and
 * manufacturing.tsx uses the MfgTab union to switch panels.
 * Keep the groups in the same order users hit them (plan → floor → setup →
 * analyse).
 */

import {
  Activity,
  Building2,
  CalendarClock,
  CheckCircle2,
  ClipboardList,
  Coins,
  FolderKanban,
  Gauge,
  ListTodo,
  ListTree,
  PackageCheck,
  PackageSearch,
  Users,
  Wrench,
  type LucideIcon,
} from 'lucide-react'

export type MfgTab =
  | 'projects'
  | 'boms'
  | 'work-orders'
  | 'mrp'
  | 'capacity'
  | 'material-plan'
  | 'tasks'
  | 'pending'
  | 'employees'
  | 'receipts'
  | 'centers'
  | 'oee'
  | 'costing'
  | 'quality'

export interface MfgSectionItem {
  value: MfgTab
  label: string
  icon: LucideIcon
}

export interface MfgSectionGroup {
  label: string
  items: MfgSectionItem[]
}

export const MFG_SECTION_GROUPS: MfgSectionGroup[] = [
  {
    label: 'Plan',
    items: [
      { value: 'projects', label: 'Projects', icon: FolderKanban },
      { value: 'boms', label: 'BOMs', icon: ListTree },
      { value: 'mrp', label: 'MRP', icon: CalendarClock },
      { value: 'material-plan', label: 'Material Plan', icon: PackageSearch },
      { value: 'capacity', label: 'Capacity', icon: Gauge },
    ],
  },
  {
    label: 'Shop floor',
    items: [
      { value: 'work-orders', label: 'Work Orders', icon: ClipboardList },
      { value: 'tasks', label: 'Tasks', icon: Wrench },
      { value: 'pending', label: 'Pending', icon: ListTodo },
      { value: 'receipts', label: 'FG Receipts', icon: PackageCheck },
    ],
  },
  {
    label: 'Setup',
    items: [
      { value: 'centers', label: 'Work Centers', icon: Building2 },
      { value: 'employees', label: 'Employees', icon: Users },
    ],
  },
  {
    label: 'Analyse',
    items: [
      { value: 'oee', label: 'OEE', icon: Activity },
      { value: 'costing', label: 'Costing', icon: Coins },
      { value: 'quality', label: 'Quality', icon: CheckCircle2 },
    ],
  },
]

export const MFG_SECTION_COUNT = MFG_SECTION_GROUPS.reduce((n, g) => n + g.items.length, 0)

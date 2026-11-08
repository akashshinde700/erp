import { Prisma } from '@prisma/client'
import { db } from './db'
import { BusinessError } from './accounting'
import { fyCode } from './erp'
import { tenantCompany } from './tenant'

type Tx = Prisma.TransactionClient
type ParameterInput = { name: string; dataType: 'NUMBER' | 'TEXT' | 'BOOLEAN'; unit?: string; minValue?: number; maxValue?: number; expectedText?: string; required?: boolean; seq?: number }
async function org(tx: Tx) { const row = await tenantCompany(tx); if (!row) throw new BusinessError('Operating company is not configured', 409); return row }
async function inspectionNo(tx: Tx, companyId: string) { const key = `QI-${fyCode(new Date())}`; const row = await tx.counter.upsert({ where: { key: `${companyId}:${key}` }, create: { key: `${companyId}:${key}`, value: 1 }, update: { value: { increment: 1 } } }); return `${key}-${String(row.value).padStart(3, '0')}` }

function validateParameter(parameter: ParameterInput) {
  if (!parameter.name.trim()) throw new BusinessError('QC parameter name is required')
  if (parameter.dataType === 'NUMBER' && parameter.minValue !== undefined && parameter.maxValue !== undefined && parameter.minValue > parameter.maxValue) throw new BusinessError(`${parameter.name}: minimum cannot exceed maximum`)
  if (parameter.dataType === 'TEXT' && !parameter.expectedText?.trim() && parameter.required) throw new BusinessError(`${parameter.name}: expected text is required`)
}

export async function createQualityTemplate(input: { code: string; name: string; inspectionType: 'INWARD' | 'PRODUCTION' | 'DISPATCH' | 'RETURN'; itemId?: string; notes?: string; parameters: ParameterInput[] }) {
  return db.$transaction(async (tx) => {
    const company = await org(tx); if (!input.parameters.length) throw new BusinessError('At least one QC parameter is required')
    input.parameters.forEach(validateParameter)
    if (new Set(input.parameters.map((row) => row.name.trim().toLowerCase())).size !== input.parameters.length) throw new BusinessError('QC parameter names must be unique')
    if (input.itemId && !(await tx.item.findUnique({ where: { id: input.itemId } }))) throw new BusinessError('Template item not found', 404)
    const previous = await tx.qualityTemplate.findFirst({ where: { companyId: company.id, code: input.code.trim() }, orderBy: { version: 'desc' } })
    if (previous) await tx.qualityTemplate.updateMany({ where: { companyId: company.id, code: input.code.trim(), active: true }, data: { active: false } })
    return tx.qualityTemplate.create({ data: { companyId: company.id, code: input.code.trim(), name: input.name.trim(), inspectionType: input.inspectionType, itemId: input.itemId, notes: input.notes, version: (previous?.version ?? 0) + 1,
      parameters: { create: input.parameters.map((parameter, index) => ({ ...parameter, name: parameter.name.trim(), expectedText: parameter.expectedText?.trim(), required: parameter.required ?? true, seq: parameter.seq ?? index })) } }, include: { parameters: { orderBy: { seq: 'asc' } }, item: true } })
  })
}

type MeasurementInput = { parameterId: string; numberValue?: number; textValue?: string; booleanValue?: boolean; remarks?: string }
export async function recordQualityInspection(input: { templateId: string; referenceType: string; referenceId: string; itemId?: string; inspectedBy?: string; disposition?: string; notes?: string; measurements: MeasurementInput[] }) {
  return db.$transaction(async (tx) => {
    const company = await org(tx)
    const template = await tx.qualityTemplate.findFirst({ where: { id: input.templateId, companyId: company.id, active: true }, include: { parameters: { orderBy: { seq: 'asc' } } } })
    if (!template) throw new BusinessError('Active QC template not found', 404)
    if (template.itemId && input.itemId && template.itemId !== input.itemId) throw new BusinessError('QC template belongs to a different item')
    const values = new Map(input.measurements.map((row) => [row.parameterId, row]))
    const evaluated = template.parameters.map((parameter) => {
      const value = values.get(parameter.id)
      if (!value && parameter.required) throw new BusinessError(`${parameter.name} is required`)
      if (!value) return { parameter, value: {} as MeasurementInput, passed: true }
      let passed = true
      if (parameter.dataType === 'NUMBER') {
        if (value.numberValue === undefined || !Number.isFinite(value.numberValue)) throw new BusinessError(`${parameter.name} requires a numeric value`)
        if (parameter.minValue !== null && value.numberValue < parameter.minValue) passed = false
        if (parameter.maxValue !== null && value.numberValue > parameter.maxValue) passed = false
      } else if (parameter.dataType === 'TEXT') {
        if (value.textValue === undefined) throw new BusinessError(`${parameter.name} requires text`)
        if (parameter.expectedText && value.textValue.trim().toLowerCase() !== parameter.expectedText.trim().toLowerCase()) passed = false
      } else {
        if (value.booleanValue === undefined) throw new BusinessError(`${parameter.name} requires yes/no`)
        passed = value.booleanValue
      }
      return { parameter, value, passed }
    })
    const failed = evaluated.filter((row) => !row.passed)
    const status = failed.length ? 'FAILED' : 'PASSED'
    const disposition = input.disposition ?? (status === 'PASSED' ? 'ACCEPT' : 'QUARANTINE')
    if (status === 'FAILED' && disposition === 'ACCEPT') throw new BusinessError('Failed inspection cannot have ACCEPT disposition')
    return tx.qualityInspection.create({ data: { companyId: company.id, inspectionNo: await inspectionNo(tx, company.id), inspectionType: template.inspectionType, referenceType: input.referenceType, referenceId: input.referenceId, templateId: template.id, itemId: input.itemId ?? template.itemId, status, inspectedBy: input.inspectedBy, inspectedAt: new Date(), disposition, notes: input.notes,
      resultsJson: JSON.stringify({ passed: evaluated.length - failed.length, failed: failed.length }), measurements: { create: evaluated.map(({ parameter, value, passed }) => ({ parameterId: parameter.id, numberValue: value.numberValue, textValue: value.textValue, booleanValue: value.booleanValue, passed, remarks: value.remarks })) } }, include: { template: true, item: true, measurements: { include: { parameter: true } } } })
  })
}

export async function qualityDashboard() {
  const company = await tenantCompany(db); if (!company) throw new BusinessError('Operating company is not configured', 409)
  const [templates, inspections] = await Promise.all([
    db.qualityTemplate.findMany({ where: { companyId: company.id }, orderBy: [{ code: 'asc' }, { version: 'desc' }], include: { item: true, parameters: { orderBy: { seq: 'asc' } } } }),
    db.qualityInspection.findMany({ where: { companyId: company.id }, orderBy: { createdAt: 'desc' }, take: 200, include: { template: true, item: true, measurements: { include: { parameter: true } } } }),
  ])
  return { templates, inspections, summary: { total: inspections.length, passed: inspections.filter((row) => row.status === 'PASSED').length, failed: inspections.filter((row) => row.status === 'FAILED').length, quarantined: inspections.filter((row) => row.disposition === 'QUARANTINE').length } }
}

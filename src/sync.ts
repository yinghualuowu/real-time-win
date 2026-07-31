import type { MatchRecord, StoredData } from './model'

export type StoredDataSettings = Pick<StoredData, 'initialScore' | 'winPoints' | 'lossPoints'>
export type SettingKey = keyof StoredDataSettings
export type RecordField = Exclude<keyof MatchRecord, 'id'>

export type RecordChange = {
  id: string
  before?: MatchRecord
  after?: MatchRecord
  changedFields: RecordField[]
}

export type StoredDataDiff = {
  changedSettings: SettingKey[]
  added: MatchRecord[]
  removed: MatchRecord[]
  changed: RecordChange[]
  hasChanges: boolean
}

export type RecordConflict = {
  id: string
  local: MatchRecord
  remote: MatchRecord
  differingFields: RecordField[]
  description: string
}

export type MergeResult = {
  data: StoredData
  conflicts: RecordConflict[]
}

export type ConflictChoice = 'local' | 'remote'

const settingKeys: SettingKey[] = ['initialScore', 'winPoints', 'lossPoints']
const recordFields: RecordField[] = ['date', 'order', 'teamSize', 'result', 'lane', 'points']

function cloneRecord(record: MatchRecord): MatchRecord {
  return { ...record }
}

function differingRecordFields(left: MatchRecord, right: MatchRecord): RecordField[] {
  return recordFields.filter((field) => left[field] !== right[field])
}

function recordsById(records: MatchRecord[]): Map<string, MatchRecord> {
  return new Map(records.map((record) => [record.id, record]))
}

export function diffStoredData(before: StoredData, after: StoredData): StoredDataDiff {
  const changedSettings = settingKeys.filter((key) => before[key] !== after[key])
  const beforeById = recordsById(before.records)
  const afterById = recordsById(after.records)
  const added: MatchRecord[] = []
  const removed: MatchRecord[] = []
  const changed: RecordChange[] = []

  for (const record of after.records) {
    const previous = beforeById.get(record.id)
    if (!previous) {
      added.push(cloneRecord(record))
      continue
    }
    const changedFields = differingRecordFields(previous, record)
    if (changedFields.length > 0) {
      changed.push({
        id: record.id,
        before: cloneRecord(previous),
        after: cloneRecord(record),
        changedFields,
      })
    }
  }

  for (const record of before.records) {
    if (!afterById.has(record.id)) removed.push(cloneRecord(record))
  }

  return {
    changedSettings,
    added,
    removed,
    changed,
    hasChanges: changedSettings.length + added.length + removed.length + changed.length > 0,
  }
}

export function reorderRecordsByDate(records: MatchRecord[]): MatchRecord[] {
  const sorted = records.map(cloneRecord).sort((left, right) =>
    left.date.localeCompare(right.date)
    || left.order - right.order
    || left.id.localeCompare(right.id),
  )
  const nextOrder = new Map<string, number>()
  return sorted.map((record) => {
    const order = (nextOrder.get(record.date) ?? 0) + 1
    nextOrder.set(record.date, order)
    return { ...record, order }
  })
}

export function mergeStoredData(local: StoredData, remote: StoredData): MergeResult {
  const remoteById = recordsById(remote.records)
  const mergedRecords = local.records.map(cloneRecord)
  const conflicts: RecordConflict[] = []

  for (const localRecord of local.records) {
    const remoteRecord = remoteById.get(localRecord.id)
    if (!remoteRecord) continue
    const differingFields = differingRecordFields(localRecord, remoteRecord)
    if (differingFields.length > 0) {
      conflicts.push({
        id: localRecord.id,
        local: cloneRecord(localRecord),
        remote: cloneRecord(remoteRecord),
        differingFields,
        description: `记录 ${localRecord.id} 的 ${differingFields.join(', ')} 字段存在冲突`,
      })
    }
  }

  const localIds = new Set(local.records.map((record) => record.id))
  for (const remoteRecord of remote.records) {
    if (!localIds.has(remoteRecord.id)) mergedRecords.push(cloneRecord(remoteRecord))
  }

  return {
    data: {
      ...local,
      records: reorderRecordsByDate(mergedRecords),
    },
    conflicts,
  }
}

export function resolveRecordConflicts(
  result: MergeResult,
  choices: Readonly<Record<string, ConflictChoice>>,
): StoredData {
  const selected = new Map(
    result.conflicts.map((conflict) => [
      conflict.id,
      choices[conflict.id] === 'remote' ? conflict.remote : conflict.local,
    ]),
  )
  return {
    ...result.data,
    records: reorderRecordsByDate(result.data.records.map((record) =>
      cloneRecord(selected.get(record.id) ?? record),
    )),
  }
}

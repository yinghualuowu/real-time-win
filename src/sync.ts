import type { Hero, MatchRecord, Season, StoredData } from './model'

export type StoredDataSettings = Pick<StoredData, 'initialScore' | 'winPoints' | 'lossPoints'>
export type SettingKey = keyof StoredDataSettings
export type RecordField = Exclude<keyof MatchRecord, 'id'>
export type SeasonField = Exclude<keyof Season, 'id'>
export type HeroField = Exclude<keyof Hero, 'id'>

export type RecordChange = {
  id: string
  before?: MatchRecord
  after?: MatchRecord
  changedFields: RecordField[]
}

export type StoredDataDiff = {
  changedSettings: SettingKey[]
  seasons: EntityDiff<Season, SeasonField>
  heroes: EntityDiff<Hero, HeroField>
  added: MatchRecord[]
  removed: MatchRecord[]
  changed: RecordChange[]
  hasChanges: boolean
}

export type EntityChange<T, Field extends keyof T> = {
  id: string
  before?: T
  after?: T
  changedFields: Field[]
}

export type EntityDiff<T, Field extends keyof T> = {
  added: T[]
  removed: T[]
  changed: EntityChange<T, Field>[]
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
  seasonConflicts: EntityConflict<Season, SeasonField>[]
  heroConflicts: EntityConflict<Hero, HeroField>[]
}

export type ConflictChoice = 'local' | 'remote'
export type EntityConflict<T, Field extends keyof T> = {
  id: string
  local: T
  remote: T
  differingFields: Field[]
  description: string
}

export type DataConflictChoices = {
  records?: Readonly<Record<string, ConflictChoice>>
  seasons?: Readonly<Record<string, ConflictChoice>>
  heroes?: Readonly<Record<string, ConflictChoice>>
}

const settingKeys: SettingKey[] = ['initialScore', 'winPoints', 'lossPoints']
const recordFields: RecordField[] = ['date', 'order', 'teamSize', 'result', 'lane', 'points', 'heroId']
const seasonFields: SeasonField[] = ['name', 'startDate', 'endDate']
const heroFields: HeroField[] = ['name']

function cloneRecord(record: MatchRecord): MatchRecord {
  return { ...record }
}

function differingRecordFields(left: MatchRecord, right: MatchRecord): RecordField[] {
  return recordFields.filter((field) =>
    field === 'heroId'
      ? (left.heroId ?? null) !== (right.heroId ?? null)
      : left[field] !== right[field],
  )
}

function recordsById(records: MatchRecord[]): Map<string, MatchRecord> {
  return new Map(records.map((record) => [record.id, record]))
}

function diffEntities<T extends { id: string }, Field extends Exclude<keyof T, 'id'>>(
  before: readonly T[],
  after: readonly T[],
  fields: readonly Field[],
): EntityDiff<T, Field> {
  const beforeById = new Map(before.map((item) => [item.id, item]))
  const afterById = new Map(after.map((item) => [item.id, item]))
  const added = after.filter((item) => !beforeById.has(item.id)).map((item) => ({ ...item }))
  const removed = before.filter((item) => !afterById.has(item.id)).map((item) => ({ ...item }))
  const changed = after.flatMap((item) => {
    const previous = beforeById.get(item.id)
    if (!previous) return []
    const changedFields = fields.filter((field) => previous[field] !== item[field])
    return changedFields.length === 0 ? [] : [{
      id: item.id,
      before: { ...previous },
      after: { ...item },
      changedFields,
    }]
  })
  return {
    added,
    removed,
    changed,
    hasChanges: added.length + removed.length + changed.length > 0,
  }
}

export function diffStoredData(before: StoredData, after: StoredData): StoredDataDiff {
  const changedSettings = settingKeys.filter((key) => before[key] !== after[key])
  const seasons = diffEntities(before.seasons, after.seasons, seasonFields)
  const heroes = diffEntities(before.heroes, after.heroes, heroFields)
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
    seasons,
    heroes,
    added,
    removed,
    changed,
    hasChanges: changedSettings.length + added.length + removed.length + changed.length > 0
      || seasons.hasChanges
      || heroes.hasChanges,
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
  const { merged: seasons, conflicts: seasonConflicts } = mergeEntities(
    local.seasons,
    remote.seasons,
    seasonFields,
    '赛季',
  )
  const { merged: heroes, conflicts: heroConflicts } = mergeEntities(
    local.heroes,
    remote.heroes,
    heroFields,
    '英雄',
  )

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
      seasons,
      heroes,
      records: reorderRecordsByDate(mergedRecords),
    },
    conflicts,
    seasonConflicts,
    heroConflicts,
  }
}

function mergeEntities<T extends { id: string }, Field extends Exclude<keyof T, 'id'>>(
  local: readonly T[],
  remote: readonly T[],
  fields: readonly Field[],
  label: string,
): { merged: T[], conflicts: EntityConflict<T, Field>[] } {
  const remoteById = new Map(remote.map((item) => [item.id, item]))
  const merged = local.map((item) => ({ ...item }))
  const conflicts: EntityConflict<T, Field>[] = []
  for (const localItem of local) {
    const remoteItem = remoteById.get(localItem.id)
    if (!remoteItem) continue
    const differingFields = fields.filter((field) => localItem[field] !== remoteItem[field])
    if (differingFields.length > 0) {
      conflicts.push({
        id: localItem.id,
        local: { ...localItem },
        remote: { ...remoteItem },
        differingFields,
        description: `${label} ${localItem.id} 的 ${differingFields.join(', ')} 字段存在冲突`,
      })
    }
  }
  const localIds = new Set(local.map((item) => item.id))
  for (const remoteItem of remote) {
    if (!localIds.has(remoteItem.id)) merged.push({ ...remoteItem })
  }
  return { merged, conflicts }
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

function resolveEntities<T extends { id: string }, Field extends keyof T>(
  entities: readonly T[],
  conflicts: readonly EntityConflict<T, Field>[],
  choices: Readonly<Record<string, ConflictChoice>>,
): T[] {
  const selected = new Map(conflicts.map((conflict) => [
    conflict.id,
    choices[conflict.id] === 'remote' ? conflict.remote : conflict.local,
  ]))
  return entities.map((entity) => ({ ...(selected.get(entity.id) ?? entity) }))
}

export function resolveDataConflicts(
  result: MergeResult,
  choices: DataConflictChoices,
): StoredData {
  const recordsResolved = resolveRecordConflicts(result, choices.records ?? {})
  return {
    ...recordsResolved,
    seasons: resolveEntities(result.data.seasons, result.seasonConflicts, choices.seasons ?? {}),
    heroes: resolveEntities(result.data.heroes, result.heroConflicts, choices.heroes ?? {}),
  }
}

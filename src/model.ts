export type MatchResult = 0 | 1
export type Lane = 0 | 1 | 2 | 3 | 4
export type AnalysisDimension = 'date' | 'teamSize' | 'lane'
export type GroupDimension = 'overall' | 'teamSize' | 'lane'
export type MetricKey = 'games' | 'wins' | 'rate' | 'points'
export type ChartType = 'auto' | 'line' | 'bar' | 'scatter' | 'pie'
export type PeriodPreset = 'week' | 'month' | 'last7' | 'last30' | 'custom'
export type GamePlatform = 'Q' | 'V'

export type GameProfile = {
  id: string
  nickname: string
  platform: GamePlatform
}

export type Season = {
  id: string
  name: string
  startDate: string
  endDate: string
}

export type Hero = {
  id: string
  name: string
}

export type MatchRecord = {
  id: string
  date: string
  order: number
  teamSize: number
  result: MatchResult
  lane: Lane | null
  points: number
  heroId?: string | null
}

export type StoredData = {
  schemaVersion: 3
  initialScore: number
  winPoints: number
  lossPoints: number
  seasons: Season[]
  heroes: Hero[]
  records: MatchRecord[]
}

export const initialData: StoredData = {
  schemaVersion: 3,
  initialScore: 100,
  winPoints: 10,
  lossPoints: 10,
  seasons: [],
  heroes: [],
  records: [
    { id: 'sample-1', date: '2026-07-28', order: 1, teamSize: 2, result: 1, lane: 0, points: 10, heroId: null },
    { id: 'sample-2', date: '2026-07-28', order: 2, teamSize: 2, result: 1, lane: 1, points: 10, heroId: null },
    { id: 'sample-3', date: '2026-07-28', order: 3, teamSize: 1, result: 0, lane: 2, points: -10, heroId: null },
  ],
}

export function newId() {
  return crypto.randomUUID?.() ?? `${Date.now()}-${Math.random().toString(16).slice(2)}`
}

export function modeName(size: number) {
  const names: Record<number, string> = { 1: '单排', 2: '双排', 3: '三排', 4: '四排', 5: '五排' }
  return names[size] ?? `${size}人组排`
}

export function laneName(lane: Lane | null) {
  if (lane === null) return '未设置'
  return ['对抗路', '打野', '中路', '发育路', '游走'][lane]
}

export function percent(wins: number, total: number) {
  return total ? ((wins / total) * 100).toFixed(2) : '0.00'
}

function objectValue(value: unknown, message: string): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error(message)
  return value as Record<string, unknown>
}

export function parseDateString(value: string): Date {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) throw new Error(`invalid date: ${value}`)
  const [year, month, day] = value.split('-').map(Number)
  const parsed = new Date(Date.UTC(year, month - 1, day))
  if (
    parsed.getUTCFullYear() !== year
    || parsed.getUTCMonth() !== month - 1
    || parsed.getUTCDate() !== day
  ) throw new Error(`invalid date: ${value}`)
  return parsed
}

export function dateInSeason(date: string, season: Season): boolean {
  parseDateString(date)
  parseDateString(season.startDate)
  parseDateString(season.endDate)
  return date >= season.startDate && date <= season.endDate
}

export function validateSeasons(seasons: readonly Season[]): void {
  const ids = new Set<string>()
  const names = new Set<string>()
  const sorted = [...seasons].sort((left, right) =>
    left.startDate.localeCompare(right.startDate) || left.endDate.localeCompare(right.endDate),
  )
  for (const season of sorted) {
    if (!season.id.trim() || !season.name.trim()) throw new Error('invalid season')
    if (ids.has(season.id)) throw new Error(`duplicate season id: ${season.id}`)
    const nameKey = season.name.trim().toLocaleLowerCase()
    if (names.has(nameKey)) throw new Error(`duplicate season name: ${season.name}`)
    ids.add(season.id)
    names.add(nameKey)
    parseDateString(season.startDate)
    parseDateString(season.endDate)
    if (season.startDate > season.endDate) throw new Error(`invalid season range: ${season.name}`)
  }
  for (let index = 1; index < sorted.length; index += 1) {
    if (sorted[index].startDate <= sorted[index - 1].endDate) {
      throw new Error(`overlapping seasons: ${sorted[index - 1].name}, ${sorted[index].name}`)
    }
  }
}

export function validateHeroes(heroes: readonly Hero[]): void {
  const ids = new Set<string>()
  const names = new Set<string>()
  for (const hero of heroes) {
    if (!hero.id.trim() || !hero.name.trim()) throw new Error('invalid hero')
    if (ids.has(hero.id)) throw new Error(`duplicate hero id: ${hero.id}`)
    const nameKey = hero.name.trim().toLocaleLowerCase()
    if (names.has(nameKey)) throw new Error(`duplicate hero name: ${hero.name}`)
    ids.add(hero.id)
    names.add(nameKey)
  }
}

export function validateReferences(data: Pick<StoredData, 'heroes' | 'records'>): void {
  const heroIds = new Set(data.heroes.map(({ id }) => id))
  for (const record of data.records) {
    if (record.heroId != null && !heroIds.has(record.heroId)) {
      throw new Error(`unknown hero reference: ${record.heroId}`)
    }
  }
}

type NormalizeOptions = {
  strictV3: boolean
}

function normalizeDataInternal(value: unknown, { strictV3 }: NormalizeOptions): StoredData {
  const source = objectValue(value, 'data must be an object')
  if (strictV3 && source.schemaVersion !== 3) throw new Error('schemaVersion must be 3')
  if (
    strictV3
    && (typeof source.initialScore !== 'number'
      || typeof source.winPoints !== 'number'
      || typeof source.lossPoints !== 'number')
  ) throw new Error('invalid score settings')
  if (strictV3 && (!Array.isArray(source.seasons) || !Array.isArray(source.heroes))) {
    throw new Error('seasons and heroes must be arrays')
  }
  if (!Array.isArray(source.records)) throw new Error('records must be an array')
  const seasons = (Array.isArray(source.seasons) ? source.seasons : []).map((raw) => {
    const season = objectValue(raw, 'invalid season')
    if (
      strictV3
      && (typeof season.id !== 'string'
        || typeof season.name !== 'string'
        || typeof season.startDate !== 'string'
        || typeof season.endDate !== 'string')
    ) throw new Error('invalid season')
    return {
      id: String(season.id ?? ''),
      name: String(season.name ?? '').trim(),
      startDate: String(season.startDate ?? ''),
      endDate: String(season.endDate ?? ''),
    }
  })
  const heroes = (Array.isArray(source.heroes) ? source.heroes : []).map((raw) => {
    const hero = objectValue(raw, 'invalid hero')
    if (strictV3 && (typeof hero.id !== 'string' || typeof hero.name !== 'string')) {
      throw new Error('invalid hero')
    }
    return {
      id: String(hero.id ?? ''),
      name: String(hero.name ?? '').trim(),
    }
  })
  validateSeasons(seasons)
  validateHeroes(heroes)

  const dayOrder = new Map<string, number>()
  const records = source.records.map((raw) => {
    const record = objectValue(raw, 'invalid match record')
    if (
      strictV3
      && (typeof record.id !== 'string'
        || typeof record.date !== 'string'
        || typeof record.order !== 'number'
        || typeof record.teamSize !== 'number'
        || typeof record.result !== 'number'
        || (record.lane !== null && typeof record.lane !== 'number')
        || typeof record.points !== 'number'
        || (record.heroId !== null && typeof record.heroId !== 'string'))
    ) throw new Error('invalid match record')
    const date = String(record.date ?? '')
    const nextOrder = (dayOrder.get(date) ?? 0) + 1
    const order = Number(record.order ?? nextOrder)
    const laneValue = record.lane === undefined || record.lane === null ? null : Number(record.lane)
    const heroId = record.heroId === undefined || record.heroId === null ? null : String(record.heroId)
    const normalized: MatchRecord = {
      id: String(record.id || newId()),
      date,
      order,
      teamSize: Number(record.teamSize),
      result: Number(record.result) as MatchResult,
      lane: laneValue as Lane | null,
      points: Number(record.points ?? (Number(record.result) === 1 ? source.winPoints ?? 10 : -Number(source.lossPoints ?? 10))),
      heroId,
    }
    parseDateString(normalized.date)
    if (
      !normalized.id.trim()
      || !Number.isInteger(normalized.order)
      || normalized.order < 1
      || !Number.isInteger(normalized.teamSize)
      || normalized.teamSize < 1
      || normalized.teamSize > 5
      || ![0, 1].includes(normalized.result)
      || !Number.isFinite(normalized.points)
      || (normalized.lane !== null && ![0, 1, 2, 3, 4].includes(normalized.lane))
    ) throw new Error('invalid match record')
    dayOrder.set(date, Math.max(nextOrder, order))
    return normalized
  })

  const recordIds = new Set<string>()
  for (const record of records) {
    if (recordIds.has(record.id)) throw new Error(`duplicate record id: ${record.id}`)
    recordIds.add(record.id)
  }

  const normalized: StoredData = {
    schemaVersion: 3,
    initialScore: Number(source.initialScore ?? 100),
    winPoints: Math.max(0, Number(source.winPoints ?? 10)),
    lossPoints: Math.max(0, Number(source.lossPoints ?? 10)),
    seasons,
    heroes,
    records,
  }
  if (
    !Number.isFinite(normalized.initialScore)
    || !Number.isFinite(normalized.winPoints)
    || !Number.isFinite(normalized.lossPoints)
  ) throw new Error('invalid score settings')
  validateReferences(normalized)
  return normalized
}

export function normalizeData(value: unknown): StoredData {
  return normalizeDataInternal(value, { strictV3: false })
}

export function normalizeImportedData(value: unknown): StoredData {
  return normalizeDataInternal(value, { strictV3: true })
}

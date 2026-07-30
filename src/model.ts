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

export type MatchRecord = {
  id: string
  date: string
  order: number
  teamSize: number
  result: MatchResult
  lane: Lane | null
  points: number
}

export type StoredData = {
  schemaVersion: 2
  initialScore: number
  winPoints: number
  lossPoints: number
  records: MatchRecord[]
}

export const initialData: StoredData = {
  schemaVersion: 2,
  initialScore: 100,
  winPoints: 10,
  lossPoints: 10,
  records: [
    { id: 'sample-1', date: '2026-07-28', order: 1, teamSize: 2, result: 1, lane: 0, points: 10 },
    { id: 'sample-2', date: '2026-07-28', order: 2, teamSize: 2, result: 1, lane: 1, points: 10 },
    { id: 'sample-3', date: '2026-07-28', order: 3, teamSize: 1, result: 0, lane: 2, points: -10 },
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

export function normalizeData(value: unknown): StoredData {
  const source = (value && typeof value === 'object' ? value : {}) as Partial<StoredData>
  if (!Array.isArray(source.records)) throw new Error('records must be an array')
  const dayOrder = new Map<string, number>()
  const records = source.records.map((raw) => {
    const record = raw as Partial<MatchRecord>
    const date = String(record.date ?? '')
    const nextOrder = (dayOrder.get(date) ?? 0) + 1
    const order = Number(record.order ?? nextOrder)
    const laneValue = record.lane === undefined || record.lane === null ? null : Number(record.lane)
    const normalized: MatchRecord = {
      id: String(record.id || newId()),
      date,
      order,
      teamSize: Number(record.teamSize),
      result: Number(record.result) as MatchResult,
      lane: laneValue as Lane | null,
      points: Number(record.points ?? (Number(record.result) === 1 ? source.winPoints ?? 10 : -(source.lossPoints ?? 10))),
    }
    if (
      !/^\d{4}-\d{2}-\d{2}$/.test(normalized.date)
      || normalized.order < 1
      || normalized.teamSize < 1
      || normalized.teamSize > 5
      || ![0, 1].includes(normalized.result)
      || !Number.isFinite(normalized.points)
      || (normalized.lane !== null && ![0, 1, 2, 3, 4].includes(normalized.lane))
    ) throw new Error('invalid match record')
    dayOrder.set(date, Math.max(nextOrder, order))
    return normalized
  })

  return {
    schemaVersion: 2,
    initialScore: Number(source.initialScore ?? 100),
    winPoints: Math.max(0, Number(source.winPoints ?? 10)),
    lossPoints: Math.max(0, Number(source.lossPoints ?? 10)),
    records,
  }
}

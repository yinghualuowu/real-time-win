import { laneName, modeName } from '../model'
import type { GroupDimension, MatchRecord, MetricKey, PeriodPreset } from '../model'

export type Stats = { games: number; wins: number; rate: number; points: number }
export type DateRange = { start: string; end: string; label: string }
export type ComparisonRow = {
  key: string
  label: string
  previous: Stats
  current: Stats
  difference: number
  changeRate: number | null
}

export function calculateStats(records: MatchRecord[]): Stats {
  const games = records.length
  const wins = records.filter((record) => record.result === 1).length
  return {
    games,
    wins,
    rate: games ? (wins / games) * 100 : 0,
    points: records.reduce((total, record) => total + record.points, 0),
  }
}

function toDate(value: string) {
  return new Date(`${value}T00:00:00`)
}

function dateString(value: Date) {
  const year = value.getFullYear()
  const month = String(value.getMonth() + 1).padStart(2, '0')
  const day = String(value.getDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}

function addDays(value: Date, amount: number) {
  const result = new Date(value)
  result.setDate(result.getDate() + amount)
  return result
}

function endOfMonth(value: Date) {
  return new Date(value.getFullYear(), value.getMonth() + 1, 0)
}

export function getPresetRanges(preset: Exclude<PeriodPreset, 'custom'>, today = new Date()): { previous: DateRange; current: DateRange } {
  const day = new Date(today.getFullYear(), today.getMonth(), today.getDate())
  if (preset === 'week') {
    const offset = (day.getDay() + 6) % 7
    const currentStart = addDays(day, -offset)
    const previousStart = addDays(currentStart, -7)
    return {
      previous: { start: dateString(previousStart), end: dateString(addDays(previousStart, 6)), label: '上周' },
      current: { start: dateString(currentStart), end: dateString(addDays(currentStart, 6)), label: '本周' },
    }
  }
  if (preset === 'month') {
    const currentStart = new Date(day.getFullYear(), day.getMonth(), 1)
    const previousStart = new Date(day.getFullYear(), day.getMonth() - 1, 1)
    return {
      previous: { start: dateString(previousStart), end: dateString(endOfMonth(previousStart)), label: '上月' },
      current: { start: dateString(currentStart), end: dateString(endOfMonth(currentStart)), label: '本月' },
    }
  }
  const days = preset === 'last7' ? 7 : 30
  return {
    previous: { start: dateString(addDays(day, -(days * 2 - 1))), end: dateString(addDays(day, -days)), label: `前 ${days} 天` },
    current: { start: dateString(addDays(day, -(days - 1))), end: dateString(day), label: `近 ${days} 天` },
  }
}

function groupKey(record: MatchRecord, dimension: GroupDimension) {
  if (dimension === 'teamSize') return String(record.teamSize)
  if (dimension === 'lane') return record.lane === null ? 'unknown' : String(record.lane)
  return 'overall'
}

function groupLabel(key: string, dimension: GroupDimension) {
  if (dimension === 'teamSize') return modeName(Number(key))
  if (dimension === 'lane') return key === 'unknown' ? '未设置' : laneName(Number(key) as 0 | 1 | 2 | 3 | 4)
  return '总体'
}

function filterRange(records: MatchRecord[], range: DateRange) {
  return records.filter((record) => record.date >= range.start && record.date <= range.end)
}

function metricValue(stats: Stats, metric: MetricKey) {
  return stats[metric]
}

export function comparePeriods(
  records: MatchRecord[],
  previousRange: DateRange,
  currentRange: DateRange,
  dimension: GroupDimension,
  metric: MetricKey,
): ComparisonRow[] {
  const previousRecords = filterRange(records, previousRange)
  const currentRecords = filterRange(records, currentRange)
  const keys = new Set([
    ...previousRecords.map((record) => groupKey(record, dimension)),
    ...currentRecords.map((record) => groupKey(record, dimension)),
  ])
  if (dimension === 'overall') keys.add('overall')

  return [...keys].sort().map((key) => {
    const previous = calculateStats(previousRecords.filter((record) => groupKey(record, dimension) === key))
    const current = calculateStats(currentRecords.filter((record) => groupKey(record, dimension) === key))
    const previousValue = metricValue(previous, metric)
    const currentValue = metricValue(current, metric)
    return {
      key,
      label: groupLabel(key, dimension),
      previous,
      current,
      difference: currentValue - previousValue,
      changeRate: previousValue === 0 ? null : ((currentValue - previousValue) / Math.abs(previousValue)) * 100,
    }
  })
}

export function inclusiveDayCount(range: Pick<DateRange, 'start' | 'end'>) {
  return Math.floor((toDate(range.end).getTime() - toDate(range.start).getTime()) / 86400000) + 1
}

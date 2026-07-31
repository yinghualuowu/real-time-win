import { laneName, modeName, percent } from '../model'
import type { AnalysisDimension, Lane, MatchRecord } from '../model'

export type AnalysisGranularity = 'day' | 'week' | 'month'

export type CustomAnalysisRow = {
  key: string
  label: string
  games: number
  wins: number
  rate: number
  points: number
  score: number | null
}

function isoDate(date: Date) {
  return date.toISOString().slice(0, 10)
}

function dateGroup(dateValue: string, granularity: AnalysisGranularity) {
  if (granularity === 'month') {
    const key = dateValue.slice(0, 7)
    return { key, label: key }
  }
  if (granularity === 'week') {
    const date = new Date(`${dateValue}T00:00:00Z`)
    const day = date.getUTCDay() || 7
    date.setUTCDate(date.getUTCDate() - day + 1)
    const start = isoDate(date)
    date.setUTCDate(date.getUTCDate() + 6)
    const end = isoDate(date)
    return { key: start, label: `${start.slice(5)} ~ ${end.slice(5)}` }
  }
  return { key: dateValue, label: dateValue.slice(5) }
}

export function buildCustomAnalysisRows(
  records: MatchRecord[],
  dimension: AnalysisDimension,
  granularity: AnalysisGranularity,
  initialScore: number,
  startDate = '',
  endDate = '',
): CustomAnalysisRow[] {
  const sorted = [...records].sort((left, right) =>
    left.date.localeCompare(right.date)
    || left.order - right.order
    || left.id.localeCompare(right.id),
  )
  const filtered = sorted.filter((record) =>
    (!startDate || record.date >= startDate)
    && (!endDate || record.date <= endDate),
  )
  const groups = new Map<string, Omit<CustomAnalysisRow, 'rate' | 'score'>>()

  filtered.forEach((record) => {
    const group = dimension === 'date'
      ? dateGroup(record.date, granularity)
      : dimension === 'teamSize'
        ? { key: String(record.teamSize), label: modeName(record.teamSize) }
        : {
            key: record.lane === null ? 'unknown' : String(record.lane),
            label: laneName(record.lane as Lane | null),
          }
    const current = groups.get(group.key) ?? {
      ...group,
      games: 0,
      wins: 0,
      points: 0,
    }
    current.games += 1
    current.wins += record.result
    current.points += record.points
    groups.set(group.key, current)
  })

  const rows = [...groups.values()]
    .sort((left, right) => {
      if (dimension === 'lane' && left.key === 'unknown') return 1
      if (dimension === 'lane' && right.key === 'unknown') return -1
      return left.key.localeCompare(right.key, undefined, { numeric: true })
    })
    .map((row) => ({
      ...row,
      rate: Number(percent(row.wins, row.games)),
      score: null as number | null,
    }))

  if (dimension === 'date') {
    let runningScore = initialScore + sorted
      .filter((record) => startDate && record.date < startDate)
      .reduce((total, record) => total + record.points, 0)
    rows.forEach((row) => {
      runningScore += row.points
      row.score = runningScore
    })
  }

  return rows
}

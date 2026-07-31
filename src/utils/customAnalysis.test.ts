import { describe, expect, it } from 'vitest'
import type { MatchRecord } from '../model'
import { buildCustomAnalysisRows } from './customAnalysis'

const records: MatchRecord[] = [
  { id: '1', date: '2026-07-31', order: 1, teamSize: 2, result: 1, lane: 0, points: 10 },
  { id: '2', date: '2026-08-01', order: 1, teamSize: 2, result: 0, lane: 1, points: -10 },
  { id: '3', date: '2026-08-03', order: 1, teamSize: 3, result: 1, lane: 1, points: 20 },
]

describe('buildCustomAnalysisRows', () => {
  it('calculates cumulative score from before the selected range', () => {
    const rows = buildCustomAnalysisRows(records, 'date', 'day', 100, '2026-08-01', '2026-08-03')

    expect(rows.map(({ key, points, score }) => ({ key, points, score }))).toEqual([
      { key: '2026-08-01', points: -10, score: 100 },
      { key: '2026-08-03', points: 20, score: 120 },
    ])
  })

  it('groups a date range by ISO week', () => {
    const rows = buildCustomAnalysisRows(records, 'date', 'week', 100, '2026-07-31', '2026-08-03')

    expect(rows.map(({ key, games, score }) => ({ key, games, score }))).toEqual([
      { key: '2026-07-27', games: 2, score: 100 },
      { key: '2026-08-03', games: 1, score: 120 },
    ])
  })

  it('applies the range before grouping non-date dimensions', () => {
    const rows = buildCustomAnalysisRows(records, 'teamSize', 'month', 100, '2026-08-01', '2026-08-31')

    expect(rows.map(({ label, games, points, score }) => ({ label, games, points, score }))).toEqual([
      { label: '双排', games: 1, points: -10, score: null },
      { label: '三排', games: 1, points: 20, score: null },
    ])
  })
})

import { describe, expect, it } from 'vitest'
import { normalizeData } from '../model'
import type { MatchRecord } from '../model'
import { comparePeriods, getPresetRanges, inclusiveDayCount } from './analytics'

function record(id: string, date: string, result: 0 | 1, lane: 0 | 1 | 2 | 3 | 4 = 0, teamSize = 1): MatchRecord {
  return { id, date, order: Number(id.replace(/\D/g, '')) || 1, teamSize, result, lane, points: result ? 10 : -10 }
}

describe('period analytics', () => {
  it('builds calendar week ranges across month boundaries', () => {
    const ranges = getPresetRanges('week', new Date(2026, 7, 2))
    expect(ranges.current).toMatchObject({ start: '2026-07-27', end: '2026-08-02' })
    expect(ranges.previous).toMatchObject({ start: '2026-07-20', end: '2026-07-26' })
  })

  it('builds full previous and current month ranges', () => {
    const ranges = getPresetRanges('month', new Date(2026, 2, 15))
    expect(ranges.previous).toMatchObject({ start: '2026-02-01', end: '2026-02-28' })
    expect(ranges.current).toMatchObject({ start: '2026-03-01', end: '2026-03-31' })
  })

  it('calculates a 20 percentage point weekly increase', () => {
    const previous = { start: '2026-07-20', end: '2026-07-26', label: '上周' }
    const current = { start: '2026-07-27', end: '2026-08-02', label: '本周' }
    const records = [
      ...Array.from({ length: 10 }, (_, index) => record(`p${index + 1}`, '2026-07-21', index < 3 ? 1 : 0)),
      ...Array.from({ length: 10 }, (_, index) => record(`c${index + 1}`, '2026-07-28', index < 5 ? 1 : 0)),
    ]
    const [comparison] = comparePeriods(records, previous, current, 'overall', 'rate')
    expect(comparison.previous.rate).toBe(30)
    expect(comparison.current.rate).toBe(50)
    expect(comparison.difference).toBe(20)
  })

  it('compares any lane and returns empty-side values', () => {
    const previous = { start: '2026-07-01', end: '2026-07-07', label: '对比期' }
    const current = { start: '2026-07-08', end: '2026-07-14', label: '当前期' }
    const rows = comparePeriods([
      record('1', '2026-07-02', 0, 0),
      record('2', '2026-07-09', 1, 0),
      record('3', '2026-07-10', 1, 1),
    ], previous, current, 'lane', 'points')
    expect(rows.map((row) => row.label)).toEqual(['对抗路', '打野'])
    expect(rows[0].difference).toBe(20)
    expect(rows[1].previous.games).toBe(0)
  })

  it('supports inclusive custom ranges', () => {
    expect(inclusiveDayCount({ start: '2026-07-01', end: '2026-07-07' })).toBe(7)
  })
})

describe('legacy JSON migration', () => {
  it('adds schema version, same-day order, and nullable lane', () => {
    const data = normalizeData({
      initialScore: 100,
      records: [
        { id: 'a', date: '2026-07-28', teamSize: 2, result: 1 },
        { id: 'b', date: '2026-07-28', teamSize: 1, result: 0 },
      ],
    })
    expect(data.schemaVersion).toBe(3)
    expect(data.seasons).toEqual([])
    expect(data.heroes).toEqual([])
    expect(data.records.map((item) => item.order)).toEqual([1, 2])
    expect(data.records.every((item) => item.lane === null)).toBe(true)
    expect(data.records.every((item) => item.heroId === null)).toBe(true)
    expect(data.records.map((item) => item.points)).toEqual([10, -10])
  })

  it('rejects invalid lane values', () => {
    expect(() => normalizeData({
      records: [{ date: '2026-07-28', teamSize: 2, result: 1, lane: 9 }],
    })).toThrow('invalid match record')
  })
})

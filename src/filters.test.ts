import { describe, expect, it } from 'vitest'
import { emptyRecentMatchFilters, filterRecentRecords, laneTone, teamSizeTone } from './filters'
import type { MatchRecord, Season } from './model'

const records: MatchRecord[] = [
  { id: '1', date: '2026-07-01', order: 1, teamSize: 1, result: 1, lane: 0, points: 10, heroId: 'h1' },
  { id: '2', date: '2026-07-02', order: 1, teamSize: 3, result: 0, lane: 2, points: -10, heroId: 'h2' },
  { id: '3', date: '2026-07-03', order: 1, teamSize: 3, result: 1, lane: null, points: 10, heroId: null },
]
const seasons: Season[] = [{ id: 's1', name: 'S1', startDate: '2026-07-01', endDate: '2026-07-02' }]

describe('filterRecentRecords', () => {
  it('returns all records with empty filters', () => {
    expect(filterRecentRecords(records, emptyRecentMatchFilters)).toEqual(records)
  })

  it('combines date, team, lane and result filters', () => {
    expect(filterRecentRecords(records, {
      ...emptyRecentMatchFilters,
      startDate: '2026-07-02',
      endDate: '2026-07-03',
      teamSize: 3,
      lane: 2,
      result: 0,
    })).toEqual([records[1]])
  })

  it('can filter records whose lane is unset', () => {
    expect(filterRecentRecords(records, {
      ...emptyRecentMatchFilters,
      lane: null,
    })).toEqual([records[2]])
  })

  it('filters by derived season and linked hero', () => {
    expect(filterRecentRecords(records, {
      ...emptyRecentMatchFilters,
      seasonId: 's1',
      heroId: 'h2',
    }, seasons)).toEqual([records[1]])
    expect(filterRecentRecords(records, {
      ...emptyRecentMatchFilters,
      seasonId: 'unmatched',
      heroId: 'unassigned',
    }, seasons)).toEqual([records[2]])
  })
})

describe('record tones', () => {
  it('returns stable classes for team size and lane', () => {
    expect(teamSizeTone(3)).toBe('tone-mode-3')
    expect(laneTone(2)).toBe('tone-lane-2')
    expect(laneTone(null)).toBe('tone-lane-unknown')
  })
})

import { describe, expect, it } from 'vitest'
import type { Hero, MatchRecord, Season } from '../model'
import {
  buildHeroFrequencyRows, buildHeroStats, recordsForSeason, seasonForDate, summarizeRecords,
} from './catalog'

const seasons: Season[] = [
  { id: 's1', name: 'S1', startDate: '2026-01-01', endDate: '2026-03-31' },
  { id: 's2', name: 'S2', startDate: '2026-04-01', endDate: '2026-06-30' },
]
const heroes: Hero[] = [{ id: 'h1', name: '英雄甲' }, { id: 'h2', name: '英雄乙' }]
const records: MatchRecord[] = [
  { id: '1', date: '2026-03-31', order: 1, teamSize: 2, result: 1, lane: 0, points: 10, heroId: 'h1' },
  { id: '2', date: '2026-04-01', order: 1, teamSize: 2, result: 0, lane: 1, points: -10, heroId: 'h1' },
]

describe('season catalog', () => {
  it('matches inclusive boundaries and filters records', () => {
    expect(seasonForDate(seasons, '2026-03-31')?.id).toBe('s1')
    expect(seasonForDate(seasons, '2026-04-01')?.id).toBe('s2')
    expect(recordsForSeason(records, seasons, 's1').map(({ id }) => id)).toEqual(['1'])
  })
})

describe('hero summaries', () => {
  it('summarizes records and keeps heroes without matches', () => {
    expect(summarizeRecords(records)).toMatchObject({ games: 2, wins: 1, losses: 1, rate: '50.00', points: 0 })
    expect(buildHeroStats(records, heroes)).toMatchObject([
      { hero: { id: 'h1' }, games: 2, wins: 1 },
      { hero: { id: 'h2' }, games: 0, wins: 0 },
    ])
  })

  it('sorts quick-record heroes by frequency and counts each team size', () => {
    expect(buildHeroFrequencyRows(records, heroes)).toEqual([
      { hero: heroes[0], games: 2, teamCounts: [0, 2, 0, 0, 0] },
      { hero: heroes[1], games: 0, teamCounts: [0, 0, 0, 0, 0] },
    ])
  })
})

import { describe, expect, it } from 'vitest'
import {
  dateInSeason,
  normalizeData,
  normalizeImportedData,
  parseDateString,
} from './model'

function v3Document() {
  return {
    schemaVersion: 3,
    initialScore: 100,
    winPoints: 10,
    lossPoints: 10,
    seasons: [
      { id: 's1', name: 'S1', startDate: '2026-01-01', endDate: '2026-03-31' },
    ],
    heroes: [{ id: 'h1', name: '后羿' }],
    records: [
      {
        id: 'r1',
        date: '2026-02-01',
        order: 1,
        teamSize: 2,
        result: 1,
        lane: 3,
        points: 10,
        heroId: 'h1',
      },
    ],
  }
}

describe('schema v3 normalization', () => {
  it('upgrades v2 data for local and cache compatibility', () => {
    const data = normalizeData({
      schemaVersion: 2,
      initialScore: 100,
      winPoints: 10,
      lossPoints: 10,
      records: [
        { id: 'r1', date: '2026-08-01', order: 1, teamSize: 1, result: 1, lane: null, points: 10 },
      ],
    })

    expect(data).toMatchObject({ schemaVersion: 3, seasons: [], heroes: [] })
    expect(data.records[0].heroId).toBeNull()
  })

  it('strictly accepts complete v3 imports and rejects v2', () => {
    expect(normalizeImportedData(v3Document()).schemaVersion).toBe(3)
    expect(() => normalizeImportedData({
      ...v3Document(),
      schemaVersion: 2,
    })).toThrow('schemaVersion must be 3')
  })

  it('rejects unknown hero references and duplicate hero names', () => {
    expect(() => normalizeImportedData({
      ...v3Document(),
      records: [{ ...v3Document().records[0], heroId: 'missing' }],
    })).toThrow('unknown hero reference')
    expect(() => normalizeImportedData({
      ...v3Document(),
      heroes: [{ id: 'h1', name: '后羿' }, { id: 'h2', name: ' 后羿 ' }],
    })).toThrow('duplicate hero name')
  })

  it('rejects overlapping closed season ranges', () => {
    expect(() => normalizeImportedData({
      ...v3Document(),
      seasons: [
        { id: 's1', name: 'S1', startDate: '2026-01-01', endDate: '2026-03-31' },
        { id: 's2', name: 'S2', startDate: '2026-03-31', endDate: '2026-06-30' },
      ],
    })).toThrow('overlapping seasons')
  })
})

describe('date parsing', () => {
  it('parses real calendar dates and checks inclusive seasons', () => {
    expect(parseDateString('2024-02-29').toISOString()).toContain('2024-02-29')
    expect(() => parseDateString('2026-02-29')).toThrow('invalid date')
    expect(dateInSeason('2026-03-31', v3Document().seasons[0])).toBe(true)
  })
})

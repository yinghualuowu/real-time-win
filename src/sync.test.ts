import { describe, expect, it } from 'vitest'
import type { MatchRecord, StoredData } from './model'
import {
  diffStoredData,
  mergeStoredData,
  reorderRecordsByDate,
  resolveDataConflicts,
  resolveRecordConflicts,
} from './sync'

function record(id: string, date: string, order: number, points = 10): MatchRecord {
  return { id, date, order, teamSize: 2, result: 1, lane: 0, points }
}

function document(records: MatchRecord[], initialScore = 100): StoredData {
  return {
    schemaVersion: 3,
    initialScore,
    winPoints: 10,
    lossPoints: 10,
    seasons: [],
    heroes: [],
    records,
  }
}

describe('StoredData diff', () => {
  it('detects settings, additions, removals, and record field changes', () => {
    const before = document([
      record('removed', '2026-07-30', 1),
      record('changed', '2026-07-31', 1),
    ])
    const after = document([
      record('changed', '2026-07-31', 1, 20),
      record('added', '2026-08-01', 1),
    ], 120)

    const diff = diffStoredData(before, after)

    expect(diff.changedSettings).toEqual(['initialScore'])
    expect(diff.added.map(({ id }) => id)).toEqual(['added'])
    expect(diff.removed.map(({ id }) => id)).toEqual(['removed'])
    expect(diff.changed).toMatchObject([
      { id: 'changed', changedFields: ['points'] },
    ])
    expect(diff.hasChanges).toBe(true)
  })

  it('reports identical documents as unchanged', () => {
    const data = document([record('same', '2026-08-01', 1)])
    expect(diffStoredData(data, structuredClone(data)).hasChanges).toBe(false)
  })

  it('detects season and hero changes', () => {
    const before = document([])
    const after = document([])
    before.seasons = [{ id: 's1', name: 'S1', startDate: '2026-01-01', endDate: '2026-03-31' }]
    after.seasons = [{ id: 's1', name: 'S1', startDate: '2026-01-01', endDate: '2026-04-30' }]
    after.heroes = [{ id: 'h1', name: '后羿' }]

    const diff = diffStoredData(before, after)

    expect(diff.seasons.changed[0].changedFields).toEqual(['endDate'])
    expect(diff.heroes.added).toEqual([{ id: 'h1', name: '后羿' }])
    expect(diff.hasChanges).toBe(true)
  })
})

describe('record merge and conflict resolution', () => {
  it('merges unique IDs and describes conflicting fields for the same ID', () => {
    const local = document([
      record('local-only', '2026-08-02', 9),
      record('shared', '2026-08-01', 4, 10),
    ])
    const remote = document([
      record('remote-only', '2026-08-01', 8),
      record('shared', '2026-08-01', 2, 20),
    ])

    const result = mergeStoredData(local, remote)

    expect(result.data.records.map(({ id }) => id)).toEqual([
      'shared',
      'remote-only',
      'local-only',
    ])
    expect(result.conflicts).toHaveLength(1)
    expect(result.conflicts[0]).toMatchObject({
      id: 'shared',
      differingFields: ['order', 'points'],
    })
    expect(result.conflicts[0].description).toContain('order, points')
  })

  it('applies the selected side and reorders every date', () => {
    const result = mergeStoredData(
      document([
        record('shared', '2026-08-02', 5, 10),
        record('local-only', '2026-08-02', 7),
      ]),
      document([
        record('shared', '2026-08-01', 9, 20),
        record('remote-only', '2026-08-01', 11),
      ]),
    )

    const resolved = resolveRecordConflicts(result, { shared: 'remote' })

    expect(resolved.records.map(({ id, date, order, points }) => ({
      id, date, order, points,
    }))).toEqual([
      { id: 'remote-only', date: '2026-08-01', order: 1, points: 10 },
      { id: 'shared', date: '2026-08-01', order: 2, points: 20 },
      { id: 'local-only', date: '2026-08-02', order: 1, points: 10 },
    ])
  })

  it('sorts records by date and creates contiguous daily order values', () => {
    const reordered = reorderRecordsByDate([
      record('c', '2026-08-02', 3),
      record('b', '2026-08-01', 9),
      record('a', '2026-08-01', 2),
    ])
    expect(reordered.map(({ id, order }) => [id, order])).toEqual([
      ['a', 1],
      ['b', 2],
      ['c', 1],
    ])
  })

  it('merges and resolves season and hero conflicts independently', () => {
    const local = document([])
    local.seasons = [{ id: 's1', name: '本地赛季', startDate: '2026-01-01', endDate: '2026-03-31' }]
    local.heroes = [{ id: 'h1', name: '本地英雄' }]
    const remote = document([])
    remote.seasons = [{ id: 's1', name: '云端赛季', startDate: '2026-01-01', endDate: '2026-03-31' }]
    remote.heroes = [{ id: 'h1', name: '云端英雄' }]

    const result = mergeStoredData(local, remote)
    const resolved = resolveDataConflicts(result, {
      seasons: { s1: 'remote' },
      heroes: { h1: 'remote' },
    })

    expect(result.seasonConflicts).toHaveLength(1)
    expect(result.heroConflicts).toHaveLength(1)
    expect(resolved.seasons[0].name).toBe('云端赛季')
    expect(resolved.heroes[0].name).toBe('云端英雄')
  })
})

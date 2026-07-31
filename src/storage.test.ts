import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { StoredData } from './model'
import { readCloudCacheEntry, writeCloudCache } from './storage'

const data: StoredData = {
  schemaVersion: 2,
  initialScore: 100,
  winPoints: 10,
  lossPoints: 10,
  records: [
    { id: 'record-1', date: '2026-08-01', order: 1, teamSize: 2, result: 1, lane: 0, points: 10 },
  ],
}

beforeEach(() => {
  const values = new Map<string, string>()
  vi.stubGlobal('localStorage', {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => values.set(key, value),
    removeItem: (key: string) => values.delete(key),
  })
})

describe('cloud cache metadata', () => {
  it('reads the legacy data-only cache with revision zero', () => {
    localStorage.setItem('win-rate-dashboard-cloud-v1.user.profile', JSON.stringify(data))

    const entry = readCloudCacheEntry('user', 'profile')

    expect(entry?.data).toEqual(data)
    expect(entry?.sync.revision).toBe(0)
    expect(entry?.sync.lastSyncedData).toEqual(data)
  })

  it('persists revision and the last synced snapshot', () => {
    writeCloudCache('user', 'profile', data, {
      revision: 4,
      lastSyncedAt: '2026-08-01T00:00:00.000Z',
      lastSyncedData: data,
    })

    const entry = readCloudCacheEntry('user', 'profile')

    expect(entry?.sync).toMatchObject({
      revision: 4,
      lastSyncedAt: '2026-08-01T00:00:00.000Z',
      lastSyncedData: data,
    })
  })
})

import { initialData, normalizeData } from './model'
import type { StoredData } from './model'

const LOCAL_KEY = 'win-rate-dashboard-v3'
const LEGACY_KEYS = ['win-rate-dashboard-v2', 'win-rate-dashboard-v1']
const CLOUD_CACHE_PREFIX = 'win-rate-dashboard-cloud-v2'
const LEGACY_CLOUD_CACHE_PREFIX = 'win-rate-dashboard-cloud-v1'
const MIGRATION_PREFIX = 'win-rate-dashboard-migrated-v1'

export type CloudSyncMetadata = {
  revision: number
  lastSyncedAt: string
  lastSyncedData: StoredData
}

export type CloudCacheEntry = {
  data: StoredData
  sync: CloudSyncMetadata
}

function cloudCacheKey(userId: string, profileId: string) {
  return `${CLOUD_CACHE_PREFIX}.${userId}.${profileId}`
}

function legacyCloudCacheKey(userId: string, profileId: string) {
  return `${LEGACY_CLOUD_CACHE_PREFIX}.${userId}.${profileId}`
}

function parseCloudCache(value: string): CloudCacheEntry {
  const parsed = JSON.parse(value) as unknown
  if (parsed && typeof parsed === 'object' && 'data' in parsed) {
    const entry = parsed as {
      data: unknown
      sync?: Partial<CloudSyncMetadata>
    }
    const data = normalizeData(entry.data)
    return {
      data,
      sync: {
        revision: Math.max(0, Number(entry.sync?.revision ?? 0)),
        lastSyncedAt: String(entry.sync?.lastSyncedAt ?? ''),
        lastSyncedData: entry.sync?.lastSyncedData
          ? normalizeData(entry.sync.lastSyncedData)
          : data,
      },
    }
  }

  const data = normalizeData(parsed)
  return {
    data,
    sync: {
      revision: 0,
      lastSyncedAt: '',
      lastSyncedData: data,
    },
  }
}

export function loadLocalData(): StoredData {
  try {
    const value = localStorage.getItem(LOCAL_KEY)
      ?? LEGACY_KEYS.map((key) => localStorage.getItem(key)).find((item) => item !== null)
    return value ? normalizeData(JSON.parse(value)) : initialData
  } catch {
    return initialData
  }
}

export function saveLocalData(data: StoredData) {
  localStorage.setItem(LOCAL_KEY, JSON.stringify(data))
}

export function readCloudCache(userId: string, profileId: string): StoredData | null {
  return readCloudCacheEntry(userId, profileId)?.data ?? null
}

export function readCloudCacheEntry(userId: string, profileId: string): CloudCacheEntry | null {
  try {
    const value = localStorage.getItem(cloudCacheKey(userId, profileId))
      ?? localStorage.getItem(legacyCloudCacheKey(userId, profileId))
    return value ? parseCloudCache(value) : null
  } catch {
    return null
  }
}

export function writeCloudCache(
  userId: string,
  profileId: string,
  data: StoredData,
  metadata?: Partial<CloudSyncMetadata>,
) {
  const previous = readCloudCacheEntry(userId, profileId)
  const entry: CloudCacheEntry = {
    data,
    sync: {
      revision: Math.max(0, Number(metadata?.revision ?? previous?.sync.revision ?? 0)),
      lastSyncedAt: metadata?.lastSyncedAt ?? new Date().toISOString(),
      lastSyncedData: metadata?.lastSyncedData ?? data,
    },
  }
  localStorage.setItem(cloudCacheKey(userId, profileId), JSON.stringify(entry))
}

export function localMigrationCompleted(userId: string) {
  return localStorage.getItem(`${MIGRATION_PREFIX}.${userId}`) === 'done'
}

export function markLocalMigrationCompleted(userId: string) {
  localStorage.setItem(`${MIGRATION_PREFIX}.${userId}`, 'done')
}

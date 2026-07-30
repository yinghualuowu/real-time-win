import { initialData, normalizeData } from './model'
import type { StoredData } from './model'

const LOCAL_KEY = 'win-rate-dashboard-v2'
const LEGACY_KEY = 'win-rate-dashboard-v1'
const CLOUD_CACHE_PREFIX = 'win-rate-dashboard-cloud-v1'
const MIGRATION_PREFIX = 'win-rate-dashboard-migrated-v1'

export function loadLocalData(): StoredData {
  try {
    const value = localStorage.getItem(LOCAL_KEY) ?? localStorage.getItem(LEGACY_KEY)
    return value ? normalizeData(JSON.parse(value)) : initialData
  } catch {
    return initialData
  }
}

export function saveLocalData(data: StoredData) {
  localStorage.setItem(LOCAL_KEY, JSON.stringify(data))
}

export function readCloudCache(userId: string, profileId: string): StoredData | null {
  try {
    const value = localStorage.getItem(`${CLOUD_CACHE_PREFIX}.${userId}.${profileId}`)
    return value ? normalizeData(JSON.parse(value)) : null
  } catch {
    return null
  }
}

export function writeCloudCache(userId: string, profileId: string, data: StoredData) {
  localStorage.setItem(`${CLOUD_CACHE_PREFIX}.${userId}.${profileId}`, JSON.stringify(data))
}

export function localMigrationCompleted(userId: string) {
  return localStorage.getItem(`${MIGRATION_PREFIX}.${userId}`) === 'done'
}

export function markLocalMigrationCompleted(userId: string) {
  localStorage.setItem(`${MIGRATION_PREFIX}.${userId}`, 'done')
}

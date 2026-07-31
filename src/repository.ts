import { supabase } from './lib/supabase'
import { normalizeData } from './model'
import type { GamePlatform, GameProfile, Lane, MatchResult, StoredData } from './model'
import { readCloudCacheEntry, writeCloudCache } from './storage'

type SettingsRow = {
  initial_score: number
  win_points: number
  loss_points: number
  revision: number
}

type MatchRow = {
  external_id: string
  played_on: string
  match_order: number
  team_size: number
  result: number
  lane: number | null
  points_change: number
  hero_external_id: string | null
}

type SeasonRow = {
  external_id: string
  name: string
  starts_on: string
  ends_on: string
}

type HeroRow = {
  external_id: string
  name: string
}

export type CloudLoadResult = {
  data: StoredData
  revision: number
  lastSyncedData: StoredData
  offline: boolean
  error?: string
}

export class RevisionConflictError extends Error {
  readonly code = 'REVISION_CONFLICT'
  readonly expectedRevision: number
  readonly actualRevision: number | null

  constructor(expectedRevision: number, actualRevision: number | null, cause?: unknown) {
    super(`文档版本冲突：期望 revision ${expectedRevision}，云端为 ${actualRevision ?? '未知'}`, { cause })
    this.name = 'RevisionConflictError'
    this.expectedRevision = expectedRevision
    this.actualRevision = actualRevision
  }
}

export function isRevisionConflictError(reason: unknown): reason is RevisionConflictError {
  return reason instanceof RevisionConflictError
}

export async function loadGameProfiles(userId: string): Promise<GameProfile[]> {
  const { data, error } = await supabase
    .from('game_profiles')
    .select('id, nickname, platform')
    .eq('user_id', userId)
    .order('created_at')
  if (error) throw error
  return (data ?? []) as GameProfile[]
}

export async function createGameProfile(userId: string, nickname: string, platform: GamePlatform) {
  const { data, error } = await supabase
    .from('game_profiles')
    .insert({ user_id: userId, nickname, platform })
    .select('id, nickname, platform')
    .single()
  if (error) throw error
  return data as GameProfile
}

export async function transferGameData(fromProfileId: string, toProfileId: string) {
  const { error } = await supabase.rpc('transfer_match_document', {
    p_from_profile_id: fromProfileId,
    p_to_profile_id: toProfileId,
  })
  if (error) throw error
}

export async function loadCloudData(userId: string, profileId: string): Promise<CloudLoadResult> {
  try {
    const [settingsResult, seasonsResult, heroesResult, recordsResult] = await Promise.all([
      supabase
        .from('match_settings')
        .select('initial_score, win_points, loss_points, revision')
        .eq('user_id', userId)
        .eq('profile_id', profileId)
        .maybeSingle(),
      supabase
        .from('match_seasons')
        .select('external_id, name, starts_on, ends_on')
        .eq('user_id', userId)
        .eq('profile_id', profileId)
        .order('starts_on'),
      supabase
        .from('match_heroes')
        .select('external_id, name')
        .eq('user_id', userId)
        .eq('profile_id', profileId)
        .order('name'),
      supabase
        .from('match_records')
        .select('external_id, played_on, match_order, team_size, result, lane, points_change, hero_external_id')
        .eq('user_id', userId)
        .eq('profile_id', profileId)
        .order('played_on')
        .order('match_order'),
    ])
    if (settingsResult.error) throw settingsResult.error
    if (seasonsResult.error) throw seasonsResult.error
    if (heroesResult.error) throw heroesResult.error
    if (recordsResult.error) throw recordsResult.error
    const settings = settingsResult.data as SettingsRow | null
    const seasonRows = (seasonsResult.data ?? []) as SeasonRow[]
    const heroRows = (heroesResult.data ?? []) as HeroRow[]
    const rows = (recordsResult.data ?? []) as MatchRow[]
    const data = normalizeData({
      schemaVersion: 3,
      initialScore: settings?.initial_score ?? 100,
      winPoints: settings?.win_points ?? 10,
      lossPoints: settings?.loss_points ?? 10,
      seasons: seasonRows.map((row) => ({
        id: row.external_id,
        name: row.name,
        startDate: row.starts_on,
        endDate: row.ends_on,
      })),
      heroes: heroRows.map((row) => ({
        id: row.external_id,
        name: row.name,
      })),
      records: rows.map((row) => ({
        id: row.external_id,
        date: row.played_on,
        order: row.match_order,
        teamSize: row.team_size,
        result: row.result as MatchResult,
        lane: row.lane as Lane | null,
        points: row.points_change,
        heroId: row.hero_external_id,
      })),
    })
    const revision = settings?.revision ?? 0
    writeCloudCache(userId, profileId, data, { revision, lastSyncedData: data })
    return { data, revision, lastSyncedData: data, offline: false }
  } catch (reason) {
    const cached = readCloudCacheEntry(userId, profileId)
    if (cached) {
      return {
        data: cached.data,
        revision: cached.sync.revision,
        lastSyncedData: cached.sync.lastSyncedData,
        offline: true,
        error: reason instanceof Error ? reason.message : '云端连接失败，正在显示离线缓存。',
      }
    }
    throw reason
  }
}

export async function saveCloudData(
  userId: string,
  profileId: string,
  data: StoredData,
  expectedRevision = readCloudCacheEntry(userId, profileId)?.sync.revision ?? 0,
): Promise<number> {
  const { data: revisionValue, error } = await supabase.rpc('save_match_document', {
    p_profile_id: profileId,
    p_document: data,
    p_expected_revision: expectedRevision,
  })
  if (error) {
    if (error.message.includes('revision_conflict')) {
      const actualRevision = /actual=(\d+)/.exec(error.message)?.[1]
      throw new RevisionConflictError(
        expectedRevision,
        actualRevision === undefined ? null : Number(actualRevision),
        error,
      )
    }
    throw error
  }
  const revision = Number(revisionValue)
  if (!Number.isInteger(revision) || revision < 1) {
    throw new Error('云端返回了无效的文档 revision')
  }
  writeCloudCache(userId, profileId, data, { revision, lastSyncedData: data })
  return revision
}

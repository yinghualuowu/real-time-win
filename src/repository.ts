import { supabase } from './lib/supabase'
import { normalizeData } from './model'
import type { GamePlatform, GameProfile, Lane, MatchResult, StoredData } from './model'
import { readCloudCache, writeCloudCache } from './storage'

type SettingsRow = {
  initial_score: number
  win_points: number
  loss_points: number
}

type MatchRow = {
  external_id: string
  played_on: string
  match_order: number
  team_size: number
  result: number
  lane: number | null
  points_change: number
}

export type CloudLoadResult = {
  data: StoredData
  offline: boolean
  error?: string
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
    const [settingsResult, recordsResult] = await Promise.all([
      supabase
        .from('match_settings')
        .select('initial_score, win_points, loss_points')
        .eq('user_id', userId)
        .eq('profile_id', profileId)
        .maybeSingle(),
      supabase
        .from('match_records')
        .select('external_id, played_on, match_order, team_size, result, lane, points_change')
        .eq('user_id', userId)
        .eq('profile_id', profileId)
        .order('played_on')
        .order('match_order'),
    ])
    if (settingsResult.error) throw settingsResult.error
    if (recordsResult.error) throw recordsResult.error
    const settings = settingsResult.data as SettingsRow | null
    const rows = (recordsResult.data ?? []) as MatchRow[]
    const data = normalizeData({
      schemaVersion: 2,
      initialScore: settings?.initial_score ?? 100,
      winPoints: settings?.win_points ?? 10,
      lossPoints: settings?.loss_points ?? 10,
      records: rows.map((row) => ({
        id: row.external_id,
        date: row.played_on,
        order: row.match_order,
        teamSize: row.team_size,
        result: row.result as MatchResult,
        lane: row.lane as Lane | null,
        points: row.points_change,
      })),
    })
    writeCloudCache(userId, profileId, data)
    return { data, offline: false }
  } catch (reason) {
    const cached = readCloudCache(userId, profileId)
    if (cached) {
      return {
        data: cached,
        offline: true,
        error: reason instanceof Error ? reason.message : '云端连接失败，正在显示离线缓存。',
      }
    }
    throw reason
  }
}

export async function saveCloudData(userId: string, profileId: string, data: StoredData) {
  const { error } = await supabase.rpc('save_match_document', {
    p_profile_id: profileId,
    p_document: data,
  })
  if (error) throw error
  writeCloudCache(userId, profileId, data)
}

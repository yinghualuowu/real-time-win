import type { Lane, MatchRecord, MatchResult } from './model'

export type RecentMatchFilters = {
  startDate: string
  endDate: string
  teamSize: number | null
  lane: Lane | null | 'all'
  result: MatchResult | 'all'
}

export const emptyRecentMatchFilters: RecentMatchFilters = {
  startDate: '',
  endDate: '',
  teamSize: null,
  lane: 'all',
  result: 'all',
}

export function filterRecentRecords(records: MatchRecord[], filters: RecentMatchFilters) {
  return records.filter((record) => (
    (!filters.startDate || record.date >= filters.startDate)
    && (!filters.endDate || record.date <= filters.endDate)
    && (filters.teamSize === null || record.teamSize === filters.teamSize)
    && (filters.lane === 'all' || record.lane === filters.lane)
    && (filters.result === 'all' || record.result === filters.result)
  ))
}

export function teamSizeTone(size: number) {
  return `tone-mode-${Math.min(5, Math.max(1, size))}`
}

export function laneTone(lane: Lane | null) {
  return lane === null ? 'tone-lane-unknown' : `tone-lane-${lane}`
}

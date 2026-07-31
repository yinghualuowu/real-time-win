import type { Lane, MatchRecord, MatchResult, Season } from './model'
import { seasonForDate } from './utils/catalog'

export type RecentMatchFilters = {
  startDate: string
  endDate: string
  teamSize: number | null
  lane: Lane | null | 'all'
  result: MatchResult | 'all'
  seasonId: string
  heroId: string
}

export const emptyRecentMatchFilters: RecentMatchFilters = {
  startDate: '',
  endDate: '',
  teamSize: null,
  lane: 'all',
  result: 'all',
  seasonId: 'all',
  heroId: 'all',
}

export function filterRecentRecords(records: MatchRecord[], filters: RecentMatchFilters, seasons: Season[] = []) {
  return records.filter((record) => {
    const season = seasonForDate(seasons, record.date)
    return (
      (!filters.startDate || record.date >= filters.startDate)
      && (!filters.endDate || record.date <= filters.endDate)
      && (filters.teamSize === null || record.teamSize === filters.teamSize)
      && (filters.lane === 'all' || record.lane === filters.lane)
      && (filters.result === 'all' || record.result === filters.result)
      && (filters.seasonId === 'all'
        || (filters.seasonId === 'unmatched' ? season === null : season?.id === filters.seasonId))
      && (filters.heroId === 'all'
        || (filters.heroId === 'unassigned' ? record.heroId === null : record.heroId === filters.heroId))
    )
  })
}

export function teamSizeTone(size: number) {
  return `tone-mode-${Math.min(5, Math.max(1, size))}`
}

export function laneTone(lane: Lane | null) {
  return lane === null ? 'tone-lane-unknown' : `tone-lane-${lane}`
}

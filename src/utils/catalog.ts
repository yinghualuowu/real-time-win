import { percent } from '../model'
import type { Hero, MatchRecord, Season } from '../model'

export function seasonForDate(seasons: Season[], date: string) {
  return seasons.find((season) => date >= season.startDate && date <= season.endDate) ?? null
}

export function recordsForSeason(records: MatchRecord[], seasons: Season[], seasonId: string) {
  const season = seasons.find((item) => item.id === seasonId)
  if (!season) return []
  return records.filter((record) => record.date >= season.startDate && record.date <= season.endDate)
}

export type CatalogStats = {
  games: number
  wins: number
  losses: number
  rate: string
  points: number
}

export function summarizeRecords(records: MatchRecord[]): CatalogStats {
  const wins = records.filter((record) => record.result === 1).length
  return {
    games: records.length,
    wins,
    losses: records.length - wins,
    rate: percent(wins, records.length),
    points: records.reduce((total, record) => total + record.points, 0),
  }
}

export function buildHeroStats(records: MatchRecord[], heroes: Hero[]) {
  return heroes.map((hero) => ({
    hero,
    ...summarizeRecords(records.filter((record) => record.heroId === hero.id)),
  })).sort((left, right) => right.games - left.games || left.hero.name.localeCompare(right.hero.name, 'zh-CN'))
}

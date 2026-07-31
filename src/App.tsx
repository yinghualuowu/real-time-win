import { useEffect, useMemo, useRef, useState } from 'react'
import ReactECharts from 'echarts-for-react'
import { AuthPanel, useAuth } from './auth'
import {
  initialData, laneName, modeName, newId, normalizeData, percent,
} from './model'
import type {
  AnalysisDimension, ChartType, GamePlatform, GameProfile, GroupDimension,
  Lane, MatchRecord, MatchResult, MetricKey, PeriodPreset, StoredData,
} from './model'
import {
  createGameProfile, isRevisionConflictError, loadCloudData, loadGameProfiles,
  saveCloudData, transferGameData,
} from './repository'
import {
  loadLocalData, localMigrationCompleted, markLocalMigrationCompleted, saveLocalData,
} from './storage'
import {
  emptyRecentMatchFilters, filterRecentRecords, laneTone, teamSizeTone,
} from './filters'
import type { RecentMatchFilters } from './filters'
import {
  diffStoredData, mergeStoredData, resolveRecordConflicts,
} from './sync'
import type { ConflictChoice, MergeResult } from './sync'
import { comparePeriods, getPresetRanges } from './utils/analytics'
import type { DateRange } from './utils/analytics'
import { buildCustomAnalysisRows } from './utils/customAnalysis'
import type { AnalysisGranularity } from './utils/customAnalysis'
import './App.css'

const metricConfig: Record<MetricKey, { name: string; type: 'bar' | 'line'; color: string; axis: number }> = {
  games: { name: '对局数', type: 'bar', color: '#9bb6ff', axis: 0 },
  wins: { name: '胜场数', type: 'bar', color: '#72d5aa', axis: 0 },
  rate: { name: '胜率', type: 'line', color: '#4f7cff', axis: 1 },
  points: { name: '净积分', type: 'line', color: '#7c5ce7', axis: 2 },
}

type AnalysisMetricKey = MetricKey | 'score'

const analysisMetricConfig: Record<AnalysisMetricKey, { name: string; type: 'bar' | 'line'; color: string; axis: number }> = {
  ...metricConfig,
  score: { name: '累计积分', type: 'line', color: '#f0a44b', axis: 2 },
}

const emptyData = (): StoredData => ({ ...initialData, records: [] })

type ConflictKind = 'migration' | 'import' | 'revision'

type PendingConflict = {
  kind: ConflictKind
  local: StoredData
  remote: StoredData
  remoteRevision: number
  merge: MergeResult
}

function datesBetween(start: string, end: string) {
  const dates: string[] = []
  const cursor = new Date(`${start}T00:00:00`)
  const last = new Date(`${end}T00:00:00`)
  while (cursor <= last) {
    const year = cursor.getFullYear()
    const month = String(cursor.getMonth() + 1).padStart(2, '0')
    const day = String(cursor.getDate()).padStart(2, '0')
    dates.push(`${year}-${month}-${day}`)
    cursor.setDate(cursor.getDate() + 1)
  }
  return dates
}

function recordSummary(record: MatchRecord) {
  return `${record.date} 第 ${record.order} 场 · ${modeName(record.teamSize)} · ${laneName(record.lane)} · ${record.result ? '胜' : '负'} · ${record.points >= 0 ? '+' : ''}${record.points} 分`
}

function App() {
  const { session, loading: authLoading, signOut } = useAuth()
  const [data, setData] = useState<StoredData>(loadLocalData)
  const [date, setDate] = useState(new Date().toISOString().slice(0, 10))
  const [teamSize, setTeamSize] = useState(2)
  const [result, setResult] = useState<MatchResult>(1)
  const [lane, setLane] = useState<Lane>(0)
  const [analysisDimension, setAnalysisDimension] = useState<AnalysisDimension>('date')
  const [analysisMetrics, setAnalysisMetrics] = useState<AnalysisMetricKey[]>(['games', 'rate'])
  const [chartType, setChartType] = useState<ChartType>('auto')
  const [analysisStartDate, setAnalysisStartDate] = useState('')
  const [analysisEndDate, setAnalysisEndDate] = useState('')
  const [analysisGranularity, setAnalysisGranularity] = useState<AnalysisGranularity>('day')
  const [analysisFullscreen, setAnalysisFullscreen] = useState(false)
  const [scoreFullscreen, setScoreFullscreen] = useState(false)
  const [periodPreset, setPeriodPreset] = useState<PeriodPreset>('week')
  const [compareDimension, setCompareDimension] = useState<GroupDimension>('overall')
  const [compareMetric, setCompareMetric] = useState<MetricKey>('rate')
  const presetRanges = getPresetRanges('week')
  const [previousRange, setPreviousRange] = useState<DateRange>(presetRanges.previous)
  const [currentRange, setCurrentRange] = useState<DateRange>(presetRanges.current)
  const [profiles, setProfiles] = useState<GameProfile[]>([])
  const [activeProfileId, setActiveProfileId] = useState('')
  const [showProfileModal, setShowProfileModal] = useState(false)
  const [profileNickname, setProfileNickname] = useState('')
  const [profilePlatform, setProfilePlatform] = useState<GamePlatform>('Q')
  const [attachCurrentData, setAttachCurrentData] = useState(true)
  const [showRestDays, setShowRestDays] = useState(true)
  const [editingRecord, setEditingRecord] = useState<MatchRecord | null>(null)
  const [recentFilters, setRecentFilters] = useState<RecentMatchFilters>(emptyRecentMatchFilters)
  const [showAuth, setShowAuth] = useState(false)
  const [loading, setLoading] = useState(false)
  const [offline, setOffline] = useState(false)
  const [cloudRevision, setCloudRevision] = useState(0)
  const [pendingConflict, setPendingConflict] = useState<PendingConflict | null>(null)
  const [conflictChoices, setConflictChoices] = useState<Record<string, ConflictChoice>>({})
  const [conflictSettingsChoice, setConflictSettingsChoice] = useState<ConflictChoice>('local')
  const [message, setMessage] = useState('')
  const fileInput = useRef<HTMLInputElement>(null)
  const analysisPanel = useRef<HTMLElement>(null)
  const scorePanel = useRef<HTMLElement>(null)

  const activeProfile = profiles.find((profile) => profile.id === activeProfileId)

  useEffect(() => {
    const updateFullscreen = () => {
      setAnalysisFullscreen(document.fullscreenElement === analysisPanel.current)
      setScoreFullscreen(document.fullscreenElement === scorePanel.current)
      window.requestAnimationFrame(() => window.dispatchEvent(new Event('resize')))
    }
    document.addEventListener('fullscreenchange', updateFullscreen)
    return () => document.removeEventListener('fullscreenchange', updateFullscreen)
  }, [])

  const openConflict = (
    kind: ConflictKind,
    local: StoredData,
    remote: StoredData,
    remoteRevision: number,
  ) => {
    const merge = mergeStoredData(local, remote)
    setConflictChoices({})
    setConflictSettingsChoice('local')
    setPendingConflict({ kind, local, remote, remoteRevision, merge })
  }

  useEffect(() => {
    if (!session) {
      setProfiles([])
      setActiveProfileId('')
      setOffline(false)
      setCloudRevision(0)
      setPendingConflict(null)
      setData(loadLocalData())
      return
    }
    let cancelled = false
    setLoading(true)
    void loadGameProfiles(session.user.id).then((items) => {
      if (cancelled) return
      setProfiles(items)
      const saved = localStorage.getItem(`win-rate-active-profile.${session.user.id}`)
      const selected = items.find((item) => item.id === saved)?.id ?? items[0]?.id ?? ''
      setActiveProfileId(selected)
      if (!items.length) setShowProfileModal(true)
    }).catch((reason) => {
      if (!cancelled) setMessage(reason instanceof Error ? reason.message : '游戏账号加载失败')
    }).finally(() => {
      if (!cancelled) setLoading(false)
    })
    return () => { cancelled = true }
  }, [session])

  useEffect(() => {
    if (!session || !activeProfileId) return
    let cancelled = false
    setLoading(true)
    localStorage.setItem(`win-rate-active-profile.${session.user.id}`, activeProfileId)
    void loadCloudData(session.user.id, activeProfileId).then((resultData) => {
      if (cancelled) return
      setData(resultData.data)
      setCloudRevision(resultData.revision)
      setOffline(resultData.offline)
      if (resultData.error) setMessage(resultData.error)
      if (!resultData.offline && !localMigrationCompleted(session.user.id)) {
        const localData = loadLocalData()
        if (diffStoredData(resultData.data, localData).hasChanges) {
          openConflict('migration', localData, resultData.data, resultData.revision)
        } else {
          markLocalMigrationCompleted(session.user.id)
        }
      }
    }).catch((reason) => {
      if (!cancelled) setMessage(reason instanceof Error ? reason.message : '云端数据加载失败')
    }).finally(() => {
      if (!cancelled) setLoading(false)
    })
    return () => { cancelled = true }
  }, [activeProfileId, session])

  const persistData = async (next: StoredData) => {
    if (session && activeProfileId && offline) {
      setMessage('离线状态下不能修改云端数据')
      return false
    }
    const previous = data
    setData(next)
    try {
      if (session && activeProfileId) {
        const revision = await saveCloudData(session.user.id, activeProfileId, next, cloudRevision)
        setCloudRevision(revision)
      } else {
        saveLocalData(next)
      }
      return true
    } catch (reason) {
      setData(previous)
      if (session && activeProfileId && isRevisionConflictError(reason)) {
        try {
          const latest = await loadCloudData(session.user.id, activeProfileId)
          if (latest.offline) throw new Error(latest.error ?? '无法加载最新云端数据')
          setCloudRevision(latest.revision)
          openConflict('revision', next, latest.data, latest.revision)
          setMessage('检测到其他设备的新修改，请选择冲突处理方式')
        } catch (loadReason) {
          setMessage(loadReason instanceof Error ? loadReason.message : '加载最新云端数据失败')
        }
        return false
      }
      setMessage(reason instanceof Error ? reason.message : '保存失败')
      return false
    }
  }

  const sortedRecords = useMemo(
    () => [...data.records].sort((a, b) => a.date.localeCompare(b.date) || a.order - b.order || a.id.localeCompare(b.id)),
    [data.records],
  )
  const filteredRecentRecords = useMemo(
    () => filterRecentRecords(sortedRecords, recentFilters),
    [recentFilters, sortedRecords],
  )
  const recentFiltersActive = Object.entries(recentFilters).some(([key, value]) => (
    key === 'teamSize' ? value !== null : value !== '' && value !== 'all'
  ))

  const analytics = useMemo(() => {
    const wins = sortedRecords.filter((record) => record.result === 1).length
    const score = data.initialScore + sortedRecords.reduce((total, record) => total + record.points, 0)
    const dailyMap = new Map<string, { games: number; wins: number; score: number; points: number }>()
    const modeMap = new Map<number, { games: number; wins: number; points: number }>()
    const laneMap = new Map<string, { games: number; wins: number; points: number }>()
    let runningScore = data.initialScore
    sortedRecords.forEach((record) => {
      runningScore += record.points
      const dayValue = dailyMap.get(record.date) ?? { games: 0, wins: 0, score: runningScore, points: 0 }
      dayValue.games += 1; dayValue.wins += record.result; dayValue.score = runningScore; dayValue.points += record.points
      dailyMap.set(record.date, dayValue)
      const modeValue = modeMap.get(record.teamSize) ?? { games: 0, wins: 0, points: 0 }
      modeValue.games += 1; modeValue.wins += record.result; modeValue.points += record.points; modeMap.set(record.teamSize, modeValue)
      const laneKey = record.lane === null ? 'unknown' : String(record.lane)
      const laneValue = laneMap.get(laneKey) ?? { games: 0, wins: 0, points: 0 }
      laneValue.games += 1; laneValue.wins += record.result; laneValue.points += record.points; laneMap.set(laneKey, laneValue)
    })

    const recordedDates = [...dailyMap.keys()].sort()
    const chartDates = showRestDays && recordedDates.length > 1
      ? datesBetween(recordedDates[0], recordedDates[recordedDates.length - 1])
      : recordedDates
    const scorePoints: Array<{ label: string; score: number; detail: string; rest: boolean }> = [
      { label: '初始', score: data.initialScore, detail: '初始积分', rest: false },
    ]
    let chartScore = data.initialScore
    chartDates.forEach((chartDate) => {
      const matches = sortedRecords.filter((record) => record.date === chartDate)
      if (!matches.length) {
        scorePoints.push({ label: `${chartDate.slice(5)}·休`, score: chartScore, detail: `${chartDate} · 休息日`, rest: true })
        return
      }
      matches.forEach((record) => {
        chartScore += record.points
        scorePoints.push({
          label: `${record.date.slice(5)}·${record.order}`,
          score: chartScore,
          detail: `${record.date} 第 ${record.order} 场 · ${modeName(record.teamSize)} · ${laneName(record.lane)} · ${record.result ? '胜利' : '失败'} · ${record.points >= 0 ? '+' : ''}${record.points} 分`,
          rest: false,
        })
      })
    })

    let lastDailyScore = data.initialScore
    const daily = chartDates.map((day) => {
      const value = dailyMap.get(day)
      if (value) {
        lastDailyScore = value.score
        return { key: day, label: day.slice(5), ...value, rest: false }
      }
      return { key: day, label: `${day.slice(5)}\n休息`, games: 0, wins: 0, score: lastDailyScore, points: 0, rest: true }
    })
    return {
      wins, score, scorePoints,
      daily,
      modes: [...modeMap].sort(([a], [b]) => a - b).map(([size, value]) => ({ key: String(size), label: modeName(size), ...value })),
      lanes: [...laneMap].sort(([a], [b]) => a.localeCompare(b)).map(([key, value]) => ({ key, label: key === 'unknown' ? '未设置' : laneName(Number(key) as Lane), ...value })),
    }
  }, [data, showRestDays, sortedRecords])

  const analysisRows = useMemo(() => {
    return buildCustomAnalysisRows(
      sortedRecords,
      analysisDimension,
      analysisGranularity,
      data.initialScore,
      analysisStartDate,
      analysisEndDate,
    )
  }, [
    analysisDimension, analysisEndDate, analysisGranularity,
    analysisStartDate, data.initialScore, sortedRecords,
  ])

  const analysisOption = useMemo(() => {
    const selectedMetrics = chartType === 'pie' ? analysisMetrics.slice(0, 1) : analysisMetrics
    if (chartType === 'pie') {
      const metric = selectedMetrics[0] ?? 'games'
      return {
        tooltip: { trigger: 'item' },
        legend: { bottom: 4 },
        series: [{
          name: analysisMetricConfig[metric].name,
          type: 'pie',
          radius: ['38%', '68%'],
          data: analysisRows.map((item) => ({ name: item.label, value: item[metric] })),
          label: { formatter: '{b}\n{d}%' },
        }],
      }
    }
    return {
      tooltip: { trigger: 'axis' },
      legend: { data: selectedMetrics.map((key) => analysisMetricConfig[key].name), right: 8 },
      grid: { left: 48, right: 60, top: 56, bottom: 38 },
      xAxis: { type: 'category', data: analysisRows.map((item) => item.label) },
      yAxis: [
        { type: 'value', name: '场', minInterval: 1, splitLine: { lineStyle: { color: '#edf2f7' } } },
        { type: 'value', name: '%', min: 0, max: 100, splitLine: { show: false } },
        { type: 'value', name: '分', position: 'right', offset: 38, splitLine: { show: false } },
      ],
      series: selectedMetrics.map((key) => {
        const config = analysisMetricConfig[key]
        const type = chartType === 'auto' ? config.type : chartType
        return {
          name: config.name, type, yAxisIndex: config.axis, smooth: true, barMaxWidth: 30,
          data: analysisRows.map((item) => item[key]), symbolSize: 8,
          lineStyle: { width: 3, color: config.color },
          itemStyle: { color: config.color, borderRadius: type === 'bar' ? [5, 5, 0, 0] : 0 },
        }
      }),
    }
  }, [analysisMetrics, analysisRows, chartType])

  const scoreOption = {
    tooltip: {
      trigger: 'axis',
      formatter: (items: Array<{ dataIndex: number; value: number }>) => {
        const item = items[0]
        return `${analytics.scorePoints[item.dataIndex].detail}<br/><b>${item.value} 分</b>`
      },
    },
    grid: { left: 52, right: 22, top: 30, bottom: 38 },
    xAxis: { type: 'category', boundaryGap: false, data: analytics.scorePoints.map((item) => item.label) },
    yAxis: { type: 'value', scale: true, splitLine: { lineStyle: { color: '#edf2f7' } } },
    series: [{
      type: 'line', smooth: true,
      data: analytics.scorePoints.map((item) => ({
        value: item.score,
        symbol: item.rest ? 'diamond' : 'circle',
        symbolSize: item.rest ? 12 : 8,
        itemStyle: { color: item.rest ? '#f0a44b' : '#7c5ce7' },
      })),
      lineStyle: { width: 3, color: '#7c5ce7' }, itemStyle: { color: '#7c5ce7' },
      areaStyle: { color: 'rgba(124,92,231,.12)' },
    }],
  }

  const comparisonRows = useMemo(
    () => comparePeriods(sortedRecords, previousRange, currentRange, compareDimension, compareMetric),
    [compareDimension, compareMetric, currentRange, previousRange, sortedRecords],
  )

  const changePreset = (value: PeriodPreset) => {
    setPeriodPreset(value)
    if (value !== 'custom') {
      const ranges = getPresetRanges(value)
      setPreviousRange(ranges.previous)
      setCurrentRange(ranges.current)
    } else {
      setPreviousRange((range) => ({ ...range, label: '对比期' }))
      setCurrentRange((range) => ({ ...range, label: '当前期' }))
    }
  }

  const toggleChartFullscreen = async (panel: HTMLElement | null) => {
    try {
      if (document.fullscreenElement) {
        await document.exitFullscreen()
      } else {
        await panel?.requestFullscreen()
      }
    } catch {
      setMessage('当前浏览器无法进入全屏模式')
    }
  }

  const saveConflictResolution = async (next: StoredData) => {
    if (!pendingConflict) return
    setLoading(true)
    try {
      if (session && activeProfileId) {
        const revision = await saveCloudData(
          session.user.id,
          activeProfileId,
          next,
          pendingConflict.remoteRevision,
        )
        setCloudRevision(revision)
      } else {
        saveLocalData(next)
      }
      if (pendingConflict.kind === 'migration' && session) {
        saveLocalData(next)
        markLocalMigrationCompleted(session.user.id)
      }
      setData(next)
      setPendingConflict(null)
      setMessage(`冲突已解决，共保留 ${next.records.length} 条记录`)
    } catch (reason) {
      if (session && activeProfileId && isRevisionConflictError(reason)) {
        try {
          const latest = await loadCloudData(session.user.id, activeProfileId)
          if (latest.offline) throw new Error(latest.error ?? '无法加载最新云端数据')
          setCloudRevision(latest.revision)
          openConflict(pendingConflict.kind, next, latest.data, latest.revision)
          setMessage('解决期间云端再次更新，请基于最新数据重新选择')
        } catch (loadReason) {
          setMessage(loadReason instanceof Error ? loadReason.message : '重新加载云端数据失败')
        }
      } else {
        setMessage(reason instanceof Error ? reason.message : '冲突处理失败')
      }
    } finally {
      setLoading(false)
    }
  }

  const discardConflictLocal = () => {
    if (!pendingConflict) return
    setData(pendingConflict.remote)
    setCloudRevision(pendingConflict.remoteRevision)
    if (pendingConflict.kind === 'migration' && session) {
      saveLocalData(pendingConflict.remote)
      markLocalMigrationCompleted(session.user.id)
    }
    setPendingConflict(null)
    setMessage(pendingConflict.kind === 'import' ? '已取消导入并保留当前数据' : '已舍弃本地修改并保留云端数据')
  }

  const mergeConflictData = () => {
    if (!pendingConflict) return
    const allDecided = pendingConflict.merge.conflicts.every((conflict) => conflictChoices[conflict.id])
    if (!allDecided) {
      setMessage('请先为每条内容冲突选择要保留的版本')
      return
    }
    const recordsMerged = resolveRecordConflicts(pendingConflict.merge, conflictChoices)
    const settings = conflictSettingsChoice === 'local' ? pendingConflict.local : pendingConflict.remote
    void saveConflictResolution({
      ...recordsMerged,
      initialScore: settings.initialScore,
      winPoints: settings.winPoints,
      lossPoints: settings.lossPoints,
    })
  }

  const addRecord = async (event: React.FormEvent) => {
    event.preventDefault()
    const order = Math.max(0, ...data.records.filter((record) => record.date === date).map((record) => record.order)) + 1
    const success = await persistData({
      ...data,
      records: [...data.records, {
        id: newId(), date, order, teamSize, result, lane,
        points: result ? data.winPoints : -data.lossPoints,
      }],
    })
    if (success) setMessage('已添加一条对局记录')
  }

  const deleteRecord = async (id: string) => {
    const remaining = data.records.filter((record) => record.id !== id)
    const counters = new Map<string, number>()
    const records = [...remaining].sort((a, b) => a.date.localeCompare(b.date) || a.order - b.order).map((record) => {
      const order = (counters.get(record.date) ?? 0) + 1
      counters.set(record.date, order)
      return { ...record, order }
    })
    await persistData({ ...data, records })
  }

  const saveEditedRecord = async (event: React.FormEvent) => {
    event.preventDefault()
    if (!editingRecord) return
    const others = data.records.filter((record) => record.id !== editingRecord.id)
    const sameDay = others
      .filter((record) => record.date === editingRecord.date)
      .sort((a, b) => a.order - b.order)
    const insertAt = Math.max(0, Math.min(sameDay.length, editingRecord.order - 1))
    sameDay.splice(insertAt, 0, editingRecord)
    const combined = [
      ...others.filter((record) => record.date !== editingRecord.date),
      ...sameDay,
    ].sort((a, b) => a.date.localeCompare(b.date) || a.order - b.order)
    const counters = new Map<string, number>()
    const records = combined.map((record) => {
      const order = (counters.get(record.date) ?? 0) + 1
      counters.set(record.date, order)
      return { ...record, order }
    })
    if (await persistData({ ...data, records })) {
      setEditingRecord(null)
      setMessage('对局记录已更新')
    }
  }

  const exportJson = () => {
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' })
    const link = document.createElement('a')
    link.href = URL.createObjectURL(blob)
    link.download = `${activeProfile?.nickname ?? '对局统计'}-${date}.json`
    link.click()
    URL.revokeObjectURL(link.href)
  }

  const importJson = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0]
    if (!file) return
    try {
      const imported = normalizeData(JSON.parse(await file.text()))
      if (!diffStoredData(data, imported).hasChanges) {
        setMessage('导入文件与当前数据一致')
      } else {
        openConflict('import', imported, data, cloudRevision)
      }
    } catch {
      setMessage('导入失败：请检查 JSON 数据格式')
    } finally {
      event.target.value = ''
    }
  }

  const submitProfile = async (event: React.FormEvent) => {
    event.preventDefault()
    if (!session) return
    const nickname = profileNickname.trim()
    if (!/^[A-Za-z0-9_一-龥]{1,24}$/.test(nickname)) {
      setMessage('昵称仅允许 1–24 位中英文、数字和下划线')
      return
    }
    setLoading(true)
    try {
      const profile = await createGameProfile(session.user.id, nickname, profilePlatform)
      if (attachCurrentData && activeProfileId) {
        await transferGameData(activeProfileId, profile.id)
      } else {
        const document = attachCurrentData ? data : emptyData()
        await saveCloudData(session.user.id, profile.id, document)
        if (!activeProfileId) markLocalMigrationCompleted(session.user.id)
      }
      setProfiles((current) => [...current, profile])
      setActiveProfileId(profile.id)
      setShowProfileModal(false)
      setProfileNickname('')
      setMessage(attachCurrentData ? `数据已关联到 ${nickname}` : `已创建空账号 ${nickname}`)
    } catch (reason) {
      setMessage(reason instanceof Error ? reason.message : '游戏账号创建失败')
    } finally {
      setLoading(false)
    }
  }

  const metricValue = (row: (typeof comparisonRows)[number], side: 'previous' | 'current') => row[side][compareMetric]
  const metricUnit = compareMetric === 'rate' ? '%' : compareMetric === 'points' ? ' 分' : ' 场'
  const conflictLabels = pendingConflict?.kind === 'import'
    ? { local: '导入文件', remote: '当前数据', overwrite: '用导入文件覆盖', discard: '取消导入' }
    : pendingConflict?.kind === 'revision'
      ? { local: '当前修改', remote: '云端最新', overwrite: '用当前修改覆盖云端', discard: '舍弃当前修改' }
      : { local: '本地数据', remote: '云端数据', overwrite: '用本地覆盖云端', discard: '舍弃本地数据' }

  if (authLoading) return <div className="page-loading">正在恢复登录状态…</div>

  return (
    <div className="app-shell">
      <header className="topbar">
        <div className="brand"><span className="brand-mark">W</span><div><strong>胜率数据台</strong><small>WIN RATE ANALYTICS</small></div></div>
        <div className="header-actions">
          {session && (
            <select className="profile-select" value={activeProfileId} onChange={(event) => setActiveProfileId(event.target.value)}>
              {!profiles.length && <option value="">暂无游戏账号</option>}
              {profiles.map((profile) => <option key={profile.id} value={profile.id}>{profile.platform}区 · {profile.nickname}</option>)}
            </select>
          )}
          {session && <button className="button secondary" onClick={() => { setAttachCurrentData(true); setShowProfileModal(true) }}>＋ 游戏账号</button>}
          <input ref={fileInput} type="file" accept=".json,application/json" onChange={importJson} hidden />
          <button className="button secondary" disabled={offline} onClick={() => fileInput.current?.click()}>导入</button>
          <button className="button primary" onClick={exportJson}>导出</button>
          {session
            ? <button className="account-button" title="退出登录" onClick={() => void signOut()}>{session.user.email?.slice(0, 1).toUpperCase()}</button>
            : <button className="button secondary" onClick={() => setShowAuth(true)}>登录同步</button>}
        </div>
      </header>

      <main>
        {loading && <div className="loading-bar" />}
        {message && <button className="toast" onClick={() => setMessage('')}>{message} ×</button>}
        {offline && <div className="status-banner warning">当前正在显示离线缓存，恢复连接前不能修改数据。</div>}
        <section className="welcome">
          <div><p className="eyebrow">MATCH OVERVIEW</p><h1>{activeProfile ? `${activeProfile.nickname} 的对局表现` : '对局表现总览'}</h1><p>记录每场胜负，洞察分路、胜率与积分趋势。</p></div>
          <div className="score-rule">
            <span>积分规则</span>
            <label>初始 <input type="number" value={data.initialScore} onChange={(event) => setData({ ...data, initialScore: Number(event.target.value) })} onBlur={() => void persistData(data)} /></label>
            <label>胜 <b>+</b><input type="number" min="0" value={data.winPoints} onChange={(event) => setData({ ...data, winPoints: Number(event.target.value) })} onBlur={() => void persistData(data)} /></label>
            <label>负 <b>−</b><input type="number" min="0" value={data.lossPoints} onChange={(event) => setData({ ...data, lossPoints: Number(event.target.value) })} onBlur={() => void persistData(data)} /></label>
          </div>
        </section>

        <section className="game-account-bar">
          <div className="game-account-icon">{activeProfile?.platform ?? 'ID'}</div>
          <div className="game-account-info">
            <small>当前游戏账号</small>
            <strong>{activeProfile ? activeProfile.nickname : session ? '尚未创建游戏账号' : '登录后管理游戏账号'}</strong>
            <span>{activeProfile ? `${activeProfile.platform === 'Q' ? 'QQ' : '微信'}区 · 独立对局数据` : '支持多个账号，每个账号的数据相互独立'}</span>
          </div>
          {session && profiles.length > 0 && (
            <select value={activeProfileId} onChange={(event) => setActiveProfileId(event.target.value)}>
              {profiles.map((profile) => <option key={profile.id} value={profile.id}>{profile.platform}区 · {profile.nickname}</option>)}
            </select>
          )}
          <button className="button secondary" onClick={() => {
            if (session) {
              setAttachCurrentData(true)
              setShowProfileModal(true)
            } else {
              setShowAuth(true)
            }
          }}>{session ? '＋ 新增游戏账号' : '登录并管理'}</button>
        </section>

        <section className="metric-grid">
          <article className="metric-card"><span className="metric-icon blue">◎</span><div><small>总对局数</small><strong>{data.records.length}</strong><em>场</em></div></article>
          <article className="metric-card"><span className="metric-icon green">↗</span><div><small>总胜率</small><strong>{percent(analytics.wins, data.records.length)}</strong><em>%</em></div></article>
          <article className="metric-card"><span className="metric-icon purple">◇</span><div><small>当前积分</small><strong>{analytics.score}</strong><em>分</em></div></article>
          <article className="metric-card"><span className="metric-icon orange">✓</span><div><small>胜 / 负</small><strong>{analytics.wins}<i> / {data.records.length - analytics.wins}</i></strong><em>场</em></div></article>
        </section>

        <section className="chart-stack">
          <article ref={analysisPanel} className="panel chart-panel wide analysis-panel">
            <div className="panel-heading chart-heading">
              <div><h2>自定义组合分析</h2><p>自由组合维度、指标与图表类型</p></div>
              <div className="chart-controls">
                <select value={analysisDimension} onChange={(event) => {
                  const next = event.target.value as AnalysisDimension
                  setAnalysisDimension(next)
                  if (next !== 'date') setAnalysisMetrics((current) => current.filter((metric) => metric !== 'score'))
                }}>
                  <option value="date">按日期</option><option value="teamSize">按组排</option><option value="lane">按分路</option>
                </select>
                <select value={chartType} onChange={(event) => {
                  const next = event.target.value as ChartType
                  setChartType(next)
                  if (next === 'pie') setAnalysisMetrics((current) => current.slice(0, 1))
                }}>
                  <option value="auto">自动组合</option><option value="line">折线图</option><option value="bar">柱状图</option><option value="scatter">散点图</option><option value="pie">饼图</option>
                </select>
                <button type="button" className="fullscreen-button" onClick={() => void toggleChartFullscreen(analysisPanel.current)}>{analysisFullscreen ? '退出全屏' : '全屏显示'}</button>
              </div>
            </div>
            <div className="analysis-range-controls">
              <label><span>开始日期</span><input type="date" value={analysisStartDate} max={analysisEndDate || undefined} onChange={(event) => setAnalysisStartDate(event.target.value)} /></label>
              <label><span>结束日期</span><input type="date" value={analysisEndDate} min={analysisStartDate || undefined} onChange={(event) => setAnalysisEndDate(event.target.value)} /></label>
              {analysisDimension === 'date' && <label><span>日期划分</span><select value={analysisGranularity} onChange={(event) => setAnalysisGranularity(event.target.value as AnalysisGranularity)}><option value="day">按日</option><option value="week">按周</option><option value="month">按月</option></select></label>}
              <button type="button" disabled={!analysisStartDate && !analysisEndDate} onClick={() => { setAnalysisStartDate(''); setAnalysisEndDate('') }}>清除范围</button>
            </div>
            <div className="metric-picker">
              {(Object.keys(analysisMetricConfig) as AnalysisMetricKey[])
                .filter((key) => key !== 'score' || analysisDimension === 'date')
                .map((key) => (
                <label key={key} className={analysisMetrics.includes(key) ? 'selected' : ''}>
                  <input type="checkbox" checked={analysisMetrics.includes(key)} onChange={() => setAnalysisMetrics((current) => {
                    if (chartType === 'pie') return [key]
                    return current.includes(key) ? current.filter((item) => item !== key) : [...current, key]
                  })} />
                  <i style={{ background: analysisMetricConfig[key].color }} />{analysisMetricConfig[key].name}
                </label>
              ))}
              {chartType === 'pie' && <small>饼图一次展示一个指标</small>}
            </div>
            {analysisRows.length && analysisMetrics.length ? <ReactECharts option={analysisOption} notMerge style={{ height: analysisFullscreen ? 'calc(100vh - 205px)' : 330 }} /> : <div className="empty">当前日期范围暂无数据</div>}
          </article>
          <article ref={scorePanel} className="panel chart-panel score-panel">
            <div className="panel-heading"><div><h2>逐场积分走势</h2><p>橙色菱形表示休息日，积分保持不变</p></div><div className="score-chart-actions"><label><input type="checkbox" checked={showRestDays} onChange={(event) => setShowRestDays(event.target.checked)} /> 显示休息日</label><span className={analytics.score >= data.initialScore ? 'trend up' : 'trend down'}>{analytics.score - data.initialScore >= 0 ? '+' : ''}{analytics.score - data.initialScore}</span><button type="button" className="fullscreen-button" onClick={() => void toggleChartFullscreen(scorePanel.current)}>{scoreFullscreen ? '退出全屏' : '全屏显示'}</button></div></div>
            {sortedRecords.length ? <ReactECharts option={scoreOption} notMerge style={{ height: scoreFullscreen ? 'calc(100vh - 105px)' : 330 }} /> : <div className="empty">暂无数据</div>}
          </article>
        </section>

        <section className="panel comparison-panel">
          <div className="panel-heading"><div><h2>时段对比</h2><p>任意周期、分组维度与指标的变化</p></div></div>
          <div className="comparison-controls">
            <label>周期<select value={periodPreset} onChange={(event) => changePreset(event.target.value as PeriodPreset)}><option value="week">本周 vs 上周</option><option value="month">本月 vs 上月</option><option value="last7">近 7 天</option><option value="last30">近 30 天</option><option value="custom">自定义</option></select></label>
            <label>分组<select value={compareDimension} onChange={(event) => setCompareDimension(event.target.value as GroupDimension)}><option value="overall">总体</option><option value="teamSize">组排类型</option><option value="lane">分路</option></select></label>
            <label>指标<select value={compareMetric} onChange={(event) => setCompareMetric(event.target.value as MetricKey)}>{(Object.keys(metricConfig) as MetricKey[]).map((key) => <option value={key} key={key}>{metricConfig[key].name}</option>)}</select></label>
          </div>
          {periodPreset === 'custom' && (
            <div className="custom-ranges">
              <label>对比期 <input type="date" value={previousRange.start} onChange={(event) => setPreviousRange({ ...previousRange, start: event.target.value, label: '对比期' })} /> 至 <input type="date" value={previousRange.end} onChange={(event) => setPreviousRange({ ...previousRange, end: event.target.value, label: '对比期' })} /></label>
              <label>当前期 <input type="date" value={currentRange.start} onChange={(event) => setCurrentRange({ ...currentRange, start: event.target.value, label: '当前期' })} /> 至 <input type="date" value={currentRange.end} onChange={(event) => setCurrentRange({ ...currentRange, end: event.target.value, label: '当前期' })} /></label>
            </div>
          )}
          <div className="comparison-grid">
            {comparisonRows.map((row) => {
              const direction = row.difference > 0 ? 'rise' : row.difference < 0 ? 'fall' : 'flat'
              return (
                <article className="comparison-card" key={row.key}>
                  <h3>{row.label}</h3>
                  <div className="period-values"><span><small>{previousRange.label}</small><b>{metricValue(row, 'previous').toFixed(compareMetric === 'rate' ? 2 : 0)}{metricUnit}</b></span><span>→</span><span><small>{currentRange.label}</small><b>{metricValue(row, 'current').toFixed(compareMetric === 'rate' ? 2 : 0)}{metricUnit}</b></span></div>
                  <div className={`comparison-change ${direction}`}>
                    {direction === 'rise' ? '↑ 上升' : direction === 'fall' ? '↓ 下降' : '— 持平'} {Math.abs(row.difference).toFixed(compareMetric === 'rate' ? 2 : 0)}{compareMetric === 'rate' ? ' 个百分点' : metricUnit}
                    {compareMetric !== 'rate' && row.changeRate !== null && <small>（{Math.abs(row.changeRate).toFixed(2)}%）</small>}
                  </div>
                </article>
              )
            })}
          </div>
        </section>

        <section className="content-grid lower">
          <article className="panel add-panel">
            <div className="panel-heading"><div><h2>记录一场对局</h2><p>{session ? `保存到 ${activeProfile?.nickname ?? '当前游戏账号'}` : '保存在当前浏览器'}</p></div></div>
            <form onSubmit={addRecord}>
              <label className="field"><span>对局日期</span><input type="date" value={date} onChange={(event) => setDate(event.target.value)} required /></label>
              <label className="field"><span>组排人数</span><select value={teamSize} onChange={(event) => setTeamSize(Number(event.target.value))}>{[1, 2, 3, 4, 5].map((size) => <option key={size} value={size}>{modeName(size)}</option>)}</select></label>
              <label className="field"><span>分路</span><select value={lane} onChange={(event) => setLane(Number(event.target.value) as Lane)}>{[0, 1, 2, 3, 4].map((value) => <option key={value} value={value}>{laneName(value as Lane)}</option>)}</select></label>
              <div className="field"><span>对局结果</span><div className="result-switch"><button type="button" className={result === 1 ? 'active win' : ''} onClick={() => setResult(1)}>胜利</button><button type="button" className={result === 0 ? 'active loss' : ''} onClick={() => setResult(0)}>失败</button></div></div>
              <button className="button primary submit" disabled={offline || Boolean(session && !activeProfileId)} type="submit">＋ 添加记录</button>
            </form>
          </article>
          <article className="panel mode-panel">
            <div className="panel-heading"><div><h2>分路表现</h2><p>不同位置的胜率表现</p></div></div>
            <div className="mode-list">
              {analytics.lanes.length ? analytics.lanes.map((item) => <div className="mode-row" key={item.key}><div className="mode-name"><span>{item.key === 'unknown' ? '?' : Number(item.key) + 1}</span><div><strong>{item.label}</strong><small>{item.wins} 胜 · {item.games - item.wins} 负</small></div></div><div className="mode-rate"><strong>{percent(item.wins, item.games)}%</strong><div><i style={{ width: `${percent(item.wins, item.games)}%` }} /></div></div></div>) : <div className="empty compact">暂无分路数据</div>}
            </div>
          </article>
        </section>

        <section className="panel records-panel">
          <div className="panel-heading"><div><h2>最近对局</h2><p>{recentFiltersActive ? `筛选出 ${filteredRecentRecords.length} / ${data.records.length} 条记录` : `共 ${data.records.length} 条记录`}</p></div></div>
          <div className="record-filters">
            <label><span>开始日期</span><input type="date" value={recentFilters.startDate} max={recentFilters.endDate || undefined} onChange={(event) => setRecentFilters({ ...recentFilters, startDate: event.target.value })} /></label>
            <label><span>结束日期</span><input type="date" value={recentFilters.endDate} min={recentFilters.startDate || undefined} onChange={(event) => setRecentFilters({ ...recentFilters, endDate: event.target.value })} /></label>
            <label><span>组排</span><select className={recentFilters.teamSize === null ? '' : teamSizeTone(recentFilters.teamSize)} value={recentFilters.teamSize ?? 'all'} onChange={(event) => setRecentFilters({ ...recentFilters, teamSize: event.target.value === 'all' ? null : Number(event.target.value) })}><option value="all">全部组排</option>{[1, 2, 3, 4, 5].map((size) => <option key={size} value={size}>{modeName(size)}</option>)}</select></label>
            <label><span>分路</span><select className={recentFilters.lane === 'all' ? '' : laneTone(recentFilters.lane)} value={recentFilters.lane === 'all' ? 'all' : recentFilters.lane === null ? 'unknown' : recentFilters.lane} onChange={(event) => setRecentFilters({ ...recentFilters, lane: event.target.value === 'all' ? 'all' : event.target.value === 'unknown' ? null : Number(event.target.value) as Lane })}><option value="all">全部分路</option><option value="unknown">未设置</option>{[0, 1, 2, 3, 4].map((value) => <option key={value} value={value}>{laneName(value as Lane)}</option>)}</select></label>
            <label><span>结果</span><select value={recentFilters.result} onChange={(event) => setRecentFilters({ ...recentFilters, result: event.target.value === 'all' ? 'all' : Number(event.target.value) as MatchResult })}><option value="all">全部结果</option><option value="1">胜利</option><option value="0">失败</option></select></label>
            <button type="button" disabled={!recentFiltersActive} onClick={() => setRecentFilters(emptyRecentMatchFilters)}>重置筛选</button>
          </div>
          <div className="table-wrap"><table><thead><tr><th>日期 / 场次</th><th>组排</th><th>分路</th><th>结果</th><th>积分</th><th /></tr></thead><tbody>
            {[...filteredRecentRecords].reverse().map((record) => <tr key={record.id}><td>{record.date} · {record.order}</td><td><span className={`mode-tag ${teamSizeTone(record.teamSize)}`}>{modeName(record.teamSize)}</span></td><td><span className={`lane-tag ${laneTone(record.lane)}`}>{laneName(record.lane)}</span></td><td><span className={`result-tag ${record.result ? 'win' : 'loss'}`}>{record.result ? '胜利' : '失败'}</span></td><td className={record.points >= 0 ? 'positive' : 'negative'}>{record.points >= 0 ? '+' : ''}{record.points}</td><td><div className="row-actions"><button className="edit" onClick={() => setEditingRecord({ ...record })}>编辑</button><button className="delete" onClick={() => void deleteRecord(record.id)}>×</button></div></td></tr>)}
            {!filteredRecentRecords.length && <tr><td colSpan={6} className="empty-cell">{data.records.length ? '没有符合筛选条件的对局' : '暂无对局记录'}</td></tr>}
          </tbody></table></div>
        </section>
      </main>
      <footer>{session ? `已登录 · ${activeProfile ? `${activeProfile.platform}区 ${activeProfile.nickname}` : '请选择游戏账号'}` : '本地模式 · 登录后可同步到云端'}</footer>

      {pendingConflict && (
        <div className="auth-backdrop">
          <section className="auth-card conflict-card" role="dialog" aria-modal="true" aria-labelledby="conflict-title">
            <h2 id="conflict-title">发现数据冲突</h2>
            <p>{conflictLabels.local}有 {pendingConflict.local.records.length} 条，{conflictLabels.remote}有 {pendingConflict.remote.records.length} 条。请选择处理方式，确认前不会写入数据。</p>
            <div className="conflict-summary">
              <span><b>{pendingConflict.merge.data.records.length}</b> 条合并后记录</span>
              <span><b>{pendingConflict.merge.conflicts.length}</b> 条内容冲突</span>
            </div>
            {diffStoredData(pendingConflict.local, pendingConflict.remote).changedSettings.length > 0 && (
              <fieldset className="settings-conflict">
                <legend>积分设置使用哪一份？</legend>
                <label><input type="radio" name="settings-source" checked={conflictSettingsChoice === 'local'} onChange={() => setConflictSettingsChoice('local')} /> {conflictLabels.local}（初始 {pendingConflict.local.initialScore}，胜 +{pendingConflict.local.winPoints}，负 -{pendingConflict.local.lossPoints}）</label>
                <label><input type="radio" name="settings-source" checked={conflictSettingsChoice === 'remote'} onChange={() => setConflictSettingsChoice('remote')} /> {conflictLabels.remote}（初始 {pendingConflict.remote.initialScore}，胜 +{pendingConflict.remote.winPoints}，负 -{pendingConflict.remote.lossPoints}）</label>
              </fieldset>
            )}
            {pendingConflict.merge.conflicts.length > 0 && (
              <div className="record-conflicts">
                <h3>逐条选择冲突版本</h3>
                {pendingConflict.merge.conflicts.map((conflict) => (
                  <fieldset key={conflict.id}>
                    <legend>{conflict.differingFields.join('、')} 不同</legend>
                    <label className={conflictChoices[conflict.id] === 'local' ? 'selected' : ''}><input type="radio" name={`record-${conflict.id}`} checked={conflictChoices[conflict.id] === 'local'} onChange={() => setConflictChoices({ ...conflictChoices, [conflict.id]: 'local' })} /><span><b>{conflictLabels.local}</b>{recordSummary(conflict.local)}</span></label>
                    <label className={conflictChoices[conflict.id] === 'remote' ? 'selected' : ''}><input type="radio" name={`record-${conflict.id}`} checked={conflictChoices[conflict.id] === 'remote'} onChange={() => setConflictChoices({ ...conflictChoices, [conflict.id]: 'remote' })} /><span><b>{conflictLabels.remote}</b>{recordSummary(conflict.remote)}</span></label>
                  </fieldset>
                ))}
              </div>
            )}
            <div className="conflict-actions">
              <button className="button danger" disabled={loading} onClick={() => void saveConflictResolution(pendingConflict.local)}>{conflictLabels.overwrite}</button>
              <button className="button secondary" disabled={loading} onClick={discardConflictLocal}>{conflictLabels.discard}</button>
              <button className="button primary" disabled={loading || pendingConflict.merge.conflicts.some((conflict) => !conflictChoices[conflict.id])} onClick={mergeConflictData}>合并并保存</button>
            </div>
          </section>
        </div>
      )}
      {showAuth && !session && <AuthPanel onCancel={() => setShowAuth(false)} />}
      {editingRecord && (
        <div className="auth-backdrop">
          <form className="auth-card edit-record-form" onSubmit={saveEditedRecord}>
            <h2>修改对局记录</h2><p>日期或场次改变后，同一天的场次顺序会自动整理。</p>
            <div className="edit-form-grid">
              <label className="field"><span>日期</span><input type="date" value={editingRecord.date} onChange={(event) => setEditingRecord({ ...editingRecord, date: event.target.value })} required /></label>
              <label className="field"><span>场次</span><input type="number" min="1" value={editingRecord.order} onChange={(event) => setEditingRecord({ ...editingRecord, order: Number(event.target.value) })} required /></label>
              <label className="field"><span>组排</span><select value={editingRecord.teamSize} onChange={(event) => setEditingRecord({ ...editingRecord, teamSize: Number(event.target.value) })}>{[1, 2, 3, 4, 5].map((size) => <option key={size} value={size}>{modeName(size)}</option>)}</select></label>
              <label className="field"><span>分路</span><select value={editingRecord.lane ?? 'unknown'} onChange={(event) => setEditingRecord({ ...editingRecord, lane: event.target.value === 'unknown' ? null : Number(event.target.value) as Lane })}><option value="unknown">未设置</option>{[0, 1, 2, 3, 4].map((value) => <option key={value} value={value}>{laneName(value as Lane)}</option>)}</select></label>
              <div className="field"><span>结果</span><div className="result-switch"><button type="button" className={editingRecord.result === 1 ? 'active win' : ''} onClick={() => setEditingRecord({ ...editingRecord, result: 1, points: data.winPoints })}>胜利</button><button type="button" className={editingRecord.result === 0 ? 'active loss' : ''} onClick={() => setEditingRecord({ ...editingRecord, result: 0, points: -data.lossPoints })}>失败</button></div></div>
              <label className="field"><span>积分变化</span><input type="number" value={editingRecord.points} onChange={(event) => setEditingRecord({ ...editingRecord, points: Number(event.target.value) })} required /></label>
            </div>
            <button className="button primary auth-submit" disabled={offline}>保存修改</button>
            <button type="button" className="local-link" onClick={() => setEditingRecord(null)}>取消</button>
          </form>
        </div>
      )}
      {showProfileModal && session && (
        <div className="auth-backdrop">
          <form className="auth-card profile-form" onSubmit={submitProfile}>
            <h2>新增游戏账号</h2><p>每个游戏账号拥有独立的对局记录和积分。</p>
            <label className="field"><span>昵称</span><input autoFocus maxLength={24} value={profileNickname} onChange={(event) => setProfileNickname(event.target.value)} placeholder="中英文、数字或下划线" /></label>
            <div className="platform-picker"><button type="button" className={profilePlatform === 'Q' ? 'active' : ''} onClick={() => setProfilePlatform('Q')}>Q · QQ区</button><button type="button" className={profilePlatform === 'V' ? 'active' : ''} onClick={() => setProfilePlatform('V')}>V · 微信区</button></div>
            <label className="attach-option"><input type="checkbox" checked={attachCurrentData} onChange={(event) => setAttachCurrentData(event.target.checked)} /><span><b>{activeProfileId ? '接管当前账号数据' : '关联当前本地数据'}</b><small>{activeProfileId ? '关联后，原游戏账号将自动与当前数据断开' : '取消勾选将创建一份空数据'}</small></span></label>
            <button className="button primary auth-submit" disabled={loading}>创建账号</button>
            {profiles.length > 0 && <button type="button" className="local-link" onClick={() => setShowProfileModal(false)}>取消</button>}
          </form>
        </div>
      )}
    </div>
  )
}

export default App

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
  createGameProfile, loadCloudData, loadGameProfiles, saveCloudData, transferGameData,
} from './repository'
import {
  loadLocalData, localMigrationCompleted, markLocalMigrationCompleted, saveLocalData,
} from './storage'
import { comparePeriods, getPresetRanges } from './utils/analytics'
import type { DateRange } from './utils/analytics'
import './App.css'

const metricConfig: Record<MetricKey, { name: string; type: 'bar' | 'line'; color: string; axis: number }> = {
  games: { name: '对局数', type: 'bar', color: '#9bb6ff', axis: 0 },
  wins: { name: '胜场数', type: 'bar', color: '#72d5aa', axis: 0 },
  rate: { name: '胜率', type: 'line', color: '#4f7cff', axis: 1 },
  points: { name: '净积分', type: 'line', color: '#7c5ce7', axis: 2 },
}

const emptyData = (): StoredData => ({ ...initialData, records: [] })

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

function App() {
  const { session, loading: authLoading, signOut } = useAuth()
  const [data, setData] = useState<StoredData>(loadLocalData)
  const [date, setDate] = useState(new Date().toISOString().slice(0, 10))
  const [teamSize, setTeamSize] = useState(2)
  const [result, setResult] = useState<MatchResult>(1)
  const [lane, setLane] = useState<Lane>(0)
  const [analysisDimension, setAnalysisDimension] = useState<AnalysisDimension>('date')
  const [analysisMetrics, setAnalysisMetrics] = useState<MetricKey[]>(['games', 'rate'])
  const [chartType, setChartType] = useState<ChartType>('auto')
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
  const [showAuth, setShowAuth] = useState(false)
  const [loading, setLoading] = useState(false)
  const [offline, setOffline] = useState(false)
  const [message, setMessage] = useState('')
  const fileInput = useRef<HTMLInputElement>(null)

  const activeProfile = profiles.find((profile) => profile.id === activeProfileId)

  useEffect(() => {
    if (!session) {
      setProfiles([])
      setActiveProfileId('')
      setOffline(false)
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
      setOffline(resultData.offline)
      if (resultData.error) setMessage(resultData.error)
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
      if (session && activeProfileId) await saveCloudData(session.user.id, activeProfileId, next)
      else saveLocalData(next)
      return true
    } catch (reason) {
      setData(previous)
      setMessage(reason instanceof Error ? reason.message : '保存失败')
      return false
    }
  }

  const sortedRecords = useMemo(
    () => [...data.records].sort((a, b) => a.date.localeCompare(b.date) || a.order - b.order || a.id.localeCompare(b.id)),
    [data.records],
  )

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
    const source = analysisDimension === 'date' ? analytics.daily : analysisDimension === 'teamSize' ? analytics.modes : analytics.lanes
    return source.map((item) => ({
      label: item.label,
      games: item.games,
      wins: item.wins,
      rate: item.games ? Number(percent(item.wins, item.games)) : null,
      points: item.points,
    }))
  }, [analysisDimension, analytics])

  const analysisOption = useMemo(() => {
    const selectedMetrics = chartType === 'pie' ? analysisMetrics.slice(0, 1) : analysisMetrics
    if (chartType === 'pie') {
      const metric = selectedMetrics[0] ?? 'games'
      return {
        tooltip: { trigger: 'item' },
        legend: { bottom: 4 },
        series: [{
          name: metricConfig[metric].name,
          type: 'pie',
          radius: ['38%', '68%'],
          data: analysisRows.map((item) => ({ name: item.label, value: item[metric] })),
          label: { formatter: '{b}\n{d}%' },
        }],
      }
    }
    return {
      tooltip: { trigger: 'axis' },
      legend: { data: selectedMetrics.map((key) => metricConfig[key].name), right: 8 },
      grid: { left: 48, right: 60, top: 56, bottom: 38 },
      xAxis: { type: 'category', data: analysisRows.map((item) => item.label) },
      yAxis: [
        { type: 'value', name: '场', minInterval: 1, splitLine: { lineStyle: { color: '#edf2f7' } } },
        { type: 'value', name: '%', min: 0, max: 100, splitLine: { show: false } },
        { type: 'value', name: '分', position: 'right', offset: 38, splitLine: { show: false } },
      ],
      series: selectedMetrics.map((key) => {
        const config = metricConfig[key]
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

  const migrateLocalData = async () => {
    if (!session || !activeProfileId) return
    setLoading(true)
    try {
      const localData = loadLocalData()
      await saveCloudData(session.user.id, activeProfileId, localData)
      markLocalMigrationCompleted(session.user.id)
      setData(localData)
      setMessage(`已迁移 ${localData.records.length} 条本地记录`)
    } catch (reason) {
      setMessage(reason instanceof Error ? reason.message : '本地数据迁移失败')
    } finally {
      setLoading(false)
    }
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
      if (await persistData(imported)) setMessage(`成功导入 ${imported.records.length} 条记录`)
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
        {session && !localMigrationCompleted(session.user.id) && activeProfileId && (
          <div className="status-banner migration-banner">
            <span>检测到本机历史数据，是否关联到当前游戏账号？</span>
            <div><button onClick={() => void migrateLocalData()}>迁移到当前账号</button><button onClick={() => { markLocalMigrationCompleted(session.user.id); setMessage('已保留云端数据') }}>忽略</button></div>
          </div>
        )}

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

        <section className="content-grid">
          <article className="panel chart-panel wide">
            <div className="panel-heading chart-heading">
              <div><h2>自定义组合分析</h2><p>自由组合维度、指标与图表类型</p></div>
              <div className="chart-controls">
                <select value={analysisDimension} onChange={(event) => setAnalysisDimension(event.target.value as AnalysisDimension)}>
                  <option value="date">按日期</option><option value="teamSize">按组排</option><option value="lane">按分路</option>
                </select>
                <select value={chartType} onChange={(event) => {
                  const next = event.target.value as ChartType
                  setChartType(next)
                  if (next === 'pie') setAnalysisMetrics((current) => current.slice(0, 1))
                }}>
                  <option value="auto">自动组合</option><option value="line">折线图</option><option value="bar">柱状图</option><option value="scatter">散点图</option><option value="pie">饼图</option>
                </select>
              </div>
            </div>
            <div className="metric-picker">
              {(Object.keys(metricConfig) as MetricKey[]).map((key) => (
                <label key={key} className={analysisMetrics.includes(key) ? 'selected' : ''}>
                  <input type="checkbox" checked={analysisMetrics.includes(key)} onChange={() => setAnalysisMetrics((current) => {
                    if (chartType === 'pie') return [key]
                    return current.includes(key) ? current.filter((item) => item !== key) : [...current, key]
                  })} />
                  <i style={{ background: metricConfig[key].color }} />{metricConfig[key].name}
                </label>
              ))}
              {chartType === 'pie' && <small>饼图一次展示一个指标</small>}
            </div>
            {analysisRows.length && analysisMetrics.length ? <ReactECharts option={analysisOption} style={{ height: 330 }} /> : <div className="empty">请选择指标并添加对局数据</div>}
          </article>
          <article className="panel chart-panel">
            <div className="panel-heading"><div><h2>逐场积分走势</h2><p>橙色菱形表示休息日，积分保持不变</p></div><div className="score-chart-actions"><label><input type="checkbox" checked={showRestDays} onChange={(event) => setShowRestDays(event.target.checked)} /> 显示休息日</label><span className={analytics.score >= data.initialScore ? 'trend up' : 'trend down'}>{analytics.score - data.initialScore >= 0 ? '+' : ''}{analytics.score - data.initialScore}</span></div></div>
            {sortedRecords.length ? <ReactECharts option={scoreOption} style={{ height: 330 }} /> : <div className="empty">暂无数据</div>}
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
          <div className="panel-heading"><div><h2>最近对局</h2><p>共 {data.records.length} 条记录</p></div></div>
          <div className="table-wrap"><table><thead><tr><th>日期 / 场次</th><th>组排</th><th>分路</th><th>结果</th><th>积分</th><th /></tr></thead><tbody>
            {[...sortedRecords].reverse().map((record) => <tr key={record.id}><td>{record.date} · {record.order}</td><td><span className="mode-tag">{modeName(record.teamSize)}</span></td><td><span className="lane-tag">{laneName(record.lane)}</span></td><td><span className={`result-tag ${record.result ? 'win' : 'loss'}`}>{record.result ? '胜利' : '失败'}</span></td><td className={record.points >= 0 ? 'positive' : 'negative'}>{record.points >= 0 ? '+' : ''}{record.points}</td><td><div className="row-actions"><button className="edit" onClick={() => setEditingRecord({ ...record })}>编辑</button><button className="delete" onClick={() => void deleteRecord(record.id)}>×</button></div></td></tr>)}
            {!sortedRecords.length && <tr><td colSpan={6} className="empty-cell">暂无对局记录</td></tr>}
          </tbody></table></div>
        </section>
      </main>
      <footer>{session ? `已登录 · ${activeProfile ? `${activeProfile.platform}区 ${activeProfile.nickname}` : '请选择游戏账号'}` : '本地模式 · 登录后可同步到云端'}</footer>

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

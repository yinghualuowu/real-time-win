import { useState } from 'react'
import { newId, validateSeasons } from '../model'
import type { MatchRecord, Season } from '../model'

type Props = {
  seasons: Season[]
  records: MatchRecord[]
  disabled?: boolean
  onChange: (seasons: Season[]) => Promise<boolean>
  onClose: () => void
}

const emptyForm = { id: '', name: '', startDate: '', endDate: '' }

export function SeasonManagerModal({ seasons, records, disabled, onChange, onClose }: Props) {
  const [form, setForm] = useState(emptyForm)
  const [error, setError] = useState('')

  const reset = () => {
    setForm(emptyForm)
    setError('')
  }

  const submit = async (event: React.FormEvent) => {
    event.preventDefault()
    const season: Season = {
      id: form.id || newId(),
      name: form.name.trim(),
      startDate: form.startDate,
      endDate: form.endDate,
    }
    const next = [
      ...seasons.filter((item) => item.id !== form.id),
      season,
    ].sort((left, right) => left.startDate.localeCompare(right.startDate))
    try {
      validateSeasons(next)
      if (await onChange(next)) reset()
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : '赛季信息无效')
    }
  }

  const remove = async (season: Season) => {
    const count = records.filter((record) =>
      record.date >= season.startDate && record.date <= season.endDate,
    ).length
    if (!window.confirm(`删除“${season.name}”后，${count} 条对局将变为未匹配赛季。确定删除吗？`)) return
    if (await onChange(seasons.filter((item) => item.id !== season.id)) && form.id === season.id) reset()
  }

  return (
    <div className="auth-backdrop">
      <section className="auth-card manage-card" role="dialog" aria-modal="true" aria-labelledby="season-manager-title">
        <h2 id="season-manager-title">赛季管理</h2>
        <p>赛季按闭区间自动关联对局，同一日期只能属于一个赛季。</p>
        <form className="catalog-form" onSubmit={submit}>
          <label className="field"><span>赛季名称</span><input value={form.name} maxLength={32} onChange={(event) => setForm({ ...form, name: event.target.value })} placeholder="例如 S38" required /></label>
          <label className="field"><span>开始日期</span><input type="date" value={form.startDate} onChange={(event) => setForm({ ...form, startDate: event.target.value })} required /></label>
          <label className="field"><span>结束日期</span><input type="date" min={form.startDate || undefined} value={form.endDate} onChange={(event) => setForm({ ...form, endDate: event.target.value })} required /></label>
          <button className="button primary" disabled={disabled}>{form.id ? '保存赛季' : '新增赛季'}</button>
          {form.id && <button type="button" className="button secondary" onClick={reset}>取消编辑</button>}
        </form>
        {error && <div className="auth-error">{error}</div>}
        <div className="catalog-list">
          {seasons.map((season) => {
            const count = records.filter((record) =>
              record.date >= season.startDate && record.date <= season.endDate,
            ).length
            return (
              <article key={season.id}>
                <div><strong>{season.name}</strong><small>{season.startDate} 至 {season.endDate} · 自动关联 {count} 场</small></div>
                <span><button onClick={() => { setForm(season); setError('') }}>编辑</button><button className="danger-link" onClick={() => void remove(season)}>删除</button></span>
              </article>
            )
          })}
          {!seasons.length && <div className="empty compact">尚未创建赛季</div>}
        </div>
        <button type="button" className="local-link" onClick={onClose}>关闭</button>
      </section>
    </div>
  )
}

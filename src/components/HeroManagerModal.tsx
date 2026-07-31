import { useState } from 'react'
import { newId, validateHeroes } from '../model'
import type { Hero, MatchRecord } from '../model'

type Props = {
  heroes: Hero[]
  records: MatchRecord[]
  disabled?: boolean
  onChange: (heroes: Hero[]) => Promise<boolean>
  onDelete: (heroId: string) => Promise<boolean>
  onClose: () => void
}

export function HeroManagerModal({ heroes, records, disabled, onChange, onDelete, onClose }: Props) {
  const [editingId, setEditingId] = useState('')
  const [name, setName] = useState('')
  const [error, setError] = useState('')

  const reset = () => {
    setEditingId('')
    setName('')
    setError('')
  }

  const submit = async (event: React.FormEvent) => {
    event.preventDefault()
    const hero: Hero = { id: editingId || newId(), name: name.trim() }
    const next = [...heroes.filter((item) => item.id !== editingId), hero]
      .sort((left, right) => left.name.localeCompare(right.name, 'zh-CN'))
    try {
      validateHeroes(next)
      if (await onChange(next)) reset()
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : '英雄信息无效')
    }
  }

  const remove = async (hero: Hero) => {
    const count = records.filter((record) => record.heroId === hero.id).length
    if (count && !window.confirm(`“${hero.name}”已关联 ${count} 条对局。删除后这些记录的英雄会被清空，确定继续吗？`)) return
    if (!count && !window.confirm(`确定删除英雄“${hero.name}”吗？`)) return
    if (await onDelete(hero.id) && editingId === hero.id) reset()
  }

  return (
    <div className="auth-backdrop">
      <section className="auth-card manage-card" role="dialog" aria-modal="true" aria-labelledby="hero-manager-title">
        <h2 id="hero-manager-title">英雄管理</h2>
        <p>每条对局可关联一个英雄，名称在当前游戏账号内不可重复。</p>
        <form className="catalog-form compact-form" onSubmit={submit}>
          <label className="field"><span>英雄名称</span><input value={name} maxLength={32} onChange={(event) => setName(event.target.value)} placeholder="输入英雄名称" required /></label>
          <button className="button primary" disabled={disabled}>{editingId ? '保存英雄' : '新增英雄'}</button>
          {editingId && <button type="button" className="button secondary" onClick={reset}>取消编辑</button>}
        </form>
        {error && <div className="auth-error">{error}</div>}
        <div className="catalog-list">
          {heroes.map((hero) => {
            const count = records.filter((record) => record.heroId === hero.id).length
            return (
              <article key={hero.id}>
                <div><strong>{hero.name}</strong><small>已关联 {count} 场对局</small></div>
                <span><button onClick={() => { setEditingId(hero.id); setName(hero.name); setError('') }}>编辑</button><button className="danger-link" onClick={() => void remove(hero)}>删除</button></span>
              </article>
            )
          })}
          {!heroes.length && <div className="empty compact">尚未添加英雄</div>}
        </div>
        <button type="button" className="local-link" onClick={onClose}>关闭</button>
      </section>
    </div>
  )
}

import { describe, expect, it } from 'vitest'
import { clampPage, pageCount, paginate } from './pagination'

describe('pagination', () => {
  it('calculates pages and slices the requested page', () => {
    expect(pageCount(41, 20)).toBe(3)
    expect(paginate([1, 2, 3, 4, 5], 2, 2)).toEqual({
      page: 2,
      pageCount: 3,
      items: [3, 4],
    })
  })

  it('clamps invalid and now-empty pages', () => {
    expect(clampPage(9, 3, 20)).toBe(1)
    expect(clampPage(0, 100, 20)).toBe(1)
    expect(paginate([], 4, 20)).toEqual({ page: 1, pageCount: 1, items: [] })
  })
})

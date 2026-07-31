export function pageCount(totalItems: number, pageSize: number) {
  if (pageSize < 1) return 1
  return Math.max(1, Math.ceil(totalItems / pageSize))
}

export function clampPage(page: number, totalItems: number, pageSize: number) {
  return Math.min(Math.max(1, Math.trunc(page) || 1), pageCount(totalItems, pageSize))
}

export function paginate<T>(items: T[], page: number, pageSize: number) {
  const safePage = clampPage(page, items.length, pageSize)
  const start = (safePage - 1) * pageSize
  return {
    page: safePage,
    pageCount: pageCount(items.length, pageSize),
    items: items.slice(start, start + pageSize),
  }
}

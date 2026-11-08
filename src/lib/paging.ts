/**
 * Server-side list paging. Lists answer `?paged=1&limit=&offset=&q=` with
 * `{ rows, total, summary }`; without `paged=1` they keep returning the plain
 * array that pickers and older callers expect.
 */
export const DEFAULT_PAGE = 100
export const MAX_PAGE = 500

export function pageParams(sp: URLSearchParams) {
  const int = (v: string | null) => (v && /^\d+$/.test(v) ? Number(v) : NaN)
  const limit = Math.min(MAX_PAGE, Math.max(1, int(sp.get('limit')) || DEFAULT_PAGE))
  const offset = Math.max(0, int(sp.get('offset')) || 0)
  const q = (sp.get('q') ?? '').trim().slice(0, 80)
  return { paged: sp.get('paged') === '1', limit, offset, q }
}

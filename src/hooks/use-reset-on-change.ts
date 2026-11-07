import { useState } from 'react'

const sameDeps = (a: readonly unknown[], b: readonly unknown[]) => a.length === b.length && a.every((value, i) => Object.is(value, b[i]))

/**
 * Re-initialise local form state when a dialog opens or its source record
 * changes — without an effect.
 *
 * Effects that copy props into state render once with stale values and then
 * cascade a second render (react-hooks/set-state-in-effect). React's documented
 * alternative is to adjust state *during render* when the inputs change
 * ("Storing information from previous renders"): `apply` runs in the same
 * render pass, before anything stale reaches the screen. It runs when `active`
 * turns true and whenever `deps` change while `active` stays true.
 */
export function useResetOnChange(active: boolean, deps: readonly unknown[], apply: () => void): void {
  const [seen, setSeen] = useState<{ active: boolean; deps: readonly unknown[] } | null>(null)
  if (seen === null || seen.active !== active || (active && !sameDeps(seen.deps, deps))) {
    setSeen({ active, deps })
    if (active) apply()
  }
}

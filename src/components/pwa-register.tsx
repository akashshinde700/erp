'use client'

/**
 * PWA runtime for ForgeERP.
 *  - Registers the service worker after the page loads.
 *  - Shows a persistent offline banner (live ERP data is never cached — the
 *    banner states that honestly instead of faking stale data).
 *  - Update flow: when a new SW is waiting, shows a toast with an explicit
 *    "Reload" action. Nothing reloads silently; the user stays in control.
 */

import { useEffect, useSyncExternalStore } from 'react'
import { WifiOff } from 'lucide-react'
import { toast } from 'sonner'

function subscribeOnline(callback: () => void) {
  window.addEventListener('online', callback)
  window.addEventListener('offline', callback)
  return () => {
    window.removeEventListener('online', callback)
    window.removeEventListener('offline', callback)
  }
}

function useOnlineStatus() {
  return useSyncExternalStore(
    subscribeOnline,
    () => navigator.onLine,
    () => true
  )
}

function OfflineBanner() {
  const online = useOnlineStatus()
  if (online) return null
  return (
    <div
      role="status"
      aria-live="polite"
      className="fixed inset-x-0 bottom-0 z-[60] border-t border-amber-400/60 bg-amber-500 px-4 py-2.5 text-amber-950 shadow-lg pb-[max(0.625rem,env(safe-area-inset-bottom))] dark:border-amber-500/40 dark:bg-amber-600 dark:text-amber-50"
    >
      <div className="mx-auto flex max-w-7xl items-center gap-2 text-sm font-medium">
        <WifiOff className="size-4 shrink-0" aria-hidden />
        <span>
          You&rsquo;re offline — live inventory, invoices and payments need a connection. Anything on screen may
          be stale; transactions will not be queued.
        </span>
      </div>
    </div>
  )
}

function ServiceWorkerBridge() {
  useEffect(() => {
    if (typeof window === 'undefined' || !('serviceWorker' in navigator)) return

    let refreshing = false
    // If the page already had a controller, a later controllerchange means a
    // new version took over after the user approved the reload.
    const hadController = Boolean(navigator.serviceWorker.controller)

    const onControllerChange = () => {
      if (hadController && !refreshing) {
        refreshing = true
        window.location.reload()
      }
    }

    const register = async () => {
      try {
        const reg = await navigator.serviceWorker.register('/sw.js', { scope: '/' })

        reg.addEventListener('updatefound', () => {
          const installing = reg.installing
          if (!installing) return
          installing.addEventListener('statechange', () => {
            if (installing.state === 'installed' && navigator.serviceWorker.controller) {
              toast('Update available', {
                description: 'A new version of ForgeERP is ready. Reload to apply it.',
                action: {
                  label: 'Reload',
                  onClick: () => installing.postMessage({ type: 'SKIP_WAITING' }),
                },
                duration: Infinity,
              })
            }
          })
        })
      } catch {
        // SW registration is best-effort (unsupported/insecure contexts).
      }
    }

    if (document.readyState === 'complete') void register()
    else window.addEventListener('load', register, { once: true })

    navigator.serviceWorker.addEventListener('controllerchange', onControllerChange)
    return () => {
      navigator.serviceWorker.removeEventListener('controllerchange', onControllerChange)
    }
  }, [])

  return null
}

export function PwaRegister() {
  return (
    <>
      <ServiceWorkerBridge />
      <OfflineBanner />
    </>
  )
}

import { useEffect } from 'react'

/**
 * Periodically calls `fn`, and also whenever the tab/PWA regains focus or
 * becomes visible again.
 *
 * Why: App.jsx mounts each page once and keeps it alive (hidden via CSS),
 * so a page's initial mount-time fetch never re-runs on navigation. Without
 * this, data like the file dropdown or rack visualization stays stale until
 * a full page reload. The visibility/focus refresh also covers reopening the
 * iOS home-screen (PWA) app.
 *
 * @param {Function} fn        stable callback (wrap in useCallback)
 * @param {number}   intervalMs polling interval; pass 0 to disable polling
 *                              and only refresh on focus/visibility.
 */
export function useAutoRefresh(fn, intervalMs = 12000) {
  useEffect(() => {
    if (typeof fn !== 'function') return
    const id = intervalMs > 0 ? setInterval(fn, intervalMs) : null
    const onVisible = () => { if (document.visibilityState === 'visible') fn() }
    document.addEventListener('visibilitychange', onVisible)
    window.addEventListener('focus', onVisible)
    return () => {
      if (id) clearInterval(id)
      document.removeEventListener('visibilitychange', onVisible)
      window.removeEventListener('focus', onVisible)
    }
  }, [fn, intervalMs])
}

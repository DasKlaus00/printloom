/* Web-Push client helpers: register SW, subscribe/unsubscribe, report state. */
import { pushService } from './api'

export function pushSupported() {
  return 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window
}

// Returns null if push IS supported, otherwise a precise German reason string.
export function pushUnsupportedReason() {
  if (pushSupported()) return null

  const ua    = navigator.userAgent || ''
  const isIOS = /iPad|iPhone|iPod/.test(ua) ||
                (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1)
  const standalone = window.matchMedia?.('(display-mode: standalone)').matches ||
                     window.navigator.standalone === true

  // Most common blocker on a LAN farm: served over plain HTTP. iOS (and Chrome)
  // only expose Web Push in a secure context — localhost is exempt, a LAN IP is not.
  if (!window.isSecureContext) {
    return isIOS
      ? 'Kein sicherer Kontext: Du öffnest die Farm über HTTP (lokale IP). iOS erlaubt ' +
        'Web-Push nur über HTTPS. Lösung: die Farm über HTTPS erreichbar machen (z. B. ' +
        'Reverse-Proxy mit Zertifikat) — danach zum Home-Bildschirm hinzufügen.'
      : 'Kein sicherer Kontext (HTTP). Web-Push braucht HTTPS — nur „localhost" ist ausgenommen.'
  }

  if (isIOS && !standalone) {
    return 'Auf iPhone/iPad: Seite über „Teilen → Zum Home-Bildschirm" installieren und ' +
           'die App vom Home-Screen-Icon aus öffnen (iOS 16.4+). Im normalen Safari-Tab gibt ' +
           'es kein Web-Push.'
  }

  return 'Dieser Browser/dieses Gerät unterstützt keine Web-Push-Benachrichtigungen.'
}

function urlB64ToUint8Array(base64String) {
  const padding = '='.repeat((4 - (base64String.length % 4)) % 4)
  const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/')
  const raw = atob(base64)
  const out = new Uint8Array(raw.length)
  for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i)
  return out
}

export async function getRegistration() {
  if (!('serviceWorker' in navigator)) return null
  return navigator.serviceWorker.register('/sw.js')
}

export async function isSubscribed() {
  if (!pushSupported()) return false
  const reg = await navigator.serviceWorker.getRegistration()
  if (!reg) return false
  const sub = await reg.pushManager.getSubscription()
  return !!sub
}

// Re-register the browser's current subscription with the backend. Heals the
// desync where the UI shows "subscribed" (browser has a local sub) but the
// server's list is empty (e.g. db/ was reset, or the original POST never
// arrived) — which makes "Test senden" report "0 Geräte". Idempotent.
// Returns true if a local subscription exists and was pushed to the server.
export async function syncSubscription() {
  if (!pushSupported()) return false
  const reg = await navigator.serviceWorker.getRegistration()
  if (!reg) return false
  const sub = await reg.pushManager.getSubscription()
  if (!sub) return false
  try { await pushService.subscribe(sub.toJSON()) } catch { return false }
  return true
}

export async function subscribe() {
  if (!pushSupported()) throw new Error('Push wird von diesem Browser/Gerät nicht unterstützt')
  const perm = await Notification.requestPermission()
  if (perm !== 'granted') throw new Error('Benachrichtigungen wurden nicht erlaubt')

  const reg = await getRegistration()
  await navigator.serviceWorker.ready

  const { data } = await pushService.getPublicKey()
  if (!data.available || !data.public_key) {
    throw new Error('Server-Push nicht verfügbar (Abhängigkeiten fehlen)')
  }

  let sub = await reg.pushManager.getSubscription()
  if (!sub) {
    sub = await reg.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: urlB64ToUint8Array(data.public_key),
    })
  }
  await pushService.subscribe(sub.toJSON())
  return true
}

export async function unsubscribe() {
  const reg = await navigator.serviceWorker.getRegistration()
  if (!reg) return
  const sub = await reg.pushManager.getSubscription()
  if (sub) {
    try { await pushService.unsubscribe({ endpoint: sub.endpoint }) } catch {}
    await sub.unsubscribe()
  }
}

/* Printloom service worker — web-push notifications for the PWA. */

self.addEventListener('install', () => self.skipWaiting())
self.addEventListener('activate', (e) => e.waitUntil(self.clients.claim()))

self.addEventListener('push', (event) => {
  // Relativ zum Scope: Printloom kann unter einem Basis-Pfad laufen (z. B. /live/).
  const home = self.registration.scope
  let data = { title: 'Printloom', body: '', url: home }
  try {
    if (event.data) data = { ...data, ...event.data.json() }
  } catch {
    if (event.data) data.body = event.data.text()
  }
  event.waitUntil(
    self.registration.showNotification(data.title || 'Printloom', {
      body: data.body || '',
      icon: new URL('icon-192.png', self.registration.scope).href,
      badge: new URL('favicon-32.png', self.registration.scope).href,
      data: { url: data.url || home },
      tag: 'printloom',
      renotify: true,
    })
  )
})

self.addEventListener('notificationclick', (event) => {
  event.notification.close()
  const url = event.notification.data?.url || self.registration.scope
  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((list) => {
      for (const client of list) {
        if ('focus' in client) { client.navigate(url); return client.focus() }
      }
      return self.clients.openWindow(url)
    })
  )
})

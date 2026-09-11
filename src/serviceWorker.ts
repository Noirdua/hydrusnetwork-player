export function registerServiceWorker() {
  if ('serviceWorker' in navigator) {
    window.addEventListener('load', () => {
      let refreshing = false
      const hadController = Boolean(navigator.serviceWorker.controller)

      navigator.serviceWorker.addEventListener('controllerchange', () => {
        if (!hadController || refreshing) return
        refreshing = true
        window.location.reload()
      })

      navigator.serviceWorker
        .register('/sw.js')
        .then((reg) => {
          console.log('Service worker registered:', reg)

          void reg.update().catch(() => undefined)

          if (reg.waiting) {
            reg.waiting.postMessage({ type: 'SKIP_WAITING' })
          }

          reg.addEventListener('updatefound', () => {
            const installingWorker = reg.installing
            if (!installingWorker) return

            installingWorker.addEventListener('statechange', () => {
              if (installingWorker.state === 'installed' && navigator.serviceWorker.controller) {
                installingWorker.postMessage({ type: 'SKIP_WAITING' })
              }
            })
          })
        })
        .catch((err) => console.log('Service worker registration failed:', err))
    })
  }
}

export function unregisterServiceWorker() {
  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.getRegistrations().then((regs) => regs.forEach((r) => r.unregister()))
  }
}

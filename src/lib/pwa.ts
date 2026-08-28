interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>
}

let deferredPrompt: BeforeInstallPromptEvent | null = null
let canInstall = false

const listeners = new Set<(can: boolean) => void>()

export function isStandalone(): boolean {
  if (typeof window === 'undefined') return false
  return Boolean(
    window.matchMedia('(display-mode: standalone)').matches ||
    window.matchMedia('(display-mode: fullscreen)').matches ||
    (navigator as unknown as { standalone?: boolean }).standalone === true
  )
}

export function subscribePwa(fn: (can: boolean) => void) {
  listeners.add(fn)
  fn(canInstall)
  return () => listeners.delete(fn)
}

function notify() {
  for (const fn of listeners) {
    fn(canInstall)
  }
}

if (typeof window !== 'undefined') {
  window.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault()
    deferredPrompt = e as BeforeInstallPromptEvent
    canInstall = true
    notify()
  })

  window.addEventListener('appinstalled', () => {
    deferredPrompt = null
    canInstall = false
    notify()
  })
}

export async function promptInstall(): Promise<boolean> {
  if (!deferredPrompt) return false
  try {
    await deferredPrompt.prompt()
    const choice = await deferredPrompt.userChoice
    if (choice.outcome === 'accepted') {
      deferredPrompt = null
      canInstall = false
      notify()
      return true
    }
  } catch {
    // Ignored
  }
  return false
}

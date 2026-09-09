export type DevicePlatform = {
  isAppleMobileOrTablet: boolean
  isAndroidMobileOrTablet: boolean
}

export function getDevicePlatform(): DevicePlatform {
  if (typeof navigator === 'undefined') {
    return { isAppleMobileOrTablet: false, isAndroidMobileOrTablet: false }
  }

  const userAgent = navigator.userAgent || ''
  const platform = navigator.platform || ''
  const maxTouchPoints = navigator.maxTouchPoints || 0
  const isIosPhone = /iPhone|iPod/i.test(userAgent)
  const isIpad = /iPad/i.test(userAgent) || (/Mac/i.test(platform) && maxTouchPoints > 1)

  return {
    isAppleMobileOrTablet: isIosPhone || isIpad,
    isAndroidMobileOrTablet: /Android/i.test(userAgent),
  }
}

import { cityNames, regionCodes, regionNameOverrides, provinceNames } from './locationData.js'

export { regionCodes } from './locationData.js'

export const provinces = Object.entries(provinceNames).map(([code, name]) => ({
  code,
  name,
  cities: Object.entries(cityNames)
    .filter(([city]) => city.startsWith(code.slice(0, 2)))
    .map(([code, name]) => ({ code, name })),
}))

export type UserLocation = {
  region: string
  province?: string
  city?: string
}

const regions = new Set(regionCodes)
type RegionDisplay = { of: (code: string) => string | undefined }
/*
 * Intl.DisplayNames 到 Chrome 81 才有；老 WebView（华为/Android 9 的 Chrome 69）
 * 在模块顶层 new 会直接抛 TypeError，整页白屏。这里做特性检测 + 回退到国家代码。
 */
const createRegionDisplay = (locale: 'zh-CN' | 'en-US'): RegionDisplay | null => {
  try {
    if (typeof Intl.DisplayNames !== 'function') {
      return null
    }
    return new Intl.DisplayNames([locale], { type: 'region' }) as RegionDisplay
  } catch {
    return null
  }
}
const regionNames = {
  'zh-CN': createRegionDisplay('zh-CN'),
  'en-US': createRegionDisplay('en-US'),
}

export const getRegionName = (code: string, locale: 'zh-CN' | 'en-US'): string =>
  regions.has(code)
    ? (regionNameOverrides[locale][code] ?? regionNames[locale]?.of(code) ?? code)
    : ''

export const normalizeLocation = (value: unknown): UserLocation | null => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return null
  }
  const location = value as Record<string, unknown>
  const { region, province, city } = location
  if (typeof region !== 'string' || !regions.has(region)) {
    return null
  }
  if (region !== 'CN') {
    return { region }
  }
  if (province === undefined) {
    return city === undefined ? { region } : null
  }
  const selectedProvince = provinces.find((item) => item.code === province)
  if (!selectedProvince) {
    return null
  }
  if (city === undefined) {
    return { region, province: selectedProvince.code }
  }
  const selectedCity = selectedProvince.cities.find((item) => item.code === city)
  return selectedCity ? { region, province: selectedProvince.code, city: selectedCity.code } : null
}

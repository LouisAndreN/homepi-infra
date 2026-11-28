import { useMemo } from 'react'
import { useFlux, FLUX } from './useInflux.js'
import { parseWeather, dayKinds } from '../energy/weather.js'

// Weather of the last `days` days. Up to 25 days: iot-hot only (720 h retention). Longer: iot-archives
// (one year, copied hourly) plus the last 3 days of iot-hot, so the current hour is never an hour late.
// fields: the hourly fields to read (the calendars only need the code: 4x fewer rows over a year).
export function useWeather(days, { fields = ['code', 'is_day', 'temp', 'precip', 'sun', 'dist_km'], interval = 15 * 60000 } = {}) {
  const long = days > 25
  const key = fields.join(',')
  const qHot = useMemo(() => FLUX.weather(`-${long ? 3 : days}d`, 'now()', fields), [days, long, key]) // eslint-disable-line react-hooks/exhaustive-deps
  const qArch = useMemo(() => long ? FLUX.weather(`-${days}d`, 'now()', fields, 'iot-archives') : null, [days, long, key]) // eslint-disable-line react-hooks/exhaustive-deps
  const hot = useFlux(qHot, interval)
  const arch = useFlux(qArch, 60 * 60000)
  return useMemo(() => {
    const { hours, sun } = parseWeather([...(arch.data || []), ...hot.data])
    return { hours, sun, kinds: dayKinds(hours), error: hot.error || (long && arch.error) || null, loading: hot.loading }
  }, [hot.data, arch.data, hot.error, arch.error, hot.loading, long])
}

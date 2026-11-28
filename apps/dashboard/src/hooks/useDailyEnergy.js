import { useMemo } from 'react'
import { useFlux, FLUX } from './useInflux.js'
import { dailyTotals, mergeDaily, levels, weekdayWeekend } from '../energy/calendar.js'

// Daily whole-home energy over a year: the last 30 days from the live readings (iot-hot), older days
// from the daily archive (iot-archives nilm_daily). Shared by the month and year calendars.
export const RETENTION_DAYS = 30
export function useDailyEnergy(legs) {
  const tz = Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC'
  const sums = useFlux(useMemo(() => FLUX.nilmDaily('sum', RETENTION_DAYS + 1, tz), [tz]), 30 * 60000)
  const counts = useFlux(useMemo(() => FLUX.nilmDaily('count', RETENTION_DAYS + 1, tz), [tz]), 30 * 60000)
  const archive = useFlux(useMemo(() => FLUX.nilmDailyArchive(372), []), 60 * 60000)
  const days = useMemo(() => {
    const m = mergeDaily(archive.data, sums.data, counts.data)
    return dailyTotals(m.sumRows, m.countRows, legs)
  }, [archive.data, sums.data, counts.data, legs])
  const byKey = useMemo(() => new Map(days.map(d => [d.key, d])), [days])
  const lv = useMemo(() => levels(days), [days])
  const ww = useMemo(() => weekdayWeekend(days), [days])
  const archiveSince = useMemo(() => {
    const t = archive.data.reduce((m, r) => { const v = Date.parse(r._time); return Number.isFinite(v) && v < m ? v : m }, Infinity)
    return Number.isFinite(t) ? t : null
  }, [archive.data])
  const error = sums.error || counts.error || archive.error || null
  return { days, byKey, lv, ww, archiveSince, error, loading: sums.loading || archive.loading }
}

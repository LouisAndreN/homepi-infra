// Contract cost (Japanese 従量電灯): tiers are MONTHLY kWh bands, plus a standing charge per day.
// Pure functions, unit-tested with node (tests/tariff.test.mjs).
const isNum = v => v != null && Number.isFinite(v)

// Cost of the energy between fromKwh and toKwh of the month (the marginal rate depends on where the month stands)
export function energyCost(fromKwh, toKwh, contract) {
  const el = contract?.utilities?.electricity
  if (!el?.enabled || !(toKwh > fromKwh)) return 0
  let c = 0
  for (const t of el.tiers || []) {
    const lo = Math.max(fromKwh, t.from || 0), hi = Math.min(toKwh, t.to ?? Infinity)
    if (hi > lo) c += (hi - lo) * t.ratePerKwh
  }
  return c
}

// One day: its energy priced on top of what the month already used, plus one day of standing charge
export function dayCost(kwh, monthBefore, contract) {
  const el = contract?.utilities?.electricity
  if (!el?.enabled || !isNum(kwh) || !isNum(monthBefore)) return null
  return energyCost(monthBefore, monthBefore + kwh, contract) + (el.standingChargePerDay || 0)
}

// A month (or the part of it so far): energy from 0 to kwh, and the standing charge of `days` days
export function monthCost(kwh, days, contract) {
  const el = contract?.utilities?.electricity
  if (!el?.enabled || !isNum(kwh)) return null
  const energy = energyCost(0, kwh, contract), standing = (el.standingChargePerDay || 0) * days
  return { energy, standing, total: energy + standing }
}

export function tierAt(kwh, contract) {
  const tiers = contract?.utilities?.electricity?.tiers || []
  return tiers.find(t => kwh >= (t.from || 0) && kwh < (t.to ?? Infinity)) || tiers.at(-1) || null
}

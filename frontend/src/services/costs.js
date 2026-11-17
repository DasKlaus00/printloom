/* Energie & Kosten aus der Farm-Statistik (seit v1.1.72, Kachel auf der Startseite).
   Alle Teile und die Summe kommen aus EINER Rechnung: Bis v1.1.71 floss die
   Maschinenzeit in die Summe, hatte aber keine eigene Kachel — die Kacheln ergaben
   zusammen nicht die Gesamtkosten.
   Die Preise kommen vom Server (services/farm_settings.py). Ohne geladene Einstellungen
   gibt es keine Rechnung (null) statt einer mit einem zweiten, geratenen Strompreis. */
const num = (v) => {
  const n = Number(v)
  return Number.isFinite(n) ? n : 0
}

export function costBreakdown(stats, cfg) {
  if (!stats || !cfg) return null
  const kwh = num(stats.total_kwh)
  const energy = kwh * num(cfg.power_price_eur_kwh)
  const machine = (num(stats.total_print_min) / 60) * num(cfg.machine_rate_eur_h)
  const material = (num(stats.total_filament_g) / 1000) * num(cfg.filament_price_eur_kg)
  return { kwh, grams: num(stats.total_filament_g), energy, machine, material, total: energy + machine + material }
}

/* Welcher Drucker fährt die Farm? Seit v1.1.87 kann das ein Snapmaker U1 sein — bis
   dahin suchte jede Seite „den ersten Bambu". Der Server entscheidet
   (GET /api/autofarm/farm-printer, nach der Zuordnung im Drucker-Tab; Typen in
   backend/app/services/printer_link.py, FARM_PRINTER_TYPES). Fällt die Frage aus,
   gilt ein Bambu vor dem U1 — so wie der Server es selbst ohne Zuordnung hält. */
import { autofarmService, deviceService } from './api'

export const FARM_PRINTER_TYPES = ['bambu_lab', 'moonraker']

export const isFarmPrinter = (d) => FARM_PRINTER_TYPES.includes(d?.device_type)

/** Aus der Geräteliste das Gerät der Farm (`farmId` vom Server), sonst Bambu, sonst U1. */
export function pickFarmPrinter(devices, farmId) {
  const list = (devices || []).filter(isFarmPrinter)
  return list.find(d => d.id === farmId)
    || list.find(d => d.device_type === 'bambu_lab')
    || list[0] || null
}

/** Geräteliste + Antwort des Servers → das Gerät der Farm (oder null). */
export async function loadFarmPrinter() {
  const [devs, fp] = await Promise.allSettled([deviceService.listDevices(),
                                               autofarmService.getFarmPrinter()])
  const list = devs.status === 'fulfilled' ? (devs.value.data ?? []) : []
  const id = fp.status === 'fulfilled' ? fp.value.data?.device_id : null
  return pickFarmPrinter(list, id)
}

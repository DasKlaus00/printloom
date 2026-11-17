/* Browser-Tab-Titel aus EINER Stelle (seit v1.1.68). Bis v1.1.67 setzten App.jsx und
   die Auto-Farm-Seite ihn beide; die versteckte Auto-Farm-Seite überschrieb ihn bei
   jeder Job-Änderung, auch während man auf einer anderen Seite war.
   farm = { running, progress, fileName } des gerade druckenden Jobs. */
export function tabTitle(pageTitle, farm) {
  if (farm?.running && farm.progress > 0 && farm.fileName) {
    const name = String(farm.fileName).replace(/\.(gcode\.3mf|3mf|gcode)$/i, '')
    return `[${Math.round(farm.progress)}%] ${name} — Printloom`
  }
  return pageTitle ? `${pageTitle} · Printloom` : 'Printloom'
}

/* Die einfachen Werte aus dem Farm-Status (Stream), die der Titel braucht. */
export function farmTitleState(status) {
  if (!status?.running) return { running: false, progress: 0, fileName: '' }
  const job = (status.jobs || []).find(j => j.id === status.current_job_id)
  return job?.status === 'printing'
    ? { running: true, progress: job.progress || 0, fileName: job.fileName || '' }
    : { running: true, progress: 0, fileName: '' }
}

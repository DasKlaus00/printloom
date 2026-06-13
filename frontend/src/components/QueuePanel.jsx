import React, { useState } from 'react'
import { queueService } from '../services/api'

const statusBadge = {
  pending:   'badge-amber',
  uploading: 'badge-blue',
  starting:  'badge-blue',
  printing:  'badge-blue',
  completed: 'badge-green',
  failed:    'badge-red',
  paused:    'badge-amber',
}

function QueuePanel({ queue, onRefresh }) {
  const [removing, setRemoving] = useState(null)

  const remove = async (jobId) => {
    setRemoving(jobId)
    try {
      await queueService.removeFromQueue(jobId)
      onRefresh()
    } catch (e) {
      console.error(e)
    } finally {
      setRemoving(null)
    }
  }

  if (queue.items.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-10 text-surface-600">
        <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" className="mb-2">
          <line x1="8" y1="6" x2="21" y2="6"/><line x1="8" y1="12" x2="21" y2="12"/>
          <line x1="8" y1="18" x2="21" y2="18"/><line x1="3" y1="6" x2="3.01" y2="6"/>
          <line x1="3" y1="12" x2="3.01" y2="12"/><line x1="3" y1="18" x2="3.01" y2="18"/>
        </svg>
        <p className="text-sm">Queue is empty</p>
      </div>
    )
  }

  return (
    <div className="space-y-2">
      {queue.items.map((item, idx) => (
        <div key={item.id} className="flex items-center justify-between px-4 py-3 rounded-lg bg-surface-900 border border-surface-700">
          <div className="flex items-center gap-3">
            <span className="text-xs font-mono text-surface-600 w-4">{idx + 1}</span>
            <div>
              <p className="text-sm font-medium text-surface-200">Job {item.job_id}</p>
              <p className="text-xs text-surface-500 mt-0.5 font-mono">{new Date(item.created_at).toLocaleTimeString()}</p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <span className={`badge ${statusBadge[item.status] ?? 'badge-gray'}`}>{item.status}</span>
            <button
              onClick={() => remove(item.job_id)}
              disabled={removing === item.job_id}
              className="btn-icon"
              title="Remove from queue"
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>
              </svg>
            </button>
          </div>
        </div>
      ))}
    </div>
  )
}

export default QueuePanel

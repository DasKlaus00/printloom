import React, { useState, useEffect } from 'react'
import { controlService } from '../services/api'

function ManualControls() {
  const [macros, setMacros] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [executing, setExecuting] = useState(null)
  const [lastResult, setLastResult] = useState(null)

  useEffect(() => {
    loadMacros()
  }, [])

  const loadMacros = async () => {
    try {
      const res = await controlService.listMacros()
      setMacros(res.data.macros)
      setError(null)
    } catch (err) {
      setError('Failed to load macros')
      console.error(err)
    } finally {
      setLoading(false)
    }
  }

  const executeMacro = async (macroName) => {
    setExecuting(macroName)
    try {
      const res = await controlService.executeMacro({ macro_name: macroName })
      setLastResult(res.data)
      setError(null)
    } catch (err) {
      setError('Failed to execute macro')
      console.error(err)
    } finally {
      setExecuting(null)
    }
  }

  const handleEmergencyStop = async () => {
    if (!confirm('EMERGENCY STOP - Are you sure? This will disable all devices.')) return

    try {
      await controlService.emergencyStop()
      setLastResult({ message: 'Emergency stop activated' })
      setError(null)
    } catch (err) {
      setError('Failed to trigger emergency stop')
    }
  }

  const handleResume = async () => {
    if (!confirm('Resume operations?')) return

    try {
      await controlService.resume()
      setLastResult({ message: 'Operations resumed' })
      setError(null)
    } catch (err) {
      setError('Failed to resume operations')
    }
  }

  const macroGroups = {
    'Rack Grab': macros.filter(m => m.startsWith('GRAB_FROM_SLOT')),
    'Rack Store': macros.filter(m => m.startsWith('STORE_TO_SLOT')),
    'Door Control': macros.filter(m => m.includes('DOOR')),
    'Plate Handling': macros.filter(m =>
      m.includes('EJECT') || m.includes('LOAD')
    ),
    'System': macros.filter(m =>
      m.includes('HOME') || m.includes('PARK') || m.includes('TEST')
    ),
  }

  if (loading) {
    return <div className="text-dark-400">Loading macros...</div>
  }

  return (
    <div className="space-y-6">
      {error && (
        <div className="bg-red-900 border border-red-700 text-red-200 px-4 py-3 rounded">
          {error}
        </div>
      )}

      {lastResult && (
        <div className={`border px-4 py-3 rounded ${
          lastResult.success === false || lastResult.message?.includes('failed')
            ? 'bg-red-900 border-red-700 text-red-200'
            : 'bg-green-900 border-green-700 text-green-200'
        }`}>
          <div className="font-bold">
            {lastResult.success === false || lastResult.message?.includes('failed') ? '✗' : '✓'} {' '}
            {lastResult.macro_name || 'Operation'}
          </div>
          <div className="text-sm mt-1">{lastResult.message || lastResult.message}</div>
        </div>
      )}

      {/* Emergency Controls */}
      <div className="card border-2 border-red-700">
        <h2 className="text-2xl font-bold mb-4 text-red-400">Emergency Controls</h2>
        <div className="flex gap-3">
          <button
            onClick={handleEmergencyStop}
            className="btn btn-danger flex-1"
          >
            🛑 EMERGENCY STOP
          </button>
          <button
            onClick={handleResume}
            className="btn btn-success flex-1"
          >
            ▶ Resume Operations
          </button>
        </div>
      </div>

      {/* Quick Actions - OTTOeject & Bambu */}
      <div className="grid grid-cols-2 gap-6">
        <div className="card border-2 border-blue-600">
          <h2 className="text-xl font-bold mb-4 text-blue-400">🤖 OTTOeject Test</h2>
          <div className="space-y-3">
            <button onClick={() => executeMacro('OTTOEJECT_HOME')} disabled={executing} className="btn btn-primary w-full">
              🏠 Home OTTOeject
            </button>
            <button onClick={() => executeMacro('PARK_OTTOEJECT')} disabled={executing} className="btn btn-primary w-full">
              🅿️ Park OTTOeject
            </button>
            <button onClick={() => executeMacro('TEST_STORAGE_RACK_CONFIGURATION')} disabled={executing} className="btn btn-secondary w-full">
              🧪 Test Rack Config
            </button>
          </div>
        </div>

        <div className="card border-2 border-green-600">
          <h2 className="text-xl font-bold mb-4 text-green-400">🖨️ Bambu Lab X1C</h2>
          <div className="space-y-3">
            <button onClick={() => executeMacro('OPEN_DOOR_BAMBU_X_ONE_C')} disabled={executing} className="btn btn-primary w-full">
              🚪 Open Door
            </button>
            <button onClick={() => executeMacro('CLOSE_DOOR_BAMBU_X_ONE_C')} disabled={executing} className="btn btn-primary w-full">
              🚪 Close Door
            </button>
            <button onClick={() => executeMacro('EJECT_FROM_BAMBULAB_X_ONE_C')} disabled={executing} className="btn btn-secondary w-full">
              📤 Eject Plate
            </button>
            <button onClick={() => executeMacro('LOAD_ONTO_BAMBULAB_X_ONE_C')} disabled={executing} className="btn btn-secondary w-full">
              📥 Load Plate
            </button>
          </div>
        </div>
      </div>

      {/* Macro Groups */}
      <div className="grid grid-cols-2 gap-6">
        {Object.entries(macroGroups).map(([group, groupMacros]) => (
          groupMacros.length > 0 && (
            <div key={group} className="card">
              <h3 className="text-xl font-bold mb-4 text-dark-50">{group}</h3>
              <div className="space-y-2">
                {groupMacros.map(macro => (
                  <button
                    key={macro}
                    onClick={() => executeMacro(macro)}
                    disabled={executing !== null}
                    className={`btn w-full text-left ${
                      executing === macro ? 'btn-secondary opacity-50' : 'btn-primary'
                    }`}
                  >
                    <div className="font-mono text-sm">
                      {executing === macro ? '⏳ ' : ''}
                      {macro.replace(/_/g, ' ')}
                    </div>
                  </button>
                ))}
              </div>
            </div>
          )
        ))}
      </div>

      {/* All Macros List */}
      <div className="card">
        <h2 className="text-2xl font-bold mb-4 text-dark-50">All Available Macros</h2>
        <div className="space-y-2 max-h-96 overflow-y-auto">
          {macros.map(macro => (
            <div key={macro} className="text-sm font-mono text-dark-400">
              {macro}
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}

export default ManualControls

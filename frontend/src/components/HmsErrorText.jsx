import React from 'react'

/* Rendert einen Farm-Fehlertext und macht einen enthaltenen Bambu-HMS-Code
   (Format XXXX_XXXX_XXXX_XXXX) zu einem klickbaren Link auf die Bambu-Wiki-Seite
   mit der genauen Beschreibung. Code wird mit Bindestrichen angezeigt. */

const WIKI = 'https://wiki.bambulab.com/en/x1/troubleshooting/hmscode/'
const RE   = /HMS\s+([0-9A-Fa-f]{4}_[0-9A-Fa-f]{4}_[0-9A-Fa-f]{4}_[0-9A-Fa-f]{4})/

export default function HmsErrorText({ text }) {
  if (!text) return null
  const m = text.match(RE)
  if (!m) return <>{text}</>
  const code = m[1]
  const i = text.indexOf(m[0])
  return (
    <>
      {text.slice(0, i)}HMS{' '}
      <a href={WIKI + code} target="_blank" rel="noopener noreferrer"
        className="underline font-mono hover:text-white" title={`Bambu-Wiki: ${code.replace(/_/g, '-')}`}>
        {code.replace(/_/g, '-')}
      </a>
      {text.slice(i + m[0].length)}
    </>
  )
}

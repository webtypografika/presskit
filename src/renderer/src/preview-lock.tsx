// Dev-only harness: renders the LicenseGate lock screens in a plain browser
// with a mocked window.api, so the states can be eyeballed without packaging
// the app or breaking a real connection. Serve with:
//   npx vite serve src/renderer --port 5199
// then open http://localhost:5199/preview-lock.html — NOT part of the build.
import { useState } from 'react'
import { createRoot } from 'react-dom/client'
import { LicenseGate } from './components/LicenseGate'

interface Scenario {
  storedUrl: string
  profiles: unknown[]
  status: Record<string, unknown>
}

const baseStatus = {
  active: false,
  plan: null,
  expiresAt: null,
  daysLeft: 0,
  isTrial: false,
  orgName: null,
  offline: false,
  fetchedAt: Date.now(),
}

const twoProfiles = [
  { id: 'default', name: 'TYPOGRAFIKA', color: '#f59e0b', presscalUrl: 'https://pro.presscal.com', email: 'info@typografika.gr' },
  { id: 'demo', name: 'Northside Demo', color: '#3b82f6', presscalUrl: 'https://eu.presscal.com', email: 'presscal.demo@gmail.com' },
]
const oneProfile = [twoProfiles[0]]

const SCENARIOS: Record<string, Scenario> = {
  'Fresh install (no server)': {
    storedUrl: '',
    profiles: oneProfile,
    status: { ...baseStatus, state: 'not_configured' },
  },
  'Not configured (stored server)': {
    storedUrl: 'https://pro.presscal.com',
    profiles: oneProfile,
    status: { ...baseStatus, state: 'not_configured' },
  },
  'Unauthorized (reconnect)': {
    storedUrl: 'https://pro.presscal.com',
    profiles: oneProfile,
    status: { ...baseStatus, state: 'unauthorized', orgName: 'My Print Shop' },
  },
  'Unauthorized + 2 profiles': {
    storedUrl: 'https://eu.presscal.com',
    profiles: [twoProfiles[1], twoProfiles[0]],
    status: { ...baseStatus, state: 'unauthorized', orgName: 'Trial – George Georgiadis' },
  },
  'Expired trial': {
    storedUrl: 'https://pro.presscal.com',
    profiles: oneProfile,
    status: { ...baseStatus, state: 'expired', plan: 'trial', isTrial: true, orgName: 'My Print Shop' },
  },
  'Offline (no cache)': {
    storedUrl: 'https://pro.presscal.com',
    profiles: oneProfile,
    status: { ...baseStatus, state: 'offline_no_cache' },
  },
}

function installMocks(s: Scenario): void {
  ;(window as any).api = {
    license: {
      get: async () => s.status,
      refresh: async () => s.status,
      onChanged: () => () => {},
    },
    settings: { get: async () => (s.storedUrl ? s.storedUrl : undefined) },
    profiles: {
      list: async () => s.profiles,
      active: async () => s.profiles[0],
      switch: async (id: string) => console.log('[preview] profiles.switch →', id),
    },
    shell: { openExternal: async (u: string) => console.log('[preview] openExternal →', u) },
  }
}

function Preview() {
  const names = Object.keys(SCENARIOS)
  const [name, setName] = useState(names[0])
  // Install synchronously before LicenseGate mounts (remounted via key below).
  installMocks(SCENARIOS[name])
  return (
    <>
      <div
        style={{
          position: 'fixed',
          top: 12,
          left: 12,
          zIndex: 99999,
          display: 'flex',
          flexDirection: 'column',
          gap: 6,
          background: '#0b1220',
          border: '1px solid #334155',
          borderRadius: 10,
          padding: 12,
          width: 230,
        }}
      >
        <div style={{ color: '#94a3b8', fontSize: 11, fontWeight: 700, textTransform: 'uppercase', letterSpacing: 0.5 }}>
          Lock screen preview
        </div>
        {names.map(n => (
          <button
            key={n}
            onClick={() => setName(n)}
            style={{
              textAlign: 'left',
              padding: '6px 10px',
              borderRadius: 6,
              fontSize: 12,
              cursor: 'pointer',
              border: '1px solid #334155',
              background: n === name ? '#134e4a' : 'transparent',
              color: '#e2e8f0',
            }}
          >
            {n}
          </button>
        ))}
        <div style={{ color: '#64748b', fontSize: 10, marginTop: 4 }}>
          Buttons log to console instead of acting.
        </div>
      </div>
      <LicenseGate key={name}>
        <div />
      </LicenseGate>
    </>
  )
}

createRoot(document.getElementById('root')!).render(<Preview />)

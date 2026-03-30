import { useEffect } from 'react'
import { AppLayout } from './components/layout/AppLayout'
import { useAppStore } from './stores/app-store'

export default function App() {
  const loadSettings = useAppStore(s => s.loadSettings)

  useEffect(() => {
    loadSettings()
  }, [loadSettings])

  return <AppLayout />
}

import { useEffect } from 'react'
import { AppLayout } from './components/layout/AppLayout'
import { useAppStore } from './stores/app-store'

export default function App() {
  const loadSettings = useAppStore(s => s.loadSettings)
  const selectFile = useAppStore(s => s.selectFile)
  const navigateTo = useAppStore(s => s.navigateTo)

  useEffect(() => {
    loadSettings()
  }, [loadSettings])

  // Listen for deep link attachments from PressCal
  useEffect(() => {
    const cleanup = window.api.deepLink.onOpenAttachment(({ tempPath, filename, mime }) => {
      const ext = '.' + filename.split('.').pop()
      const type = mime.startsWith('image/') ? 'jpg'
        : mime === 'application/pdf' ? 'pdf'
        : 'other'

      selectFile(null as any)
      setTimeout(() => {
        selectFile({
          name: filename,
          path: tempPath,
          size: 0,
          isDirectory: false,
          type,
          extension: ext,
          modified: new Date().toISOString()
        })
      }, 50)
    })

    return cleanup
  }, [selectFile])

  // Listen for folder navigation from PressCal
  useEffect(() => {
    const cleanup = window.api.deepLink.onNavigateToFolder(({ path, email }) => {
      navigateTo(path)
      if (email) {
        useAppStore.setState({ lastCustomerEmail: email })
      }
    })

    return cleanup
  }, [navigateTo])

  // Listen for pick-file mode from PressCal
  useEffect(() => {
    const cleanup = window.api.deepLink.onPickFileMode(({ quoteId, itemId }) => {
      useAppStore.setState({
        pickFileMode: { quoteId, itemId }
      })
    })

    return cleanup
  }, [])

  return <AppLayout />
}

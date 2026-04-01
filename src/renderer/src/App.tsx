import { useEffect } from 'react'
import { AppLayout } from './components/layout/AppLayout'
import { useAppStore } from './stores/app-store'

export default function App() {
  const loadSettings = useAppStore(s => s.loadSettings)
  const selectFile = useAppStore(s => s.selectFile)
  const navigateTo = useAppStore(s => s.navigateTo)

  useEffect(() => {
    loadSettings()
    // Build search index in background on startup
    window.api.search.buildIndex().then(r => {
      if (r.count > 0) console.log(`Search index: ${r.count} files in ${r.ms}ms`)
    }).catch(() => {})
  }, [loadSettings])

  // Tab keyboard shortcuts
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      // Escape closes fullscreen preview
      if (e.key === 'Escape' && useAppStore.getState().fullscreenPreview) {
        useAppStore.setState({ fullscreenPreview: false })
        return
      }
      if (e.ctrlKey && e.key === 't') {
        e.preventDefault()
        useAppStore.getState().addTab()
      }
      if (e.ctrlKey && e.key === 'w') {
        e.preventDefault()
        const { tabs, activeTabId, closeTab } = useAppStore.getState()
        if (tabs.length > 1) closeTab(activeTabId)
      }
      if (e.ctrlKey && e.key === 'Tab') {
        e.preventDefault()
        const { tabs, activeTabId, setActiveTab } = useAppStore.getState()
        const idx = tabs.findIndex(t => t.id === activeTabId)
        const nextIdx = e.shiftKey
          ? (idx - 1 + tabs.length) % tabs.length
          : (idx + 1) % tabs.length
        setActiveTab(tabs[nextIdx].id)
      }
      // File operations — only when not typing in an input
      const tag = (e.target as HTMLElement).tagName
      if (tag === 'INPUT' || tag === 'TEXTAREA') return
      if (e.key === ' ') {
        e.preventDefault()
        const { fullscreenPreview, selectedFile } = useAppStore.getState()
        if (fullscreenPreview) {
          useAppStore.setState({ fullscreenPreview: false })
        } else if (selectedFile && !selectedFile.isDirectory) {
          useAppStore.setState({ fullscreenPreview: true })
        }
      }
      if (e.ctrlKey && e.key === 'c') {
        e.preventDefault()
        useAppStore.getState().copyFiles()
      }
      if (e.ctrlKey && e.key === 'x') {
        e.preventDefault()
        useAppStore.getState().cutFiles()
      }
      if (e.ctrlKey && e.key === 'v') {
        e.preventDefault()
        useAppStore.getState().pasteFiles()
      }
      if (e.ctrlKey && e.key === 'a') {
        e.preventDefault()
        useAppStore.getState().selectAll()
      }
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [])

  // Listen for deep link attachments from PressCal
  useEffect(() => {
    const cleanup = window.api.deepLink.onOpenAttachment(({ tempPath, filename, mime, quoteId }) => {
      const ext = '.' + filename.split('.').pop()
      const type = mime.startsWith('image/') ? 'jpg'
        : mime === 'application/pdf' ? 'pdf'
        : 'other'

      useAppStore.setState({ attachmentQuoteId: quoteId || '' })

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

  // File system watcher — auto refresh when files change
  useEffect(() => {
    const cleanup = window.api.fs.onChanged((dirPath: string) => {
      const { currentPath, refreshDirectory } = useAppStore.getState()
      if (currentPath === dirPath) {
        refreshDirectory()
      }
    })
    return cleanup
  }, [])

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

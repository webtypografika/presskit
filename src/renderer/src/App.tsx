import { useEffect } from 'react'
import { AppLayout } from './components/layout/AppLayout'
import { useAppStore } from './stores/app-store'

export default function App() {
  const loadSettings = useAppStore(s => s.loadSettings)
  const selectFile = useAppStore(s => s.selectFile)
  const navigateTo = useAppStore(s => s.navigateTo)

  useEffect(() => {
    loadSettings()
    // Build search index in background after 3s delay (let UI load first)
    const timer = setTimeout(() => {
      window.api.search.buildIndex().then(r => {
        if (r.count > 0) console.log(`Search index: ${r.count} files in ${r.ms}ms`)
      }).catch(() => {})
    }, 3000)
    return () => clearTimeout(timer)
  }, [loadSettings])

  // Tab keyboard shortcuts
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      // Escape closes fullscreen preview
      if (e.key === 'Escape' && useAppStore.getState().fullscreenPreview) {
        useAppStore.setState({ fullscreenPreview: false })
        return
      }
      // Use e.code for shortcuts — works regardless of keyboard layout (EN/GR)
      if (e.ctrlKey && e.code === 'KeyT') {
        e.preventDefault()
        useAppStore.getState().addTab()
      }
      if (e.ctrlKey && e.code === 'KeyW') {
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
      if (e.code === 'Space') {
        e.preventDefault()
        const { fullscreenPreview, selectedFile } = useAppStore.getState()
        if (fullscreenPreview) {
          useAppStore.setState({ fullscreenPreview: false })
        } else if (selectedFile && !selectedFile.isDirectory) {
          useAppStore.setState({ fullscreenPreview: true })
        }
      }
      if (e.ctrlKey && e.code === 'KeyC') {
        e.preventDefault()
        useAppStore.getState().copyFiles()
      }
      if (e.ctrlKey && e.code === 'KeyX') {
        e.preventDefault()
        useAppStore.getState().cutFiles()
      }
      if (e.ctrlKey && e.code === 'KeyV') {
        e.preventDefault()
        useAppStore.getState().pasteFiles()
      }
      if (e.ctrlKey && e.code === 'KeyA') {
        e.preventDefault()
        useAppStore.getState().selectAll()
      }
      // P key — toggle pick on selected files
      if (e.code === 'KeyP' && !e.ctrlKey) {
        e.preventDefault()
        useAppStore.getState().togglePickSelected()
      }
      // Delete key — trash selected files
      if (e.key === 'Delete') {
        const { selectedFiles, selectedFile, clearSelection, refreshDirectory } = useAppStore.getState()
        const filesToDelete = selectedFiles.length > 0
          ? selectedFiles
          : selectedFile ? [selectedFile] : []
        if (filesToDelete.length === 0) return
        e.preventDefault()
        const names = filesToDelete.length === 1
          ? `"${filesToDelete[0].name}"`
          : `${filesToDelete.length} αρχεία`
        if (confirm(`Διαγραφή ${names};`)) {
          window.api.fs.trash(filesToDelete.map(f => f.path)).then((results: any[]) => {
            const failed = results.filter((r: any) => !r.ok)
            if (failed.length > 0) {
              alert(`Αποτυχία διαγραφής ${failed.length} αρχείων:\n${failed.map((f: any) => f.error).join('\n')}`)
            }
            // Small delay before refresh — let filesystem settle (Dropbox, indexer, etc.)
            clearSelection()
            setTimeout(() => refreshDirectory(), 200)
          })
        }
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

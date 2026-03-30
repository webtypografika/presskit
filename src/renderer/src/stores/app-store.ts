import { create } from 'zustand'
import type { FileEntry, FileMetadata, PreviewResult, PreflightReport } from '../lib/file-types'

export type ViewMode = 'grid' | 'list'
export type Source = 'local' | 'dropbox'
export type InspectorTab = 'metadata' | 'preflight' | 'presscal'

interface AppState {
  // Navigation
  currentPath: string
  pathHistory: string[]
  historyIndex: number
  source: Source

  // File browser
  files: FileEntry[]
  selectedFile: FileEntry | null
  viewMode: ViewMode
  thumbnailSize: number
  loading: boolean

  // Preview
  preview: PreviewResult | null
  previewLoading: boolean

  // Inspector
  metadata: FileMetadata | null
  preflight: PreflightReport | null
  inspectorTab: InspectorTab
  metadataLoading: boolean
  preflightLoading: boolean

  // Panel sizes
  sidebarWidth: number
  inspectorWidth: number

  // PressCal connection
  presscalConnected: boolean
  presscalOrgName: string

  // Dropbox connection
  dropboxConnected: boolean
  dropboxName: string

  // Actions
  loadSettings: () => Promise<void>
  navigateTo: (path: string) => Promise<void>
  navigateBack: () => void
  navigateForward: () => void
  navigateUp: () => void
  selectFile: (file: FileEntry | null) => void
  setViewMode: (mode: ViewMode) => void
  setThumbnailSize: (size: number) => void
  setSource: (source: Source) => void
  setInspectorTab: (tab: InspectorTab) => void
  setSidebarWidth: (width: number) => void
  setInspectorWidth: (width: number) => void
  refreshDirectory: () => Promise<void>
  runPreflight: () => Promise<void>
}

export const useAppStore = create<AppState>((set, get) => ({
  // Initial state
  currentPath: '',
  pathHistory: [],
  historyIndex: -1,
  source: 'local',
  files: [],
  selectedFile: null,
  viewMode: 'grid',
  thumbnailSize: 128,
  loading: false,
  preview: null,
  previewLoading: false,
  metadata: null,
  preflight: null,
  inspectorTab: 'metadata',
  metadataLoading: false,
  preflightLoading: false,
  sidebarWidth: 280,
  inspectorWidth: 320,
  presscalConnected: false,
  presscalOrgName: '',
  dropboxConnected: false,
  dropboxName: '',

  loadSettings: async () => {
    try {
      const settings = await window.api.settings.getAll()
      const drives = await window.api.fs.getDrives()
      const defaultPath = drives[0] || 'C:\\'

      // Check connections
      const [presscalStatus, dropboxStatus] = await Promise.all([
        window.api.presscal.status().catch(() => ({ connected: false })),
        window.api.dropbox.status().catch(() => ({ connected: false }))
      ])

      set({
        viewMode: (settings['ui.viewMode'] as ViewMode) || 'grid',
        thumbnailSize: (settings['ui.thumbnailSize'] as number) || 128,
        sidebarWidth: (settings['ui.sidebarWidth'] as number) || 280,
        inspectorWidth: (settings['ui.inspectorWidth'] as number) || 320,
        presscalConnected: presscalStatus.connected,
        presscalOrgName: (presscalStatus as any).orgName || '',
        dropboxConnected: dropboxStatus.connected,
        dropboxName: (dropboxStatus as any).name || ''
      })

      // Navigate to recent or default path
      const recent = (settings['paths.recent'] as string[]) || []
      const startPath = recent[0] || defaultPath
      await get().navigateTo(startPath)
    } catch (err) {
      console.error('loadSettings error:', err)
      // Navigate to default
      try {
        const drives = await window.api.fs.getDrives()
        await get().navigateTo(drives[0] || 'C:\\')
      } catch {
        // Last resort
        await get().navigateTo('C:\\')
      }
    }
  },

  navigateTo: async (path: string) => {
    const { source, currentPath, pathHistory, historyIndex } = get()
    set({ loading: true, selectedFile: null, preview: null, metadata: null, preflight: null })

    try {
      let files: FileEntry[]
      if (source === 'local') {
        files = await window.api.fs.listDirectory(path)
        window.api.settings.addRecentPath(path)
      } else {
        const entries = await window.api.dropbox.listFolder(path)
        files = entries.map((e: any) => ({
          name: e.name,
          path: e.path,
          isDirectory: e.isDirectory,
          size: e.size,
          modified: e.modified || '',
          created: '',
          extension: e.isDirectory ? '' : ('.' + e.name.split('.').pop()?.toLowerCase()),
          type: e.isDirectory ? 'folder' : 'unknown'
        }))
      }

      // Update history
      const newHistory = pathHistory.slice(0, historyIndex + 1)
      if (currentPath !== path) {
        newHistory.push(path)
      }

      set({
        currentPath: path,
        files,
        loading: false,
        pathHistory: newHistory,
        historyIndex: newHistory.length - 1
      })
    } catch {
      set({ files: [], loading: false })
    }
  },

  navigateBack: () => {
    const { pathHistory, historyIndex } = get()
    if (historyIndex > 0) {
      const prevPath = pathHistory[historyIndex - 1]
      set({ historyIndex: historyIndex - 1 })
      get().navigateTo(prevPath)
    }
  },

  navigateForward: () => {
    const { pathHistory, historyIndex } = get()
    if (historyIndex < pathHistory.length - 1) {
      const nextPath = pathHistory[historyIndex + 1]
      set({ historyIndex: historyIndex + 1 })
      get().navigateTo(nextPath)
    }
  },

  navigateUp: () => {
    const { currentPath, source } = get()
    if (source === 'local') {
      const parts = currentPath.replace(/\\/g, '/').split('/')
      parts.pop()
      const parent = parts.join('/') || parts[0] + '/'
      if (parent !== currentPath) {
        get().navigateTo(parent)
      }
    } else {
      const parts = currentPath.split('/')
      parts.pop()
      get().navigateTo(parts.join('/') || '')
    }
  },

  selectFile: (file) => {
    if (!file || file.isDirectory) {
      set({ selectedFile: file, preview: null, metadata: null, preflight: null })
      return
    }

    set({ selectedFile: file, preview: null, metadata: null, preflight: null, previewLoading: true, metadataLoading: true })

    // Load preview and metadata in parallel
    window.api.preview.full(file.path)
      .then(preview => set({ preview, previewLoading: false }))
      .catch(() => set({ previewLoading: false }))

    window.api.fs.getMetadata(file.path)
      .then(metadata => set({ metadata, metadataLoading: false }))
      .catch(() => set({ metadataLoading: false }))
  },

  setViewMode: (mode) => {
    set({ viewMode: mode })
    window.api.settings.set('ui.viewMode', mode)
  },

  setThumbnailSize: (size) => {
    set({ thumbnailSize: size })
    window.api.settings.set('ui.thumbnailSize', size)
  },

  setSource: (source) => {
    set({ source, currentPath: '', files: [], selectedFile: null })
    if (source === 'dropbox') {
      get().navigateTo('')
    } else {
      window.api.fs.getDrives().then(drives => get().navigateTo(drives[0] || 'C:\\'))
    }
  },

  setInspectorTab: (tab) => set({ inspectorTab: tab }),

  setSidebarWidth: (width) => {
    set({ sidebarWidth: width })
    window.api.settings.set('ui.sidebarWidth', width)
  },

  setInspectorWidth: (width) => {
    set({ inspectorWidth: width })
    window.api.settings.set('ui.inspectorWidth', width)
  },

  refreshDirectory: async () => {
    const { currentPath } = get()
    await get().navigateTo(currentPath)
  },

  runPreflight: async () => {
    const { selectedFile } = get()
    if (!selectedFile || selectedFile.isDirectory) return

    set({ preflightLoading: true, inspectorTab: 'preflight' })
    try {
      const report = await window.api.preflight.run(selectedFile.path)
      set({ preflight: report, preflightLoading: false })
    } catch {
      set({ preflightLoading: false })
    }
  }
}))

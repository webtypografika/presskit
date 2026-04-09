import { useCallback, useRef } from 'react'
import { createPortal } from 'react-dom'
import { useAppStore } from '@/stores/app-store'
import { Toolbar } from './Toolbar'
import { Sidebar } from './Sidebar'
import { StatusBar } from './StatusBar'
import { FullscreenPreview } from '../preview/FullscreenPreview'
import { PreviewPanel } from '../preview/PreviewPanel'
import { InspectorPanel } from '../inspector/InspectorPanel'
import { TabBar } from './TabBar'

export function AppLayout() {
  const sidebarWidth = useAppStore(s => s.sidebarWidth)
  const inspectorWidth = useAppStore(s => s.inspectorWidth)
  const setSidebarWidth = useAppStore(s => s.setSidebarWidth)
  const setInspectorWidth = useAppStore(s => s.setInspectorWidth)
  const selectedFile = useAppStore(s => s.selectedFile)
  const showSidebar = useAppStore(s => s.showSidebar)
  const showInspector = useAppStore(s => s.showInspector)

  const resizingRef = useRef<'sidebar' | 'inspector' | null>(null)

  const onMouseDown = useCallback((panel: 'sidebar' | 'inspector') => {
    resizingRef.current = panel

    const onMouseMove = (e: MouseEvent) => {
      if (resizingRef.current === 'sidebar') {
        const newWidth = Math.max(200, Math.min(500, e.clientX))
        setSidebarWidth(newWidth)
      } else if (resizingRef.current === 'inspector') {
        const newWidth = Math.max(320, Math.min(500, window.innerWidth - e.clientX))
        setInspectorWidth(newWidth)
      }
    }

    const onMouseUp = () => {
      resizingRef.current = null
      document.removeEventListener('mousemove', onMouseMove)
      document.removeEventListener('mouseup', onMouseUp)
      document.body.style.cursor = ''
      document.body.style.userSelect = ''
    }

    document.addEventListener('mousemove', onMouseMove)
    document.addEventListener('mouseup', onMouseUp)
    document.body.style.cursor = 'col-resize'
    document.body.style.userSelect = 'none'
  }, [setSidebarWidth, setInspectorWidth])

  return (
    <div className="h-full flex flex-col bg-bg-secondary relative">
      {/* Tab bar (also serves as titlebar drag region) */}
      <TabBar />

      {/* Toolbar area with horizontal padding */}
      <div style={{ padding: '0 12px' }}>
        <Toolbar />
      </div>

      {/* Main content area — sidebar & inspector go edge to edge */}
      <div className="flex-1 flex overflow-hidden">
        {/* Sidebar */}
        {showSidebar && (
          <>
            <div style={{ width: sidebarWidth }} className="flex-shrink-0 overflow-hidden border-r border-border">
              <Sidebar />
            </div>
            <div
              className="resizer"
              onMouseDown={() => onMouseDown('sidebar')}
            />
          </>
        )}

        {/* Preview panel - takes remaining space */}
        <div className="flex-1 overflow-hidden">
          <PreviewPanel />
        </div>

        {/* Inspector */}
        {showInspector && (
          <>
            <div
              className="resizer"
              onMouseDown={() => onMouseDown('inspector')}
            />
            <div style={{ width: inspectorWidth, minWidth: 360 }} className="flex-shrink-0 overflow-hidden border-l border-border">
              <InspectorPanel />
            </div>
          </>
        )}
      </div>

      {/* Status bar */}
      <StatusBar />

      {/* Fullscreen preview */}
      <FullscreenPreview />
    </div>
  )
}

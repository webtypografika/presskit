import { useCallback, useRef, useState } from 'react'
import { useAppStore } from '@/stores/app-store'
import { Toolbar } from './Toolbar'
import { Sidebar } from './Sidebar'
import { StatusBar } from './StatusBar'
import { PreviewPanel } from '../preview/PreviewPanel'
import { InspectorPanel } from '../inspector/InspectorPanel'
import { PanelRight, PanelLeft } from 'lucide-react'

export function AppLayout() {
  const sidebarWidth = useAppStore(s => s.sidebarWidth)
  const inspectorWidth = useAppStore(s => s.inspectorWidth)
  const setSidebarWidth = useAppStore(s => s.setSidebarWidth)
  const setInspectorWidth = useAppStore(s => s.setInspectorWidth)
  const selectedFile = useAppStore(s => s.selectedFile)

  const [showSidebar, setShowSidebar] = useState(true)
  const [showInspector, setShowInspector] = useState(true)

  const resizingRef = useRef<'sidebar' | 'inspector' | null>(null)

  const onMouseDown = useCallback((panel: 'sidebar' | 'inspector') => {
    resizingRef.current = panel

    const onMouseMove = (e: MouseEvent) => {
      if (resizingRef.current === 'sidebar') {
        const newWidth = Math.max(200, Math.min(500, e.clientX))
        setSidebarWidth(newWidth)
      } else if (resizingRef.current === 'inspector') {
        const newWidth = Math.max(250, Math.min(500, window.innerWidth - e.clientX))
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

  const hasInspector = selectedFile && !selectedFile.isDirectory

  return (
    <div className="h-full flex flex-col bg-bg-primary relative">
      {/* Title bar drag region */}
      <div className="titlebar-drag h-[36px] flex-shrink-0" />

      {/* Everything below titlebar gets inset padding from window edges */}
      <div className="flex-1 flex flex-col overflow-hidden" style={{ padding: 12 }}>
        {/* Toolbar */}
        <div className="flex items-center" style={{ gap: 8 }}>
          {/* Sidebar toggle */}
          <button
            onClick={() => setShowSidebar(!showSidebar)}
            title={showSidebar ? 'Hide sidebar' : 'Show sidebar'}
            style={{
              padding: '8px 10px', borderRadius: 8, border: 'none', cursor: 'pointer',
              background: showSidebar ? 'rgba(245,130,32,0.1)' : 'transparent',
              color: showSidebar ? '#f58220' : '#64748b',
              flexShrink: 0,
            }}
          >
            <PanelLeft size={18} />
          </button>

          <div className="flex-1 overflow-hidden">
            <Toolbar />
          </div>

          {/* Inspector toggle */}
          <button
            onClick={() => setShowInspector(!showInspector)}
            title={showInspector ? 'Hide inspector' : 'Show inspector'}
            style={{
              padding: '8px 10px', borderRadius: 8, border: 'none', cursor: 'pointer',
              background: showInspector ? 'rgba(245,130,32,0.1)' : 'transparent',
              color: showInspector ? '#f58220' : '#64748b',
              flexShrink: 0,
            }}
          >
            <PanelRight size={18} />
          </button>
        </div>

        {/* Main content area */}
        <div className="flex-1 flex overflow-hidden mt-2 rounded-lg">
          {/* Sidebar / File Browser */}
          {showSidebar && (
            <>
              <div style={{ width: sidebarWidth }} className="flex-shrink-0 overflow-hidden rounded-l-lg">
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

          {/* Inspector — always available for PressCal tab */}
          {showInspector && (
            <>
              <div
                className="resizer"
                onMouseDown={() => onMouseDown('inspector')}
              />
              <div style={{ width: inspectorWidth }} className="flex-shrink-0 overflow-hidden rounded-r-lg">
                <InspectorPanel />
              </div>
            </>
          )}
        </div>

        {/* Status bar */}
        <div className="mt-2">
          <StatusBar />
        </div>
      </div>
    </div>
  )
}

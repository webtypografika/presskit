import { useCallback, useRef } from 'react'
import { useAppStore } from '@/stores/app-store'
import { Toolbar } from './Toolbar'
import { Sidebar } from './Sidebar'
import { StatusBar } from './StatusBar'
import { PreviewPanel } from '../preview/PreviewPanel'
import { InspectorPanel } from '../inspector/InspectorPanel'

export function AppLayout() {
  const sidebarWidth = useAppStore(s => s.sidebarWidth)
  const inspectorWidth = useAppStore(s => s.inspectorWidth)
  const setSidebarWidth = useAppStore(s => s.setSidebarWidth)
  const setInspectorWidth = useAppStore(s => s.setInspectorWidth)
  const selectedFile = useAppStore(s => s.selectedFile)

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

  return (
    <div className="h-full flex flex-col bg-bg-primary relative">
      {/* Title bar drag region */}
      <div className="titlebar-drag h-[36px] flex-shrink-0" />

      {/* Toolbar */}
      <Toolbar />

      {/* Main content area */}
      <div className="flex-1 flex overflow-hidden">
        {/* Sidebar / File Browser */}
        <div style={{ width: sidebarWidth }} className="flex-shrink-0 overflow-hidden">
          <Sidebar />
        </div>

        {/* Sidebar resizer */}
        <div
          className="resizer"
          onMouseDown={() => onMouseDown('sidebar')}
        />

        {/* Preview panel - takes remaining space */}
        <div className="flex-1 overflow-hidden">
          <PreviewPanel />
        </div>

        {/* Inspector resizer */}
        {selectedFile && !selectedFile.isDirectory && (
          <>
            <div
              className="resizer"
              onMouseDown={() => onMouseDown('inspector')}
            />
            {/* Inspector panel */}
            <div style={{ width: inspectorWidth }} className="flex-shrink-0 overflow-hidden">
              <InspectorPanel />
            </div>
          </>
        )}
      </div>

      {/* Status bar */}
      <StatusBar />
    </div>
  )
}

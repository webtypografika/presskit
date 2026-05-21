import { useState, useEffect, useRef, useCallback } from 'react'
import { useAppStore } from '@/stores/app-store'
import {
  MousePointer2, Circle, Square, Type, Pencil, ArrowUpRight,
  Trash2, Save, Undo2, Palette
} from 'lucide-react'

interface Annotation {
  id: string
  type: 'arrow' | 'circle' | 'rect' | 'text' | 'freehand'
  x: number; y: number
  x2?: number; y2?: number
  width?: number; height?: number
  text?: string
  color: string
  strokeWidth: number
  points?: { x: number; y: number }[]
  timestamp: string
  author?: string
}

type Tool = 'select' | 'arrow' | 'circle' | 'rect' | 'text' | 'freehand'

const COLORS = ['#ef4444', '#f59e0b', '#22c55e', '#3b82f6', '#a855f7', '#ec4899', '#ffffff', '#000000']

export function AnnotationOverlay({ previewWidth, previewHeight }: { previewWidth: number; previewHeight: number }) {
  const { selectedFile } = useAppStore()
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const [annotations, setAnnotations] = useState<Annotation[]>([])
  const [tool, setTool] = useState<Tool>('arrow')
  const [color, setColor] = useState('#ef4444')
  const [strokeWidth, setStrokeWidth] = useState(3)
  const [drawing, setDrawing] = useState(false)
  const [startPos, setStartPos] = useState<{ x: number; y: number } | null>(null)
  const [currentPoints, setCurrentPoints] = useState<{ x: number; y: number }[]>([])
  const [hasChanges, setHasChanges] = useState(false)
  const [textInput, setTextInput] = useState<{ x: number; y: number } | null>(null)
  const [textValue, setTextValue] = useState('')

  // Load annotations
  useEffect(() => {
    if (!selectedFile?.path) return
    window.api.tools.loadAnnotations(selectedFile.path)
      .then(result => {
        setAnnotations(result.annotations || [])
        setHasChanges(false)
      })
      .catch(() => setAnnotations([]))
  }, [selectedFile?.path])

  // Redraw
  useEffect(() => {
    drawAnnotations()
  }, [annotations, previewWidth, previewHeight])

  const drawAnnotations = useCallback(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const ctx = canvas.getContext('2d')!

    canvas.width = previewWidth
    canvas.height = previewHeight
    ctx.clearRect(0, 0, canvas.width, canvas.height)

    for (const anno of annotations) {
      ctx.strokeStyle = anno.color
      ctx.fillStyle = anno.color
      ctx.lineWidth = anno.strokeWidth
      ctx.lineCap = 'round'
      ctx.lineJoin = 'round'

      switch (anno.type) {
        case 'arrow':
          if (anno.x2 !== undefined && anno.y2 !== undefined) {
            ctx.beginPath()
            ctx.moveTo(anno.x, anno.y)
            ctx.lineTo(anno.x2, anno.y2)
            ctx.stroke()
            // Arrowhead
            const angle = Math.atan2(anno.y2 - anno.y, anno.x2 - anno.x)
            const headLen = 12
            ctx.beginPath()
            ctx.moveTo(anno.x2, anno.y2)
            ctx.lineTo(anno.x2 - headLen * Math.cos(angle - 0.5), anno.y2 - headLen * Math.sin(angle - 0.5))
            ctx.lineTo(anno.x2 - headLen * Math.cos(angle + 0.5), anno.y2 - headLen * Math.sin(angle + 0.5))
            ctx.closePath()
            ctx.fill()
          }
          break
        case 'circle':
          if (anno.x2 !== undefined && anno.y2 !== undefined) {
            const rx = Math.abs(anno.x2 - anno.x) / 2
            const ry = Math.abs(anno.y2 - anno.y) / 2
            const cx = (anno.x + anno.x2) / 2
            const cy = (anno.y + anno.y2) / 2
            ctx.beginPath()
            ctx.ellipse(cx, cy, rx, ry, 0, 0, Math.PI * 2)
            ctx.stroke()
          }
          break
        case 'rect':
          if (anno.x2 !== undefined && anno.y2 !== undefined) {
            ctx.strokeRect(anno.x, anno.y, anno.x2 - anno.x, anno.y2 - anno.y)
          }
          break
        case 'text':
          ctx.font = `bold ${Math.max(14, anno.strokeWidth * 5)}px "DM Sans", sans-serif`
          ctx.fillText(anno.text || '', anno.x, anno.y)
          break
        case 'freehand':
          if (anno.points && anno.points.length > 1) {
            ctx.beginPath()
            ctx.moveTo(anno.points[0].x, anno.points[0].y)
            for (let i = 1; i < anno.points.length; i++) {
              ctx.lineTo(anno.points[i].x, anno.points[i].y)
            }
            ctx.stroke()
          }
          break
      }
    }
  }, [annotations, previewWidth, previewHeight])

  const getPos = (e: React.MouseEvent): { x: number; y: number } => {
    const rect = canvasRef.current!.getBoundingClientRect()
    return {
      x: ((e.clientX - rect.left) / rect.width) * previewWidth,
      y: ((e.clientY - rect.top) / rect.height) * previewHeight,
    }
  }

  const handleMouseDown = (e: React.MouseEvent) => {
    if (tool === 'select') return
    if (tool === 'text') {
      const pos = getPos(e)
      setTextInput(pos)
      setTextValue('')
      return
    }

    const pos = getPos(e)
    setDrawing(true)
    setStartPos(pos)
    if (tool === 'freehand') {
      setCurrentPoints([pos])
    }
  }

  const handleMouseMove = (e: React.MouseEvent) => {
    if (!drawing || !startPos) return
    const pos = getPos(e)

    if (tool === 'freehand') {
      setCurrentPoints(prev => [...prev, pos])
    }

    // Draw preview
    drawAnnotations()
    const ctx = canvasRef.current?.getContext('2d')
    if (!ctx) return
    ctx.strokeStyle = color
    ctx.fillStyle = color
    ctx.lineWidth = strokeWidth
    ctx.lineCap = 'round'
    ctx.setLineDash([5, 5])

    if (tool === 'arrow') {
      ctx.beginPath()
      ctx.moveTo(startPos.x, startPos.y)
      ctx.lineTo(pos.x, pos.y)
      ctx.stroke()
    } else if (tool === 'circle') {
      const rx = Math.abs(pos.x - startPos.x) / 2
      const ry = Math.abs(pos.y - startPos.y) / 2
      ctx.beginPath()
      ctx.ellipse((startPos.x + pos.x) / 2, (startPos.y + pos.y) / 2, rx, ry, 0, 0, Math.PI * 2)
      ctx.stroke()
    } else if (tool === 'rect') {
      ctx.strokeRect(startPos.x, startPos.y, pos.x - startPos.x, pos.y - startPos.y)
    } else if (tool === 'freehand') {
      ctx.setLineDash([])
      ctx.beginPath()
      const pts = currentPoints
      if (pts.length > 0) {
        ctx.moveTo(pts[0].x, pts[0].y)
        for (const p of pts) ctx.lineTo(p.x, p.y)
      }
      ctx.stroke()
    }
    ctx.setLineDash([])
  }

  const handleMouseUp = (e: React.MouseEvent) => {
    if (!drawing || !startPos) return
    setDrawing(false)

    const pos = getPos(e)
    const id = crypto.randomUUID()
    const timestamp = new Date().toISOString()

    let newAnno: Annotation | null = null

    if (tool === 'freehand' && currentPoints.length > 2) {
      newAnno = { id, type: 'freehand', x: 0, y: 0, color, strokeWidth, points: currentPoints, timestamp }
    } else if (['arrow', 'circle', 'rect'].includes(tool)) {
      const dx = Math.abs(pos.x - startPos.x)
      const dy = Math.abs(pos.y - startPos.y)
      if (dx > 5 || dy > 5) {
        newAnno = { id, type: tool as any, x: startPos.x, y: startPos.y, x2: pos.x, y2: pos.y, color, strokeWidth, timestamp }
      }
    }

    if (newAnno) {
      setAnnotations(prev => [...prev, newAnno!])
      setHasChanges(true)
    }

    setStartPos(null)
    setCurrentPoints([])
  }

  const addTextAnnotation = () => {
    if (!textInput || !textValue.trim()) {
      setTextInput(null)
      return
    }
    const newAnno: Annotation = {
      id: crypto.randomUUID(),
      type: 'text', x: textInput.x, y: textInput.y,
      text: textValue.trim(), color, strokeWidth,
      timestamp: new Date().toISOString(),
    }
    setAnnotations(prev => [...prev, newAnno])
    setHasChanges(true)
    setTextInput(null)
    setTextValue('')
  }

  const undo = () => {
    setAnnotations(prev => prev.slice(0, -1))
    setHasChanges(true)
  }

  const clearAll = () => {
    setAnnotations([])
    setHasChanges(true)
  }

  const save = async () => {
    if (!selectedFile?.path) return
    await window.api.tools.saveAnnotations(selectedFile.path, annotations)
    setHasChanges(false)
  }

  const toolBtn = (t: Tool, icon: React.ReactNode, label: string) => (
    <button
      onClick={() => setTool(t)}
      title={label}
      style={{
        padding: 6, borderRadius: 6, border: 'none', cursor: 'pointer',
        background: tool === t ? 'rgba(110,200,200,0.2)' : 'transparent',
        color: tool === t ? 'var(--th-accent)' : '#94a3b8',
      }}
    >
      {icon}
    </button>
  )

  return (
    <div style={{ position: 'relative', width: '100%', height: '100%' }}>
      {/* Canvas overlay */}
      <canvas
        ref={canvasRef}
        onMouseDown={handleMouseDown}
        onMouseMove={handleMouseMove}
        onMouseUp={handleMouseUp}
        style={{
          position: 'absolute', inset: 0, width: '100%', height: '100%',
          cursor: tool === 'select' ? 'default' : tool === 'text' ? 'text' : 'crosshair',
          zIndex: 10,
        }}
      />

      {/* Text input popup */}
      {textInput && (
        <div style={{
          position: 'absolute',
          left: (textInput.x / previewWidth) * 100 + '%',
          top: (textInput.y / previewHeight) * 100 + '%',
          zIndex: 20,
        }}>
          <input
            autoFocus
            value={textValue}
            onChange={e => setTextValue(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter') addTextAnnotation(); if (e.key === 'Escape') setTextInput(null) }}
            onBlur={addTextAnnotation}
            placeholder="Κείμενο..."
            style={{
              padding: '4px 8px', borderRadius: 4, fontSize: 14,
              background: 'rgba(0,0,0,0.8)', border: `2px solid ${color}`,
              color: color, outline: 'none', minWidth: 120,
            }}
          />
        </div>
      )}

      {/* Toolbar */}
      <div style={{
        position: 'absolute', bottom: 8, left: '50%', transform: 'translateX(-50%)',
        display: 'flex', alignItems: 'center', gap: 4, padding: '4px 8px',
        background: 'rgba(10,14,26,0.9)', borderRadius: 10,
        border: '1px solid rgba(255,255,255,0.1)', zIndex: 20,
        backdropFilter: 'blur(10px)',
      }}>
        {toolBtn('select', <MousePointer2 size={16} />, 'Select')}
        {toolBtn('arrow', <ArrowUpRight size={16} />, 'Arrow')}
        {toolBtn('circle', <Circle size={16} />, 'Circle')}
        {toolBtn('rect', <Square size={16} />, 'Rectangle')}
        {toolBtn('text', <Type size={16} />, 'Text')}
        {toolBtn('freehand', <Pencil size={16} />, 'Freehand')}

        <div style={{ width: 1, height: 20, background: 'rgba(255,255,255,0.1)', margin: '0 4px' }} />

        {/* Colors */}
        {COLORS.map(c => (
          <button
            key={c}
            onClick={() => setColor(c)}
            style={{
              width: 16, height: 16, borderRadius: '50%', border: color === c ? '2px solid var(--th-accent)' : '1px solid rgba(255,255,255,0.2)',
              background: c, cursor: 'pointer', padding: 0, flexShrink: 0,
            }}
          />
        ))}

        <div style={{ width: 1, height: 20, background: 'rgba(255,255,255,0.1)', margin: '0 4px' }} />

        {/* Stroke width */}
        <input
          type="range" min={1} max={8} value={strokeWidth}
          onChange={e => setStrokeWidth(Number(e.target.value))}
          style={{ width: 50, accentColor: 'var(--th-accent)' }}
        />

        <div style={{ width: 1, height: 20, background: 'rgba(255,255,255,0.1)', margin: '0 4px' }} />

        <button onClick={undo} title="Undo" disabled={annotations.length === 0}
          style={{ padding: 6, borderRadius: 6, border: 'none', cursor: 'pointer', background: 'transparent', color: annotations.length > 0 ? '#94a3b8' : '#334155' }}>
          <Undo2 size={16} />
        </button>
        <button onClick={clearAll} title="Clear all" disabled={annotations.length === 0}
          style={{ padding: 6, borderRadius: 6, border: 'none', cursor: 'pointer', background: 'transparent', color: annotations.length > 0 ? '#ef4444' : '#334155' }}>
          <Trash2 size={16} />
        </button>
        {hasChanges && (
          <button onClick={save} title="Save annotations"
            style={{ padding: '4px 10px', borderRadius: 6, border: 'none', cursor: 'pointer', background: 'var(--th-accent)', color: '#fff', fontSize: 11, fontWeight: 600 }}>
            <Save size={12} />
          </button>
        )}

        {annotations.length > 0 && (
          <span style={{ fontSize: 10, color: '#64748b', marginLeft: 4 }}>{annotations.length}</span>
        )}
      </div>
    </div>
  )
}

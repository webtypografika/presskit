import { useMemo } from 'react'
import type { FileMetadata } from '@/lib/file-types'

interface BleedOverlayProps {
  metadata: FileMetadata | null
  containerWidth: number
  containerHeight: number
  canvasWidth: number
  canvasHeight: number
  visible: boolean
}

/**
 * Draws TrimBox / BleedBox / SafeZone overlay on top of PDF preview.
 * Shows visual guides for bleed, trim, and safe area.
 */
export function BleedOverlay({ metadata, containerWidth, containerHeight, canvasWidth, canvasHeight, visible }: BleedOverlayProps) {
  if (!visible || !metadata) return null

  const { trimBox, bleedBox, mediaBox } = metadata
  if (!mediaBox) return null

  // Calculate scaling: media box → canvas pixels
  const mediaW = mediaBox.width // mm
  const mediaH = mediaBox.height // mm

  if (!mediaW || !mediaH) return null

  // Scale factor from media dimensions to display pixels
  const scaleX = canvasWidth / mediaW
  const scaleY = canvasHeight / mediaH

  const SAFE_ZONE_MM = 5 // 5mm inside trim

  // Calculate overlay positions
  const overlays = useMemo(() => {
    const result: {
      trimRect?: { x: number; y: number; w: number; h: number }
      bleedRect?: { x: number; y: number; w: number; h: number }
      safeRect?: { x: number; y: number; w: number; h: number }
      bleedAmounts?: { left: number; right: number; top: number; bottom: number }
    } = {}

    if (trimBox) {
      // TrimBox position relative to MediaBox
      // Assume TrimBox is centered or offset from MediaBox
      const trimW = trimBox.width
      const trimH = trimBox.height
      const trimX = (mediaW - trimW) / 2
      const trimY = (mediaH - trimH) / 2

      result.trimRect = {
        x: trimX * scaleX, y: trimY * scaleY,
        w: trimW * scaleX, h: trimH * scaleY,
      }

      // Safe zone (inside trim)
      const safeInset = SAFE_ZONE_MM
      result.safeRect = {
        x: (trimX + safeInset) * scaleX,
        y: (trimY + safeInset) * scaleY,
        w: (trimW - safeInset * 2) * scaleX,
        h: (trimH - safeInset * 2) * scaleY,
      }

      // Bleed amounts
      if (bleedBox) {
        const bleedW = bleedBox.width
        const bleedH = bleedBox.height
        const bleedX = (mediaW - bleedW) / 2
        const bleedY = (mediaH - bleedH) / 2

        result.bleedRect = {
          x: bleedX * scaleX, y: bleedY * scaleY,
          w: bleedW * scaleX, h: bleedH * scaleY,
        }

        result.bleedAmounts = {
          left: trimX - bleedX,
          right: (bleedX + bleedW) - (trimX + trimW),
          top: trimY - bleedY,
          bottom: (bleedY + bleedH) - (trimY + trimH),
        }
      }
    }

    return result
  }, [trimBox, bleedBox, mediaBox, scaleX, scaleY, mediaW, mediaH])

  // Center offset (the canvas is centered in the container)
  const offsetX = (containerWidth - canvasWidth) / 2
  const offsetY = (containerHeight - canvasHeight) / 2

  return (
    <div style={{
      position: 'absolute', inset: 0,
      pointerEvents: 'none', zIndex: 5,
    }}>
      <svg
        width={containerWidth}
        height={containerHeight}
        style={{ position: 'absolute', inset: 0 }}
      >
        {/* Bleed box (green dashed) */}
        {overlays.bleedRect && (
          <rect
            x={offsetX + overlays.bleedRect.x}
            y={offsetY + overlays.bleedRect.y}
            width={overlays.bleedRect.w}
            height={overlays.bleedRect.h}
            fill="none"
            stroke="#22c55e"
            strokeWidth={1.5}
            strokeDasharray="6 3"
            opacity={0.7}
          />
        )}

        {/* Trim box (red solid) */}
        {overlays.trimRect && (
          <rect
            x={offsetX + overlays.trimRect.x}
            y={offsetY + overlays.trimRect.y}
            width={overlays.trimRect.w}
            height={overlays.trimRect.h}
            fill="none"
            stroke="#ef4444"
            strokeWidth={2}
            opacity={0.8}
          />
        )}

        {/* Safe zone (blue dashed) */}
        {overlays.safeRect && (
          <rect
            x={offsetX + overlays.safeRect.x}
            y={offsetY + overlays.safeRect.y}
            width={overlays.safeRect.w}
            height={overlays.safeRect.h}
            fill="none"
            stroke="#3b82f6"
            strokeWidth={1}
            strokeDasharray="4 4"
            opacity={0.5}
          />
        )}

        {/* Bleed area fill (between bleed and trim) */}
        {overlays.trimRect && overlays.bleedRect && (
          <>
            {/* Left bleed */}
            <rect
              x={offsetX + overlays.bleedRect.x}
              y={offsetY + overlays.trimRect.y}
              width={overlays.trimRect.x - overlays.bleedRect.x}
              height={overlays.trimRect.h}
              fill="#22c55e" opacity={0.06}
            />
            {/* Right bleed */}
            <rect
              x={offsetX + overlays.trimRect.x + overlays.trimRect.w}
              y={offsetY + overlays.trimRect.y}
              width={(overlays.bleedRect.x + overlays.bleedRect.w) - (overlays.trimRect.x + overlays.trimRect.w)}
              height={overlays.trimRect.h}
              fill="#22c55e" opacity={0.06}
            />
            {/* Top bleed */}
            <rect
              x={offsetX + overlays.bleedRect.x}
              y={offsetY + overlays.bleedRect.y}
              width={overlays.bleedRect.w}
              height={overlays.trimRect.y - overlays.bleedRect.y}
              fill="#22c55e" opacity={0.06}
            />
            {/* Bottom bleed */}
            <rect
              x={offsetX + overlays.bleedRect.x}
              y={offsetY + overlays.trimRect.y + overlays.trimRect.h}
              width={overlays.bleedRect.w}
              height={(overlays.bleedRect.y + overlays.bleedRect.h) - (overlays.trimRect.y + overlays.trimRect.h)}
              fill="#22c55e" opacity={0.06}
            />
          </>
        )}

        {/* Labels */}
        {overlays.trimRect && (
          <>
            <text
              x={offsetX + overlays.trimRect.x + 4}
              y={offsetY + overlays.trimRect.y - 4}
              fill="#ef4444" fontSize={10} fontWeight={600} fontFamily="monospace"
            >
              TRIM {trimBox ? `${trimBox.width.toFixed(0)}×${trimBox.height.toFixed(0)}mm` : ''}
            </text>
          </>
        )}

        {overlays.bleedRect && overlays.bleedAmounts && (
          <text
            x={offsetX + overlays.bleedRect.x + 4}
            y={offsetY + overlays.bleedRect.y - 4}
            fill="#22c55e" fontSize={10} fontWeight={600} fontFamily="monospace"
          >
            BLEED {overlays.bleedAmounts.left.toFixed(1)}mm
          </text>
        )}

        {overlays.safeRect && (
          <text
            x={offsetX + overlays.safeRect.x + overlays.safeRect.w - 60}
            y={offsetY + overlays.safeRect.y + overlays.safeRect.h + 12}
            fill="#3b82f6" fontSize={9} fontWeight={600} fontFamily="monospace"
            opacity={0.6}
          >
            SAFE 5mm
          </text>
        )}
      </svg>

      {/* Legend */}
      <div style={{
        position: 'absolute', top: 8, right: 8,
        background: 'rgba(10,14,26,0.85)', borderRadius: 6, padding: '6px 10px',
        display: 'flex', flexDirection: 'column', gap: 3,
        backdropFilter: 'blur(4px)',
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <div style={{ width: 12, height: 2, background: '#ef4444' }} />
          <span style={{ fontSize: 10, color: '#ef4444' }}>Trim</span>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <div style={{ width: 12, height: 2, background: '#22c55e', borderTop: '1px dashed #22c55e' }} />
          <span style={{ fontSize: 10, color: '#22c55e' }}>Bleed</span>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <div style={{ width: 12, height: 2, borderTop: '1px dashed #3b82f6' }} />
          <span style={{ fontSize: 10, color: '#3b82f6' }}>Safe Zone</span>
        </div>
      </div>
    </div>
  )
}

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
 * Matches PdfPreview's fit logic: Math.min(scaleW, scaleH) * 0.95
 */
export function BleedOverlay({ metadata, containerWidth, containerHeight, visible }: BleedOverlayProps) {
  if (!visible || !metadata) return null

  const { trimBox, bleedBox, mediaBox } = metadata
  if (!mediaBox || !mediaBox.width || !mediaBox.height) return null

  const SAFE_ZONE_MM = 5

  const overlays = useMemo(() => {
    const mediaW = mediaBox.width // mm
    const mediaH = mediaBox.height // mm

    // Replicate PdfPreview fit logic:
    // PDF viewport aspect ratio = mediaW / mediaH (in points, but ratio same as mm)
    // fitScale = Math.min(containerW / vpW, containerH / vpH) * 0.95
    // Rendered CSS size = vpW * fitScale, vpH * fitScale
    // Since we only have mm, use aspect ratio:
    const scaleW = containerWidth / mediaW
    const scaleH = containerHeight / mediaH
    const fitScale = Math.min(scaleW, scaleH) * 0.95

    // Actual rendered PDF size in CSS pixels
    const pdfW = mediaW * fitScale
    const pdfH = mediaH * fitScale

    // PDF is centered in container
    const offsetX = (containerWidth - pdfW) / 2
    const offsetY = (containerHeight - pdfH) / 2

    // Scale from mm to rendered pixels
    const mmToPx = fitScale

    const result: {
      offsetX: number; offsetY: number
      trimRect?: { x: number; y: number; w: number; h: number }
      bleedRect?: { x: number; y: number; w: number; h: number }
      safeRect?: { x: number; y: number; w: number; h: number }
      bleedAmounts?: { left: number; right: number; top: number; bottom: number }
      trimBox?: typeof trimBox
    } = { offsetX, offsetY }

    if (trimBox) {
      const trimW = trimBox.width
      const trimH = trimBox.height
      // Assume TrimBox is centered within MediaBox
      const trimXmm = (mediaW - trimW) / 2
      const trimYmm = (mediaH - trimH) / 2

      result.trimRect = {
        x: offsetX + trimXmm * mmToPx,
        y: offsetY + trimYmm * mmToPx,
        w: trimW * mmToPx,
        h: trimH * mmToPx,
      }
      result.trimBox = trimBox

      // Safe zone (inside trim)
      result.safeRect = {
        x: offsetX + (trimXmm + SAFE_ZONE_MM) * mmToPx,
        y: offsetY + (trimYmm + SAFE_ZONE_MM) * mmToPx,
        w: (trimW - SAFE_ZONE_MM * 2) * mmToPx,
        h: (trimH - SAFE_ZONE_MM * 2) * mmToPx,
      }

      if (bleedBox) {
        const bleedW = bleedBox.width
        const bleedH = bleedBox.height
        const bleedXmm = (mediaW - bleedW) / 2
        const bleedYmm = (mediaH - bleedH) / 2

        result.bleedRect = {
          x: offsetX + bleedXmm * mmToPx,
          y: offsetY + bleedYmm * mmToPx,
          w: bleedW * mmToPx,
          h: bleedH * mmToPx,
        }

        result.bleedAmounts = {
          left: trimXmm - bleedXmm,
          right: (bleedXmm + bleedW) - (trimXmm + trimW),
          top: trimYmm - bleedYmm,
          bottom: (bleedYmm + bleedH) - (trimYmm + trimH),
        }
      }
    }

    return result
  }, [trimBox, bleedBox, mediaBox, containerWidth, containerHeight])

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
            x={overlays.bleedRect.x}
            y={overlays.bleedRect.y}
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
            x={overlays.trimRect.x}
            y={overlays.trimRect.y}
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
            x={overlays.safeRect.x}
            y={overlays.safeRect.y}
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
              x={overlays.bleedRect.x}
              y={overlays.trimRect.y}
              width={overlays.trimRect.x - overlays.bleedRect.x}
              height={overlays.trimRect.h}
              fill="#22c55e" opacity={0.06}
            />
            {/* Right bleed */}
            <rect
              x={overlays.trimRect.x + overlays.trimRect.w}
              y={overlays.trimRect.y}
              width={(overlays.bleedRect.x + overlays.bleedRect.w) - (overlays.trimRect.x + overlays.trimRect.w)}
              height={overlays.trimRect.h}
              fill="#22c55e" opacity={0.06}
            />
            {/* Top bleed */}
            <rect
              x={overlays.bleedRect.x}
              y={overlays.bleedRect.y}
              width={overlays.bleedRect.w}
              height={overlays.trimRect.y - overlays.bleedRect.y}
              fill="#22c55e" opacity={0.06}
            />
            {/* Bottom bleed */}
            <rect
              x={overlays.bleedRect.x}
              y={overlays.trimRect.y + overlays.trimRect.h}
              width={overlays.bleedRect.w}
              height={(overlays.bleedRect.y + overlays.bleedRect.h) - (overlays.trimRect.y + overlays.trimRect.h)}
              fill="#22c55e" opacity={0.06}
            />
          </>
        )}

        {/* Labels */}
        {overlays.trimRect && overlays.trimBox && (
          <text
            x={overlays.trimRect.x + 4}
            y={overlays.trimRect.y - 4}
            fill="#ef4444" fontSize={10} fontWeight={600} fontFamily="monospace"
          >
            TRIM {overlays.trimBox.width.toFixed(0)}×{overlays.trimBox.height.toFixed(0)}mm
          </text>
        )}

        {overlays.bleedRect && overlays.bleedAmounts && (
          <text
            x={overlays.bleedRect.x + 4}
            y={overlays.bleedRect.y - 4}
            fill="#22c55e" fontSize={10} fontWeight={600} fontFamily="monospace"
          >
            BLEED {overlays.bleedAmounts.left.toFixed(1)}mm
          </text>
        )}

        {overlays.safeRect && (
          <text
            x={overlays.safeRect.x + overlays.safeRect.w - 60}
            y={overlays.safeRect.y + overlays.safeRect.h + 12}
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

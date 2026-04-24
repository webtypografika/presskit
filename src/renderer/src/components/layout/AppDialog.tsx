import { useDialogStore } from '@/stores/dialog-store'
import { AlertTriangle } from 'lucide-react'

export function AppDialog() {
  const { open, title, message, type, close } = useDialogStore()

  if (!open) return null

  return (
    <div
      className="fixed inset-0 z-[9999] flex items-center justify-center"
      style={{ background: 'rgba(0,0,0,0.45)' }}
      onClick={() => close(false)}
    >
      <div
        className="bg-bg-tertiary border border-border rounded-xl shadow-2xl animate-in fade-in zoom-in-95 duration-150"
        style={{ minWidth: 340, maxWidth: 480, padding: '24px 28px' }}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Icon + Title */}
        <div className="flex items-center gap-3 mb-3">
          <div
            className="flex items-center justify-center rounded-lg"
            style={{ width: 36, height: 36, background: 'rgba(239,68,68,0.12)' }}
          >
            <AlertTriangle size={20} style={{ color: '#ef4444' }} />
          </div>
          {title && (
            <span className="text-text-primary font-semibold" style={{ fontSize: 15 }}>
              {title}
            </span>
          )}
        </div>

        {/* Message */}
        <p
          className="text-text-secondary"
          style={{ fontSize: 13, lineHeight: 1.6, whiteSpace: 'pre-wrap', marginBottom: 20 }}
        >
          {message}
        </p>

        {/* Buttons */}
        <div className="flex justify-end gap-2">
          {type === 'confirm' && (
            <button
              className="px-4 py-1.5 rounded-lg text-text-secondary hover:bg-bg-hover transition-colors"
              style={{ fontSize: 13 }}
              onClick={() => close(false)}
            >
              Άκυρο
            </button>
          )}
          <button
            className="px-4 py-1.5 rounded-lg text-white transition-colors"
            style={{ fontSize: 13, background: type === 'confirm' ? '#ef4444' : '#3b82f6' }}
            onClick={() => close(true)}
            autoFocus
          >
            OK
          </button>
        </div>
      </div>
    </div>
  )
}

import { useDialogStore } from '@/stores/dialog-store'
import { AlertTriangle, HelpCircle } from 'lucide-react'

export function AppDialog() {
  const { open, title, message, type, choices, close } = useDialogStore()

  if (!open) return null

  const isChoice = type === 'choice'
  const isConfirm = type === 'confirm'

  return (
    <div
      className="fixed inset-0 z-[9999] flex items-center justify-center"
      style={{ background: 'rgba(0,0,0,0.45)' }}
      onClick={() => close(isChoice ? '' : false)}
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
            style={{
              width: 36, height: 36,
              background: isChoice ? 'rgba(110,200,200,0.12)' : 'rgba(239,68,68,0.12)',
            }}
          >
            {isChoice
              ? <HelpCircle size={20} style={{ color: 'var(--th-accent)' }} />
              : <AlertTriangle size={20} style={{ color: '#ef4444' }} />
            }
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
        {isChoice ? (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {choices.map((label, i) => (
              <DialogButton
                key={i}
                label={label}
                primary={i === 0}
                onClick={() => close(label)}
              />
            ))}
            <DialogButton label="Cancel" onClick={() => close('')} />
          </div>
        ) : (
          <div className="flex justify-end gap-3">
            {isConfirm && (
              <DialogButton label="Cancel" onClick={() => close(false)} />
            )}
            <DialogButton
              label="OK"
              primary
              danger={isConfirm}
              onClick={() => close(true)}
              autoFocus
            />
          </div>
        )}
      </div>
    </div>
  )
}

function DialogButton({ label, primary, danger, onClick, autoFocus }: {
  label: string
  primary?: boolean
  danger?: boolean
  onClick: () => void
  autoFocus?: boolean
}) {
  const bg = danger
    ? '#ef4444'
    : primary
      ? 'var(--th-accent)'
      : 'var(--th-bg-primary)'
  const color = (primary || danger) ? '#fff' : 'var(--th-text-secondary)'
  const border = (primary || danger) ? 'none' : '1px solid var(--th-border)'

  return (
    <button
      style={{
        fontSize: 13, fontWeight: 500,
        padding: '8px 20px', borderRadius: 8,
        border, background: bg, color,
        cursor: 'pointer', transition: 'opacity 0.15s, background 0.15s',
      }}
      onMouseEnter={e => {
        if (primary || danger) e.currentTarget.style.opacity = '0.85'
        else e.currentTarget.style.background = 'var(--th-bg-hover)'
      }}
      onMouseLeave={e => {
        if (primary || danger) e.currentTarget.style.opacity = '1'
        else e.currentTarget.style.background = 'var(--th-bg-primary)'
      }}
      onClick={onClick}
      autoFocus={autoFocus}
    >
      {label}
    </button>
  )
}

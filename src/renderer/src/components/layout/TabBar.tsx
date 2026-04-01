import { useAppStore, Tab } from '@/stores/app-store'
import { Plus, X, FolderOpen } from 'lucide-react'

export function TabBar() {
  const tabs = useAppStore(s => s.tabs)
  const activeTabId = useAppStore(s => s.activeTabId)
  const setActiveTab = useAppStore(s => s.setActiveTab)
  const addTab = useAppStore(s => s.addTab)
  const closeTab = useAppStore(s => s.closeTab)
  const theme = useAppStore(s => s.theme)
  const isDark = theme === 'dark'

  return (
    <div
      className="titlebar-drag tab-bar flex items-end flex-shrink-0"
      style={{ height: 38, paddingLeft: 12, paddingRight: 140, gap: 2 }}
    >
      {tabs.map(tab => (
        <TabItem
          key={tab.id}
          tab={tab}
          isActive={tab.id === activeTabId}
          canClose={tabs.length > 1}
          isDark={isDark}
          onActivate={() => setActiveTab(tab.id)}
          onClose={() => closeTab(tab.id)}
        />
      ))}

      {/* New tab button */}
      <button
        className="titlebar-no-drag flex items-center justify-center"
        onClick={() => addTab()}
        title="New tab (Ctrl+T)"
        style={{
          width: 24, height: 24, marginBottom: 4,
          border: 'none', borderRadius: 6,
          background: 'transparent', cursor: 'pointer',
          color: 'var(--th-text-muted)',
        }}
        onMouseEnter={e => { e.currentTarget.style.background = 'var(--th-bg-hover)' }}
        onMouseLeave={e => { e.currentTarget.style.background = 'transparent' }}
      >
        <Plus size={14} />
      </button>
    </div>
  )
}

function TabItem({ tab, isActive, canClose, isDark, onActivate, onClose }: {
  tab: Tab
  isActive: boolean
  canClose: boolean
  isDark: boolean
  onActivate: () => void
  onClose: () => void
}) {
  const textColor = isActive
    ? (isDark ? '#e2e8f0' : '#0f172a')
    : (isDark ? '#64748b' : '#6b7a8d')
  const hoverBg = isDark ? '#1a2340' : '#d4d9e2'
  const mutedColor = isDark ? '#64748b' : '#8492a6'

  return (
    <div
      className={`titlebar-no-drag group flex items-center tab-item${isActive ? ' is-active' : ''}`}
      onClick={onActivate}
      onMouseDown={e => {
        if (e.button === 1 && canClose) { e.preventDefault(); onClose() }
      }}
      style={{
        height: 30, maxWidth: 200, minWidth: 48,
        padding: '0 8px', gap: 6,
        borderRadius: '8px 8px 0 0',
        cursor: 'pointer',
        color: textColor,
        fontSize: 12,
        transition: 'background 0.1s',
      }}
    >
      <FolderOpen size={12} style={{ flexShrink: 0, opacity: 0.6 }} />
      <span style={{
        overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', flex: 1,
      }}>
        {tab.label || 'New Tab'}
      </span>
      {canClose && (
        <button
          onClick={e => { e.stopPropagation(); onClose() }}
          className="opacity-0 group-hover:opacity-100"
          style={{
            width: 16, height: 16, minHeight: 16, flexShrink: 0,
            border: 'none', borderRadius: 3, padding: 0,
            background: 'transparent', cursor: 'pointer',
            color: mutedColor,
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            ...(isActive ? { opacity: 0.6 } : {}),
          }}
          onMouseEnter={e => { e.currentTarget.style.color = '#ef4444' }}
          onMouseLeave={e => { e.currentTarget.style.color = mutedColor }}
        >
          <X size={10} />
        </button>
      )}
    </div>
  )
}

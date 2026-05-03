import { Component, type ReactNode, type ErrorInfo } from 'react'

interface Props {
  children: ReactNode
}

interface State {
  error: Error | null
  info: ErrorInfo | null
}

/**
 * Top-level error boundary. Without this, any uncaught React render error
 * unmounts the entire tree and leaves the window grey/blank, which we
 * were seeing after certain drag-drop and navigation operations.
 *
 * Renders a recoverable error screen with the stack so the issue is visible
 * rather than silently killing the app.
 */
export class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null, info: null }

  static getDerivedStateFromError(error: Error): Partial<State> {
    return { error }
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    // Log to DevTools console for diagnostics
    console.error('[ErrorBoundary] React error:', error)
    console.error('[ErrorBoundary] Component stack:', info.componentStack)
    this.setState({ info })
  }

  private handleReload = (): void => {
    // Full reload — re-initializes all stores and queries
    window.location.reload()
  }

  private handleReset = (): void => {
    // Soft recovery — just re-mount the tree
    this.setState({ error: null, info: null })
  }

  render(): ReactNode {
    if (!this.state.error) return this.props.children

    return (
      <div
        style={{
          position: 'fixed',
          inset: 0,
          background: 'var(--th-bg-secondary, #1a1f2e)',
          color: 'var(--th-text-primary, #e5e7eb)',
          padding: 32,
          overflow: 'auto',
          fontFamily: 'system-ui, sans-serif',
          fontSize: 13,
          zIndex: 99999,
        }}
      >
        <h1 style={{ fontSize: 20, fontWeight: 600, marginBottom: 12, color: '#ef4444' }}>
          Κάτι πήγε στραβά
        </h1>
        <p style={{ marginBottom: 16, color: 'var(--th-text-secondary, #9ca3af)' }}>
          Παρουσιάστηκε σφάλμα στο UI. Μπορείς να δοκιμάσεις επαναφορά ή να κάνεις reload.
        </p>

        <div style={{ display: 'flex', gap: 8, marginBottom: 24 }}>
          <button
            onClick={this.handleReset}
            style={{
              padding: '8px 16px',
              background: '#6ec8c8',
              color: 'white',
              border: 'none',
              borderRadius: 6,
              cursor: 'pointer',
              fontSize: 13,
              fontWeight: 500,
            }}
          >
            Επαναφορά
          </button>
          <button
            onClick={this.handleReload}
            style={{
              padding: '8px 16px',
              background: 'transparent',
              color: 'var(--th-text-primary, #e5e7eb)',
              border: '1px solid var(--th-border, #374151)',
              borderRadius: 6,
              cursor: 'pointer',
              fontSize: 13,
            }}
          >
            Reload εφαρμογής
          </button>
        </div>

        <details open style={{ marginTop: 16 }}>
          <summary style={{ cursor: 'pointer', marginBottom: 8, color: 'var(--th-text-muted, #6b7280)' }}>
            Τεχνικές λεπτομέρειες
          </summary>
          <pre
            style={{
              background: 'var(--th-bg-primary, #0f1525)',
              padding: 12,
              borderRadius: 6,
              overflow: 'auto',
              fontSize: 11,
              fontFamily: 'ui-monospace, monospace',
              whiteSpace: 'pre-wrap',
              wordBreak: 'break-word',
              color: '#fca5a5',
            }}
          >
            {this.state.error.name}: {this.state.error.message}
            {'\n\n'}
            {this.state.error.stack}
            {this.state.info?.componentStack ? '\n\nComponent stack:' + this.state.info.componentStack : ''}
          </pre>
        </details>
      </div>
    )
  }
}

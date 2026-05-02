import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import App from './App'
import { ErrorBoundary } from './components/ErrorBoundary'
import { LicenseGate } from './components/LicenseGate'
import './globals.css'

// Surface renderer-side crashes. Without these, unhandled promise rejections
// and window errors go to DevTools only — and the window would just go blank.
window.addEventListener('error', (e) => {
  console.error('[window.error]', e.error || e.message, e.filename, e.lineno, e.colno)
})
window.addEventListener('unhandledrejection', (e) => {
  console.error('[unhandledrejection]', e.reason)
})

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 30_000,
      retry: 1
    }
  }
})

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <ErrorBoundary>
      <QueryClientProvider client={queryClient}>
        <LicenseGate>
          <App />
        </LicenseGate>
      </QueryClientProvider>
    </ErrorBoundary>
  </StrictMode>
)

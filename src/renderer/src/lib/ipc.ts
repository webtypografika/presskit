// Type-safe IPC wrapper — re-exports window.api with proper types
// This file exists so components can import from '@/lib/ipc' for better IDE support

export function getApi() {
  return window.api
}

// Presscal types matching the presscal-next schema
export interface PresscalQuote {
  id: string
  number: string
  status: string
  title: string | null
  description: string | null
  customerId: string | null
  customerName: string | null
  grandTotal: number
  jobStage: string | null
  jobPriority: string | null
  deadline: string | null
  date: string
  sentAt: string | null
}

export interface PresscalCustomer {
  id: string
  name: string
  company: string | null
  email: string | null
  phone: string | null
  tags: string[]
  quoteCount: number
}

export interface PresscalJob {
  id: string
  number: string
  title: string | null
  customerName: string | null
  jobStage: string
  jobPriority: string
  deadline: string | null
  items: any[]
}

export interface FileLink {
  id: string
  fileName: string
  filePath: string
  fileType: string
  fileSize: number
  source: 'local' | 'dropbox'
  quoteId: string | null
  customerId: string | null
  thumbnail: string | null
  preflightStatus: string | null
  notes: string | null
  createdAt: string
}

export interface DropboxEntry {
  name: string
  path: string
  isDirectory: boolean
  size: number
  modified: string | null
}

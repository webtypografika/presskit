export type FileType =
  | 'pdf' | 'ai' | 'psd' | 'eps' | 'indd'
  | 'tiff' | 'png' | 'jpg' | 'svg' | 'raw'
  | 'font' | 'document' | 'spreadsheet'
  | 'archive' | 'folder' | 'unknown'

export interface FileEntry {
  name: string
  path: string
  isDirectory: boolean
  size: number
  modified: string
  created: string
  extension: string
  type: FileType
  cloudStatus?: 'local' | 'cloud' | 'syncing'
}

export interface FileMetadata {
  name: string
  path: string
  directory: string
  size: number
  created: string
  modified: string
  extension: string
  type: FileType
  // Image-specific
  width?: number
  height?: number
  dpi?: number
  colorSpace?: string
  channels?: number
  bitDepth?: string
  hasAlpha?: boolean
  format?: string
  iccProfile?: { size: number; description: string }
  // PDF-specific
  pageCount?: number
  mediaBox?: { width: number; height: number }
  trimBox?: { width: number; height: number }
  bleedBox?: { width: number; height: number }
  cropBox?: { width: number; height: number }
  pdfVersion?: string
  // PSD-specific
  colorMode?: number
  layerCount?: number
  // Font-specific
  fontFamily?: string
  fontSubfamily?: string
  designer?: string
  manufacturer?: string
  license?: string
  version?: string
  glyphCount?: number
  unitsPerEm?: number
  openTypeFeatures?: string[]
}

export interface PreviewResult {
  type: 'image' | 'pdf-page' | 'svg' | 'font-sample' | 'none'
  data: string
  width?: number
  height?: number
  pageCount?: number
  layers?: LayerInfo[]
}

export interface LayerInfo {
  name: string
  visible: boolean
  opacity: number
  blendMode?: string
}

export type Severity = 'pass' | 'warning' | 'error' | 'info'

export interface PreflightCheck {
  id: string
  label: string
  severity: Severity
  value: string
  detail?: string
}

export interface PreflightReport {
  fileName: string
  fileType: string
  overallStatus: 'pass' | 'warning' | 'error'
  checks: PreflightCheck[]
  timestamp: string
}

// File type utilities

export function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`
}

export function getFileTypeLabel(type: FileType): string {
  const labels: Record<FileType, string> = {
    pdf: 'PDF',
    ai: 'Illustrator',
    psd: 'Photoshop',
    eps: 'EPS',
    indd: 'InDesign',
    tiff: 'TIFF',
    png: 'PNG',
    jpg: 'JPEG',
    svg: 'SVG',
    raw: 'RAW',
    font: 'Font',
    document: 'Document',
    spreadsheet: 'Spreadsheet',
    archive: 'Archive',
    folder: 'Folder',
    unknown: 'File'
  }
  return labels[type] || 'File'
}

export function getFileTypeColor(type: FileType): string {
  const colors: Record<FileType, string> = {
    pdf: '#e11d48',
    ai: '#ff7c00',
    psd: '#31a8ff',
    eps: '#ff7c00',
    indd: '#ff3366',
    tiff: '#10b981',
    png: '#10b981',
    jpg: '#10b981',
    svg: '#f59e0b',
    raw: '#8b5cf6',
    font: '#a78bfa',
    document: '#64748b',
    spreadsheet: '#22c55e',
    archive: '#78716c',
    folder: '#f58220',
    unknown: '#64748b'
  }
  return colors[type] || '#64748b'
}

export function isPreviewable(type: FileType): boolean {
  return ['pdf', 'ai', 'psd', 'tiff', 'png', 'jpg', 'svg', 'font'].includes(type)
}

export function isImageType(type: FileType): boolean {
  return ['tiff', 'png', 'jpg', 'svg', 'raw', 'psd'].includes(type)
}

export function isPrintFile(type: FileType): boolean {
  return ['pdf', 'ai', 'psd', 'eps', 'indd', 'tiff'].includes(type)
}

import { useAppStore } from '@/stores/app-store'
import { FileGrid } from './FileGrid'
import { Loader2 } from 'lucide-react'

export function FileBrowser() {
  const { files, loading, viewMode, selectedFile, selectFile, navigateTo } = useAppStore()

  if (loading) {
    return (
      <div className="h-full flex items-center justify-center text-text-muted">
        <Loader2 size={24} className="animate-spin" />
      </div>
    )
  }

  if (files.length === 0) {
    return (
      <div className="h-full flex items-center justify-center text-text-muted text-sm">
        Empty folder
      </div>
    )
  }

  return (
    <FileGrid
      files={files}
      viewMode={viewMode}
      selectedFile={selectedFile}
      onSelect={selectFile}
      onOpen={(file) => {
        if (file.isDirectory) {
          navigateTo(file.path)
        } else {
          selectFile(file)
        }
      }}
    />
  )
}

// Shared module-level state for the currently active internal drag.
//
// We use Electron's native OLE drag (`webContents.startDrag`) rather than
// HTML5 drag-and-drop so that files can be dropped into other applications
// (Explorer, email clients, etc.). Because `preventDefault()` is called on
// the HTML5 dragstart event, the normal `dataTransfer` channel is unavailable
// for passing paths between drag source and drop target. This module fills
// that gap: the drag source writes the paths here, and drop targets inside
// the app (FileGrid, Sidebar) read them to detect "internal" drags and
// preserve move-vs-copy semantics.

let current: string[] = []

export const dragState = {
  get: (): string[] => current,
  set: (paths: string[]): void => { current = paths },
  clear: (): void => { current = [] },
  isActive: (): boolean => current.length > 0
}

import { create } from 'zustand'

interface DialogState {
  open: boolean
  title: string
  message: string
  type: 'alert' | 'confirm'
  resolve: ((ok: boolean) => void) | null
}

interface DialogActions {
  showAlert: (message: string, title?: string) => void
  showConfirm: (message: string, title?: string) => Promise<boolean>
  close: (result: boolean) => void
}

export const useDialogStore = create<DialogState & DialogActions>((set, get) => ({
  open: false,
  title: '',
  message: '',
  type: 'alert',
  resolve: null,

  showAlert: (message, title = '') => {
    set({ open: true, title, message, type: 'alert', resolve: null })
  },

  showConfirm: (message, title = '') => {
    return new Promise<boolean>((res) => {
      set({ open: true, title, message, type: 'confirm', resolve: res })
    })
  },

  close: (result) => {
    const { resolve } = get()
    resolve?.(result)
    set({ open: false, title: '', message: '', resolve: null })
  },
}))

import { create } from 'zustand'

interface DialogState {
  open: boolean
  title: string
  message: string
  type: 'alert' | 'confirm' | 'choice'
  /** Alerts carry both failures and confirmations. Without this they all
   *  wore the red warning triangle, so "Connected to PressCal!" looked
   *  like something had gone wrong at the exact moment it went right. */
  tone: 'error' | 'success'
  choices: string[]
  resolve: ((result: boolean | string) => void) | null
}

interface DialogActions {
  showAlert: (message: string, title?: string, tone?: 'error' | 'success') => void
  showConfirm: (message: string, title?: string) => Promise<boolean>
  showChoice: (message: string, choices: string[], title?: string) => Promise<string>
  close: (result: boolean | string) => void
}

export const useDialogStore = create<DialogState & DialogActions>((set, get) => ({
  open: false,
  title: '',
  message: '',
  type: 'alert',
  tone: 'error',
  choices: [],
  resolve: null,

  showAlert: (message, title = '', tone = 'error') => {
    set({ open: true, title, message, type: 'alert', tone, choices: [], resolve: null })
  },

  showConfirm: (message, title = '') => {
    return new Promise<boolean>((res) => {
      set({ open: true, title, message, type: 'confirm', choices: [], resolve: res as any })
    })
  },

  showChoice: (message, choices, title = '') => {
    return new Promise<string>((res) => {
      set({ open: true, title, message, type: 'choice', choices, resolve: res as any })
    })
  },

  close: (result) => {
    const { resolve } = get()
    resolve?.(result)
    set({ open: false, title: '', message: '', choices: [], resolve: null })
  },
}))

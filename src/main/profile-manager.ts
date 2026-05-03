import { app, IpcMain } from 'electron'
import Store from 'electron-store'
import { existsSync, mkdirSync, renameSync, rmSync, readFileSync } from 'fs'
import { join } from 'path'
import { randomBytes } from 'crypto'

// Brand teal palette — chosen at random per new profile for visual distinction.
const PROFILE_COLORS = [
  '#6ec8c8', // teal (primary brand)
  '#00707c', // deep teal
  '#10b981', // emerald
  '#f59e0b', // amber
  '#3b82f6', // blue
  '#a78bfa', // violet
  '#f06548', // coral
  '#ec4899', // pink
]

export interface ProfileMetadata {
  id: string
  name: string
  email?: string
  presscalUrl?: string
  orgName?: string
  color: string
  createdAt: number
  lastUsedAt: number
}

interface ProfilesIndex {
  activeId: string
  profiles: ProfileMetadata[]
}

const PROFILES_INDEX_NAME = 'profiles'
const DEFAULT_PROFILE_ID = 'default'

let profilesIndex: Store<ProfilesIndex> | null = null
let activeProfileStore: Store | null = null

function getUserDataDir(): string {
  return app.getPath('userData')
}

function profileDir(id: string): string {
  return join(getUserDataDir(), 'profiles', id)
}

function ensureProfileDir(id: string): void {
  const dir = profileDir(id)
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true })
}

function generateProfileId(name: string): string {
  // Slug + short random suffix; the id is internal but stays human-readable
  // when poking around %APPDATA%/PressKit/profiles/.
  const slug = name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 24) || 'profile'
  const suffix = randomBytes(3).toString('hex')
  return `${slug}-${suffix}`
}

function pickRandomColor(): string {
  return PROFILE_COLORS[Math.floor(Math.random() * PROFILE_COLORS.length)]
}

/**
 * On first v2.x launch, the user has a v1.x config.json sitting at
 * <userData>/config.json with their existing PressCal URL + key. Move that
 * into the default profile folder and seed profiles.json so the user lands
 * exactly where they left off.
 */
function migrateLegacyConfigIfNeeded(): void {
  const profilesIndexFile = join(getUserDataDir(), `${PROFILES_INDEX_NAME}.json`)
  if (existsSync(profilesIndexFile)) return // already migrated

  const legacyConfig = join(getUserDataDir(), 'config.json')
  ensureProfileDir(DEFAULT_PROFILE_ID)

  let presscalUrl: string | undefined
  if (existsSync(legacyConfig)) {
    try {
      const data = JSON.parse(readFileSync(legacyConfig, 'utf-8')) as Record<string, any>
      presscalUrl = typeof data['presscal.url'] === 'string' ? data['presscal.url'] : undefined
      // Move legacy file into the default profile folder. Use rename so we
      // don't end up with two copies; if rename fails (cross-volume), fall
      // back to copy + unlink.
      const target = join(profileDir(DEFAULT_PROFILE_ID), 'config.json')
      try {
        renameSync(legacyConfig, target)
      } catch {
        // Best-effort fallback; copy via electron-store
        const tmp = new Store({ name: 'config', cwd: profileDir(DEFAULT_PROFILE_ID) })
        tmp.store = data
      }
    } catch (e) {
      console.error('[ProfileManager] Legacy migration failed:', e)
    }
  }

  // Seed the profiles index regardless — so a fresh install also gets a
  // Default profile to write into.
  profilesIndex = new Store<ProfilesIndex>({
    name: PROFILES_INDEX_NAME,
    defaults: {
      activeId: DEFAULT_PROFILE_ID,
      profiles: [{
        id: DEFAULT_PROFILE_ID,
        name: 'Default',
        presscalUrl,
        color: '#6ec8c8',
        createdAt: Date.now(),
        lastUsedAt: Date.now(),
      }],
    },
  })
}

/**
 * Initialize the profile system. Must be called once before any other
 * profile or settings code runs (i.e. before registerSettingsHandlers).
 */
export function initializeProfiles(): void {
  migrateLegacyConfigIfNeeded()
  if (!profilesIndex) {
    profilesIndex = new Store<ProfilesIndex>({
      name: PROFILES_INDEX_NAME,
      defaults: {
        activeId: DEFAULT_PROFILE_ID,
        profiles: [{
          id: DEFAULT_PROFILE_ID,
          name: 'Default',
          color: '#6ec8c8',
          createdAt: Date.now(),
          lastUsedAt: Date.now(),
        }],
      },
    })
  }

  const activeId = profilesIndex.get('activeId')
  ensureProfileDir(activeId)
  activeProfileStore = new Store({ name: 'config', cwd: profileDir(activeId) })

  // Bump lastUsedAt for the active profile.
  const profiles = profilesIndex.get('profiles')
  const idx = profiles.findIndex(p => p.id === activeId)
  if (idx >= 0) {
    profiles[idx].lastUsedAt = Date.now()
    profilesIndex.set('profiles', profiles)
  }
}

/** Returns the active profile's electron-store. Throws if not initialized. */
export function getActiveStore(): Store {
  if (!activeProfileStore) {
    throw new Error('Profile system not initialized — call initializeProfiles() first.')
  }
  return activeProfileStore
}

export function listProfiles(): ProfileMetadata[] {
  if (!profilesIndex) return []
  return profilesIndex.get('profiles')
}

export function getActiveProfileId(): string {
  if (!profilesIndex) return DEFAULT_PROFILE_ID
  return profilesIndex.get('activeId')
}

export function getActiveProfile(): ProfileMetadata | null {
  const profiles = listProfiles()
  return profiles.find(p => p.id === getActiveProfileId()) ?? null
}

/**
 * Create a new profile. Returns the new profile's id. Caller is expected to
 * subsequently call switchProfile() to activate it (which restarts the app).
 */
export function createProfile(input: { name: string; email?: string; presscalUrl?: string }): ProfileMetadata {
  if (!profilesIndex) throw new Error('Not initialized')
  const id = generateProfileId(input.name)
  ensureProfileDir(id)
  const meta: ProfileMetadata = {
    id,
    name: input.name,
    email: input.email,
    presscalUrl: input.presscalUrl,
    color: pickRandomColor(),
    createdAt: Date.now(),
    lastUsedAt: Date.now(),
  }
  const profiles = profilesIndex.get('profiles')
  profiles.push(meta)
  profilesIndex.set('profiles', profiles)
  return meta
}

/** Updates editable fields on a profile. */
export function updateProfile(id: string, patch: Partial<Pick<ProfileMetadata, 'name' | 'email' | 'color' | 'presscalUrl' | 'orgName'>>): ProfileMetadata | null {
  if (!profilesIndex) return null
  const profiles = profilesIndex.get('profiles')
  const idx = profiles.findIndex(p => p.id === id)
  if (idx < 0) return null
  profiles[idx] = { ...profiles[idx], ...patch }
  profilesIndex.set('profiles', profiles)
  return profiles[idx]
}

/**
 * Delete a profile (and its on-disk folder). Cannot delete the active
 * profile — caller must switch away first. Cannot delete the last profile.
 */
export function deleteProfile(id: string): { ok: boolean; error?: string } {
  if (!profilesIndex) return { ok: false, error: 'Not initialized' }
  if (id === getActiveProfileId()) return { ok: false, error: 'Cannot delete the active profile' }
  const profiles = profilesIndex.get('profiles')
  if (profiles.length <= 1) return { ok: false, error: 'Cannot delete the last remaining profile' }
  const filtered = profiles.filter(p => p.id !== id)
  if (filtered.length === profiles.length) return { ok: false, error: 'Profile not found' }
  profilesIndex.set('profiles', filtered)
  // Best-effort folder removal — don't fail the operation if it can't be
  // deleted right now (Dropbox locks, antivirus scans, etc.). The orphaned
  // folder is harmless.
  try {
    rmSync(profileDir(id), { recursive: true, force: true })
  } catch (e) {
    console.warn('[ProfileManager] Could not remove profile folder:', e)
  }
  return { ok: true }
}

/**
 * Set a different profile as active. The app must restart for the new
 * profile's settings (PressCal credentials, bookmarks, etc.) to load —
 * cold-swap by design, much simpler and more reliable than hot-swap.
 */
export function switchProfile(id: string): { ok: boolean; error?: string } {
  if (!profilesIndex) return { ok: false, error: 'Not initialized' }
  const profiles = profilesIndex.get('profiles')
  if (!profiles.some(p => p.id === id)) return { ok: false, error: 'Profile not found' }
  profilesIndex.set('activeId', id)
  app.relaunch()
  app.exit(0)
  return { ok: true }
}

export function registerProfileHandlers(ipcMain: IpcMain): void {
  ipcMain.handle('profiles:list', () => listProfiles())
  ipcMain.handle('profiles:active', () => getActiveProfile())
  ipcMain.handle('profiles:switch', (_e, id: string) => switchProfile(id))
  ipcMain.handle('profiles:create', (_e, data: { name: string; email?: string; presscalUrl?: string }) => createProfile(data))
  ipcMain.handle('profiles:update', (_e, id: string, patch: Partial<ProfileMetadata>) => updateProfile(id, patch))
  ipcMain.handle('profiles:delete', (_e, id: string) => deleteProfile(id))
}

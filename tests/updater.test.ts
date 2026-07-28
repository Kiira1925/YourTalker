import { EventEmitter } from 'node:events'
import { mkdtemp, readdir, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { UpdateState } from '../src/shared/types'
import { JsonStore } from '../src/main/store'
import { UpdateManager, type UpdaterLike } from '../src/main/updater'

class FakeUpdater extends EventEmitter {
  autoDownload = false
  autoInstallOnAppQuit = false
  allowDowngrade = true
  allowPrerelease = true
  logger: unknown
  checkForUpdates = vi.fn<() => Promise<unknown>>()
  quitAndInstall = vi.fn()
}

const directories: string[] = []

beforeEach(() => vi.clearAllMocks())
afterEach(async () => {
  for (const directory of directories.splice(0)) await rm(directory, { recursive: true, force: true })
})

async function fixture(feedUrl = 'https://updates.example.com/yourtalker') {
  const directory = await mkdtemp(join(tmpdir(), 'yourtalker-updater-test-'))
  directories.push(directory)
  const store = new JsonStore(directory)
  await store.init()
  const fake = new FakeUpdater()
  const states: UpdateState[] = []
  const manager = new UpdateManager({
    store,
    currentVersion: '0.2.0',
    source: feedUrl ? { provider: 'generic', url: feedUrl } : { provider: 'disabled' },
    isPackaged: true,
    emit: (state) => states.push(state),
    updater: fake as unknown as UpdaterLike,
    autoCheck: false
  })
  return { directory, store, fake, states, manager }
}

const updateInfo = (version: string) =>
  ({
    version,
    files: [],
    path: `YourTalker-Setup-${version}.exe`,
    sha512: 'test',
    releaseDate: new Date().toISOString(),
    releaseName: `YourTalker ${version}`,
    releaseNotes: `Version ${version}`
  }) as never

describe('UpdateManager', () => {
  it('stays disabled for development and builds without a configured HTTPS feed', async () => {
    const { store } = await fixture()
    const development = new UpdateManager({
      store,
      currentVersion: '0.2.0',
      source: { provider: 'github', owner: 'example', repo: 'yourtalker' },
      isPackaged: false,
      emit: () => undefined
    })
    const missingFeed = new UpdateManager({
      store,
      currentVersion: '0.2.0',
      source: { provider: 'disabled' },
      isPackaged: true,
      emit: () => undefined
    })
    expect(development.getState()).toMatchObject({ enabled: false, status: 'disabled' })
    expect(missingFeed.getState()).toMatchObject({ enabled: false, status: 'disabled' })
  })

  it('checks manually and reports that the current version is latest', async () => {
    const { fake, manager } = await fixture()
    fake.checkForUpdates.mockImplementation(async () => {
      fake.emit('checking-for-update')
      fake.emit('update-not-available', updateInfo('0.2.0'))
      return null
    })
    const state = await manager.check()
    expect(fake.checkForUpdates).toHaveBeenCalledOnce()
    expect(state).toMatchObject({
      enabled: true,
      status: 'not-available',
      currentVersion: '0.2.0'
    })
  })

  it('tracks download progress, backs up data, and installs only when ready', async () => {
    const { store, fake, manager } = await fixture()
    fake.emit('update-available', updateInfo('0.3.0'))
    fake.emit('download-progress', {
      percent: 42.34,
      transferred: 42,
      total: 100,
      bytesPerSecond: 20,
      delta: 1
    })
    expect(manager.getState()).toMatchObject({ status: 'downloading', percent: 42.3 })

    fake.emit('update-downloaded', updateInfo('0.3.0'))
    await vi.waitFor(() => expect(manager.getState().status).toBe('downloaded'))
    expect((await readdir(store.backupsDir)).some((name) => name.includes('before-update-0.3.0'))).toBe(true)

    await manager.install()
    expect(fake.autoInstallOnAppQuit).toBe(true)
    expect(fake.quitAndInstall).toHaveBeenCalledWith(false, true)
  })

  it('does not install when the pre-update backup fails', async () => {
    const { store, fake, manager } = await fixture()
    vi.spyOn(store, 'writeBackup').mockRejectedValueOnce(new Error('disk full'))
    fake.emit('update-downloaded', updateInfo('0.3.0'))
    await vi.waitFor(() => expect(manager.getState().status).toBe('error'))
    await expect(manager.install()).rejects.toThrow('インストール可能な更新はありません')
    expect(fake.quitAndInstall).not.toHaveBeenCalled()
  })

  it('stays open when the final backup immediately before restart fails', async () => {
    const { store, fake, manager } = await fixture()
    fake.emit('update-downloaded', updateInfo('0.3.0'))
    await vi.waitFor(() => expect(manager.getState().status).toBe('downloaded'))
    vi.spyOn(store, 'writeBackup').mockRejectedValueOnce(new Error('disk full'))

    await expect(manager.install()).rejects.toThrow('更新前のバックアップを作成できませんでした')
    expect(manager.getState().status).toBe('error')
    expect(fake.quitAndInstall).not.toHaveBeenCalled()
  })

  it('allows a retry after a failed update check', async () => {
    const { fake, manager } = await fixture()
    fake.checkForUpdates.mockRejectedValueOnce(new Error('offline'))
    expect((await manager.check()).status).toBe('error')

    fake.checkForUpdates.mockImplementationOnce(async () => {
      fake.emit('update-not-available', updateInfo('0.2.0'))
      return null
    })
    expect((await manager.check()).status).toBe('not-available')
    expect(fake.checkForUpdates).toHaveBeenCalledTimes(2)
  })

  it('suppresses extra checks while an update is downloading', async () => {
    const { fake, manager } = await fixture()
    fake.emit('download-progress', {
      percent: 10,
      transferred: 10,
      total: 100,
      bytesPerSecond: 5,
      delta: 1
    })
    const state = await manager.check()
    expect(state.status).toBe('downloading')
    expect(fake.checkForUpdates).not.toHaveBeenCalled()
  })
})

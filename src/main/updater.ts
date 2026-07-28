import log from 'electron-log/main'
import { NsisUpdater, type ProgressInfo, type UpdateDownloadedEvent, type UpdateInfo } from 'electron-updater'
import type { UpdateState } from '../shared/types'
import type { JsonStore } from './store'

export interface UpdaterLike {
  autoDownload: boolean
  autoInstallOnAppQuit: boolean
  allowDowngrade: boolean
  allowPrerelease: boolean
  logger: unknown
  on(event: 'checking-for-update', listener: () => void): this
  on(event: 'update-available', listener: (info: UpdateInfo) => void): this
  on(event: 'update-not-available', listener: (info: UpdateInfo) => void): this
  on(event: 'download-progress', listener: (info: ProgressInfo) => void): this
  on(event: 'update-downloaded', listener: (info: UpdateDownloadedEvent) => void): this
  on(event: 'error', listener: (error: Error) => void): this
  checkForUpdates(): Promise<unknown>
  quitAndInstall(isSilent?: boolean, isForceRunAfter?: boolean): void
}

export type UpdateSource =
  | { provider: 'github'; owner: string; repo: string }
  | { provider: 'generic'; url: string }
  | { provider: 'disabled' }

interface UpdateManagerOptions {
  store: JsonStore
  currentVersion: string
  source: UpdateSource
  isPackaged: boolean
  emit: (state: UpdateState) => void
  updater?: UpdaterLike
  autoCheck?: boolean
  startupDelayMs?: number
  intervalMs?: number
}

const DEFAULT_INTERVAL = 6 * 60 * 60 * 1000

export class UpdateManager {
  private state: UpdateState
  private updater?: UpdaterLike
  private checkInFlight = false
  private installInFlight = false
  private startupTimer?: NodeJS.Timeout
  private intervalTimer?: NodeJS.Timeout

  constructor(private readonly options: UpdateManagerOptions) {
    const enabled = options.isPackaged && isEnabledSource(options.source)
    this.state = {
      enabled,
      currentVersion: options.currentVersion,
      status: enabled ? 'idle' : 'disabled',
      message: enabled
        ? '更新を確認できます。'
        : options.isPackaged
          ? 'このビルドには更新配信先が設定されていません。'
          : '開発モードでは自動更新を行いません。'
    }

    if (!enabled || options.source.provider === 'disabled') return
    this.updater =
      options.updater ??
      (new NsisUpdater(updaterConfiguration(options.source)) as unknown as UpdaterLike)
    this.configureUpdater(this.updater)
  }

  start(): void {
    if (!this.updater || this.options.autoCheck === false) return
    const delay = this.options.startupDelayMs ?? 12_000
    const interval = this.options.intervalMs ?? DEFAULT_INTERVAL
    this.startupTimer = setTimeout(() => void this.check(false), delay)
    this.startupTimer.unref()
    this.intervalTimer = setInterval(() => void this.check(false), interval)
    this.intervalTimer.unref()
  }

  stop(): void {
    if (this.startupTimer) clearTimeout(this.startupTimer)
    if (this.intervalTimer) clearInterval(this.intervalTimer)
  }

  getState(): UpdateState {
    return { ...this.state }
  }

  async check(manual = true): Promise<UpdateState> {
    if (!this.updater) return this.getState()
    if (this.checkInFlight || ['downloading', 'preparing', 'downloaded'].includes(this.state.status)) {
      return this.getState()
    }
    this.checkInFlight = true
    this.setState({
      status: 'checking',
      message: manual ? '更新を確認しています…' : 'バックグラウンドで更新を確認しています…',
      percent: undefined,
      transferred: undefined,
      total: undefined,
      bytesPerSecond: undefined
    })
    try {
      await this.updater.checkForUpdates()
    } catch (error) {
      this.setError(error)
    } finally {
      this.checkInFlight = false
    }
    return this.getState()
  }

  async install(): Promise<void> {
    if (this.installInFlight) throw new Error('更新の適用処理はすでに開始されています。')
    if (!this.updater || this.state.status !== 'downloaded' || !this.state.availableVersion) {
      throw new Error('インストール可能な更新はありません。')
    }
    this.installInFlight = true
    this.setState({ status: 'preparing', message: '最新データのバックアップを作成しています…' })
    try {
      await this.prepareBackup(this.state.availableVersion)
    } catch (error) {
      log.error('Pre-install backup failed', error)
      this.installInFlight = false
      this.setState({
        status: 'error',
        message: '更新前のバックアップを作成できなかったため、更新を中止しました。'
      })
      throw new Error('更新前のバックアップを作成できませんでした。保存先の空き容量を確認してください。')
    }
    this.setState({ status: 'downloaded', message: '再起動すると更新が適用されます。' })
    this.updater.autoInstallOnAppQuit = true
    this.updater.quitAndInstall(false, true)
  }

  private configureUpdater(updater: UpdaterLike): void {
    updater.autoDownload = true
    updater.autoInstallOnAppQuit = false
    updater.allowDowngrade = false
    updater.allowPrerelease = false
    updater.logger = log
    log.transports.file.level = 'info'

    updater.on('checking-for-update', () => {
      this.setState({ status: 'checking', message: '更新を確認しています…' })
    })
    updater.on('update-available', (info) => {
      this.setState({
        status: 'available',
        availableVersion: info.version,
        releaseNotes: releaseNotesText(info.releaseNotes),
        message: `バージョン ${info.version} をダウンロードします。`
      })
    })
    updater.on('download-progress', (progress) => {
      this.setState({
        status: 'downloading',
        percent: clampPercent(progress.percent),
        transferred: progress.transferred,
        total: progress.total,
        bytesPerSecond: progress.bytesPerSecond,
        message: '更新をダウンロードしています…'
      })
    })
    updater.on('update-not-available', (info) => {
      this.setState({
        status: 'not-available',
        availableVersion: info.version,
        checkedAt: new Date().toISOString(),
        message: '現在のバージョンが最新です。'
      })
    })
    updater.on('update-downloaded', (info) => {
      void this.onDownloaded(info)
    })
    updater.on('error', (error) => this.setError(error))
  }

  private async onDownloaded(info: UpdateDownloadedEvent): Promise<void> {
    const version = info.version
    this.setState({
      status: 'preparing',
      availableVersion: version,
      releaseNotes: releaseNotesText(info.releaseNotes),
      percent: 100,
      message: '更新前のバックアップを作成しています…'
    })
    try {
      await this.prepareBackup(version)
      this.setState({
        status: 'downloaded',
        checkedAt: new Date().toISOString(),
        message: '更新の準備ができました。再起動すると適用されます。'
      })
    } catch (error) {
      this.setError(new Error(`更新前バックアップに失敗しました: ${errorMessage(error)}`))
    }
  }

  private async prepareBackup(version: string): Promise<void> {
    const safeVersion = version.replace(/[^0-9A-Za-z.-]/g, '-')
    await this.options.store.writeBackup(`before-update-${safeVersion}`)
  }

  private setError(error: unknown): void {
    log.error('Auto update failed', error)
    this.setState({
      status: 'error',
      message: '更新を確認できませんでした。ネットワークを確認し、時間を置いて再試行してください。',
      checkedAt: new Date().toISOString()
    })
  }

  private setState(patch: Partial<UpdateState>): void {
    this.state = { ...this.state, ...patch }
    this.options.emit(this.getState())
  }
}

function isEnabledSource(source: UpdateSource): boolean {
  if (source.provider === 'disabled') return false
  if (source.provider === 'github') {
    return /^[A-Za-z0-9_.-]+$/.test(source.owner) && /^[A-Za-z0-9_.-]+$/.test(source.repo)
  }
  if (source.provider === 'generic') {
    if (!source.url) return false
    try {
      return new URL(source.url).protocol === 'https:'
    } catch {
      return false
    }
  }
  return false
}

function updaterConfiguration(source: Exclude<UpdateSource, { provider: 'disabled' }>) {
  if (source.provider === 'github') {
    return { provider: 'github' as const, owner: source.owner, repo: source.repo }
  }
  return { provider: 'generic' as const, url: source.url }
}

function releaseNotesText(notes: UpdateInfo['releaseNotes']): string | undefined {
  if (typeof notes === 'string') return notes
  if (Array.isArray(notes)) {
    const value = notes.map((note) => note.note).filter(Boolean).join('\n')
    return value || undefined
  }
  return undefined
}

function clampPercent(value: number): number {
  return Math.min(100, Math.max(0, Math.round(value * 10) / 10))
}

function errorMessage(error: unknown): string {
  if (error instanceof Error) return error.message
  return '不明なエラー'
}

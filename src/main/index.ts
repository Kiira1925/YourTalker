import { join } from 'node:path'
import { readFile, stat, writeFile } from 'node:fs/promises'
import { app, BrowserWindow, dialog, ipcMain, nativeImage, shell } from 'electron'
import log from 'electron-log/main'
import {
  characterSchema,
  nonEmptyTextSchema,
  uuidSchema
} from '../shared/schemas'
import type { ImportMode, ModelProvider, ReasoningEffort } from '../shared/types'
import { OpenAIService } from './openai-service'
import { normalizeOllamaBaseUrl, OllamaClient } from './ollama-client'
import { SecretStore } from './secrets'
import { createCharacter, createConversation, JsonStore } from './store'
import { UpdateManager } from './updater'

let mainWindow: BrowserWindow | null = null
let store: JsonStore
let secrets: SecretStore
let openai: OpenAIService
let updates: UpdateManager

const MAX_AVATAR_SOURCE_BYTES = 15 * 1024 * 1024
const MAX_AVATAR_DIMENSION = 384

async function loadAvatarDataUrl(path: string): Promise<string> {
  const sourceStat = await stat(path)
  if (sourceStat.size > MAX_AVATAR_SOURCE_BYTES) {
    throw new Error('アイコン画像は15MB以下のものを選んでください。')
  }
  const source = nativeImage.createFromPath(path)
  if (source.isEmpty()) throw new Error('画像を読み込めませんでした。PNG、JPEG、WebP画像を選んでください。')
  const size = source.getSize()
  if (size.width <= 0 || size.height <= 0) throw new Error('画像のサイズを確認できませんでした。')
  const scale = Math.min(1, MAX_AVATAR_DIMENSION / Math.max(size.width, size.height))
  const image = scale < 1
    ? source.resize({
        width: Math.max(1, Math.round(size.width * scale)),
        height: Math.max(1, Math.round(size.height * scale)),
        quality: 'best'
      })
    : source
  const png = image.toPNG()
  if (png.length === 0) throw new Error('画像をPNGへ変換できませんでした。')
  return `data:image/png;base64,${png.toString('base64')}`
}

function createWindow(): void {
  mainWindow = new BrowserWindow({
    width: 1480,
    height: 900,
    minWidth: 1080,
    minHeight: 680,
    show: false,
    backgroundColor: '#f4f1eb',
    title: 'YourTalker',
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true
    }
  })
  mainWindow.once('ready-to-show', () => mainWindow?.show())
  mainWindow.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))
  mainWindow.webContents.on('preload-error', (_event, preloadPath, error) => {
    log.error('Preload script failed', preloadPath, error)
  })
  mainWindow.webContents.on('did-fail-load', (_event, errorCode, errorDescription, validatedURL) => {
    log.error('Renderer failed to load', { errorCode, errorDescription, validatedURL })
  })
  mainWindow.webContents.on('render-process-gone', (_event, details) => {
    log.error('Renderer process exited', details)
  })

  if (process.env.NODE_ENV === 'development' && process.env.ELECTRON_RENDERER_URL) {
    void mainWindow.loadURL(process.env.ELECTRON_RENDERER_URL)
  } else {
    void mainWindow.loadFile(join(__dirname, '../renderer/index.html'))
  }
}

async function bootstrap() {
  return {
    ...(await store.bootstrap(await secrets.has())),
    update: updates.getState()
  }
}

function registerIpc(): void {
  ipcMain.handle('bootstrap', bootstrap)

  ipcMain.handle('character:create', async () => {
    const character = await store.saveCharacter(createCharacter())
    await store.patchSettings({ selectedCharacterId: character.id, selectedConversationId: undefined })
    return character
  })
  ipcMain.handle('character:save', async (_event, raw) => {
    const incoming = characterSchema.parse(raw)
    const current = await store.getCharacter(incoming.id)
    return store.saveCharacter({ ...incoming, avatarDataUrl: current.avatarDataUrl })
  })
  ipcMain.handle('character:select-avatar', async (_event, rawId) => {
    const id = uuidSchema.parse(rawId)
    const character = await store.getCharacter(id)
    const result = await dialog.showOpenDialog(mainWindow!, {
      title: `${character.name}のアイコン画像を選択`,
      properties: ['openFile'],
      filters: [
        { name: '画像', extensions: ['png', 'jpg', 'jpeg', 'webp'] }
      ]
    })
    if (result.canceled || result.filePaths.length === 0) return null
    const avatarDataUrl = await loadAvatarDataUrl(result.filePaths[0])
    return store.saveCharacter({ ...character, avatarDataUrl })
  })
  ipcMain.handle('character:clear-avatar', async (_event, rawId) => {
    const character = await store.getCharacter(uuidSchema.parse(rawId))
    const { avatarDataUrl: _avatarDataUrl, ...withoutAvatar } = character
    return store.saveCharacter(withoutAvatar)
  })
  ipcMain.handle('character:analyze-description', async (_event, rawId, rawDescription, rawMode) => {
    const mode = rawMode as 'overwrite' | 'fill-empty'
    if (!['overwrite', 'fill-empty'].includes(mode)) throw new Error('反映方法が不正です。')
    return openai.analyzeCharacterDescription(
      uuidSchema.parse(rawId),
      nonEmptyTextSchema.parse(rawDescription),
      mode
    )
  })
  ipcMain.handle('character:remove', async (_event, rawId) => {
    await store.deleteCharacter(uuidSchema.parse(rawId))
    return bootstrap()
  })

  ipcMain.handle('conversation:create', async (_event, rawCharacterId) => {
    const characterId = uuidSchema.parse(rawCharacterId)
    await store.getCharacter(characterId)
    const conversation = await store.saveConversation(createConversation(characterId))
    await store.patchSettings({ selectedCharacterId: characterId, selectedConversationId: conversation.id })
    return conversation
  })
  ipcMain.handle('conversation:remove', async (_event, rawId) => {
    const id = uuidSchema.parse(rawId)
    await store.deleteConversation(id)
    const settings = await store.getSettings()
    if (settings.selectedConversationId === id) await store.patchSettings({ selectedConversationId: undefined })
    return bootstrap()
  })

  ipcMain.handle('chat:send', async (_event, rawConversationId, rawContent, rawRetryMessageId) => {
    const conversationId = uuidSchema.parse(rawConversationId)
    const content = nonEmptyTextSchema.parse(rawContent)
    const retryMessageId = rawRetryMessageId ? uuidSchema.parse(rawRetryMessageId) : undefined
    return { requestId: await openai.startChat(conversationId, content, retryMessageId) }
  })
  ipcMain.handle('chat:cancel', (_event, rawRequestId) => openai.cancel(uuidSchema.parse(rawRequestId)))

  ipcMain.handle('correction:apply', async (_event, rawConversationId, rawMessageId, rawFeedback) => {
    await openai.applyCorrection(
      uuidSchema.parse(rawConversationId),
      uuidSchema.parse(rawMessageId),
      nonEmptyTextSchema.parse(rawFeedback)
    )
    return bootstrap()
  })
  ipcMain.handle('correction:toggle', async (_event, rawCharacterId, rawCorrectionId, rawActive) => {
    if (typeof rawActive !== 'boolean') throw new Error('activeは真偽値で指定してください。')
    await openai.toggleCorrection(uuidSchema.parse(rawCharacterId), uuidSchema.parse(rawCorrectionId), rawActive)
    return bootstrap()
  })

  ipcMain.handle('settings:save', async (_event, rawPatch) => {
    const patch = rawPatch as {
      modelProvider?: ModelProvider
      model?: string
      reasoningEffort?: ReasoningEffort
      ollamaBaseUrl?: string
      ollamaModel?: string
      ollamaRuleReview?: boolean
      selectedCharacterId?: string
      selectedConversationId?: string
    }
    if (patch.modelProvider !== undefined && !['openai', 'ollama'].includes(patch.modelProvider)) {
      throw new Error('生成方法が不正です。')
    }
    if (patch.model !== undefined) nonEmptyTextSchema.parse(patch.model)
    if (patch.ollamaBaseUrl !== undefined) patch.ollamaBaseUrl = normalizeOllamaBaseUrl(patch.ollamaBaseUrl)
    if (patch.ollamaModel !== undefined) {
      if (typeof patch.ollamaModel !== 'string' || patch.ollamaModel.length > 500) {
        throw new Error('Ollamaモデル名が不正です。')
      }
      patch.ollamaModel = patch.ollamaModel.trim()
    }
    if (patch.ollamaRuleReview !== undefined && typeof patch.ollamaRuleReview !== 'boolean') {
      throw new Error('ローカルルール確認設定が不正です。')
    }
    if (patch.selectedCharacterId !== undefined) uuidSchema.parse(patch.selectedCharacterId)
    if (patch.selectedConversationId !== undefined) uuidSchema.parse(patch.selectedConversationId)
    if (patch.reasoningEffort !== undefined && !['none', 'low', 'medium', 'high'].includes(patch.reasoningEffort)) {
      throw new Error('推論強度が不正です。')
    }
    return store.patchSettings(patch)
  })

  ipcMain.handle('local-models:list', async (_event, rawBaseUrl) => {
    if (typeof rawBaseUrl !== 'string') throw new Error('Ollamaの接続先が不正です。')
    return new OllamaClient(rawBaseUrl).listModels()
  })

  ipcMain.handle('secret:set', async (_event, rawApiKey) => {
    const apiKey = nonEmptyTextSchema.parse(rawApiKey)
    if (!apiKey.startsWith('sk-')) throw new Error('OpenAI APIキーの形式を確認してください。')
    await secrets.set(apiKey)
    return true
  })
  ipcMain.handle('secret:remove', async () => {
    await secrets.remove()
    return true
  })

  ipcMain.handle('data:open-folder', async () => {
    const error = await shell.openPath(store.baseDir)
    if (error) throw new Error(error)
  })
  ipcMain.handle('data:export-full', () => exportBundle())
  ipcMain.handle('data:export-character', (_event, rawId) => exportBundle(uuidSchema.parse(rawId)))
  ipcMain.handle('data:import', async (_event, rawMode) => {
    const mode = rawMode as ImportMode
    if (!['merge', 'replace'].includes(mode)) throw new Error('インポート方式が不正です。')
    const result = await dialog.showOpenDialog(mainWindow!, {
      title: 'YourTalkerデータを読み込む',
      filters: [{ name: 'YourTalker JSON', extensions: ['json'] }],
      properties: ['openFile']
    })
    if (result.canceled || !result.filePaths[0]) return null
    const raw = JSON.parse(await readFile(result.filePaths[0], 'utf8'))
    await store.importBundle(raw, mode)
    return bootstrap()
  })

  ipcMain.handle('update:get-state', () => updates.getState())
  ipcMain.handle('update:check', () => updates.check(true))
  ipcMain.handle('update:install', () => updates.install())
}

async function exportBundle(characterId?: string): Promise<string | null> {
  const result = await dialog.showSaveDialog(mainWindow!, {
    title: characterId ? 'キャラクターを書き出す' : 'すべてのデータを書き出す',
    defaultPath: characterId ? 'yourtalker-character.json' : 'yourtalker-backup.json',
    filters: [{ name: 'YourTalker JSON', extensions: ['json'] }]
  })
  if (result.canceled || !result.filePath) return null
  await writeFile(result.filePath, `${JSON.stringify(await store.createExport(characterId), null, 2)}\n`, 'utf8')
  return result.filePath
}

app.whenReady().then(async () => {
  log.initialize()
  const dataDir = join(app.getPath('appData'), 'YourTalker', 'data')
  store = new JsonStore(dataDir)
  await store.init()
  secrets = new SecretStore(store.secretPath)
  openai = new OpenAIService(store, secrets, () => mainWindow)
  updates = new UpdateManager({
    store,
    currentVersion: app.getVersion(),
    source:
      __YOURTALKER_GITHUB_OWNER__ && __YOURTALKER_GITHUB_REPO__
        ? {
            provider: 'github',
            owner: __YOURTALKER_GITHUB_OWNER__,
            repo: __YOURTALKER_GITHUB_REPO__
          }
        : __YOURTALKER_UPDATE_URL__
          ? { provider: 'generic', url: __YOURTALKER_UPDATE_URL__ }
          : { provider: 'disabled' },
    isPackaged: app.isPackaged,
    emit: (state) => mainWindow?.webContents.send('update:event', state)
  })
  registerIpc()
  createWindow()
  updates.start()
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})

app.on('before-quit', () => updates?.stop())

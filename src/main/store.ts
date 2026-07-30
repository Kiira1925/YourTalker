import { randomUUID } from 'node:crypto'
import {
  copyFile,
  mkdir,
  open,
  readFile,
  readdir,
  rename,
  unlink,
  writeFile
} from 'node:fs/promises'
import { basename, join } from 'node:path'
import type { ZodType } from 'zod'
import {
  characterSchema,
  conversationSchema,
  exportBundleSchema,
  settingsSchema
} from '../shared/schemas'
import {
  SCHEMA_VERSION,
  type AppSettings,
  type BootstrapData,
  type CharacterProfile,
  type Conversation,
  type ExportBundle,
  type ImportMode
} from '../shared/types'

interface CorrectionJournal {
  id: string
  character: CharacterProfile
  conversation: Conversation
}

function now(): string {
  return new Date().toISOString()
}

function newBase(): { id: string; schemaVersion: number; createdAt: string; updatedAt: string } {
  const timestamp = now()
  return { id: randomUUID(), schemaVersion: SCHEMA_VERSION, createdAt: timestamp, updatedAt: timestamp }
}

export function createCharacter(): CharacterProfile {
  return {
    ...newBase(),
    name: '新しいキャラクター',
    callingName: '',
    overview: '',
    personality: '',
    values: '',
    world: '',
    relationship: '',
    speechStyle: '',
    catchphrases: '',
    likes: '',
    taboos: '',
    sampleDialogue: '',
    notes: '',
    learnedGuidance: '',
    corrections: []
  }
}

export function createConversation(characterId: string): Conversation {
  return {
    ...newBase(),
    characterId,
    title: '新しい会話',
    messages: [],
    summary: '',
    hasDisabledCorrectionImpact: false
  }
}

function createSettings(): AppSettings {
  return {
    ...newBase(),
    modelProvider: 'openai',
    model: 'gpt-5.6-terra',
    reasoningEffort: 'low',
    ollamaBaseUrl: 'http://127.0.0.1:11434',
    ollamaModel: ''
  }
}

export class JsonStore {
  readonly baseDir: string
  readonly charactersDir: string
  readonly conversationsDir: string
  readonly backupsDir: string
  readonly journalsDir: string
  readonly settingsPath: string
  readonly secretPath: string

  constructor(baseDir: string) {
    this.baseDir = baseDir
    this.charactersDir = join(baseDir, 'characters')
    this.conversationsDir = join(baseDir, 'conversations')
    this.backupsDir = join(baseDir, 'backups')
    this.journalsDir = join(baseDir, 'journals')
    this.settingsPath = join(baseDir, 'manifest.json')
    this.secretPath = join(baseDir, 'secrets.bin')
  }

  async init(): Promise<void> {
    await Promise.all([
      mkdir(this.charactersDir, { recursive: true }),
      mkdir(this.conversationsDir, { recursive: true }),
      mkdir(this.backupsDir, { recursive: true }),
      mkdir(this.journalsDir, { recursive: true })
    ])
    await this.recoverJournals()
    try {
      await this.getSettings()
    } catch {
      await this.saveSettings(createSettings())
    }
    await this.ensureDailyBackup()
  }

  private async atomicWrite(path: string, value: unknown): Promise<void> {
    const tempPath = `${path}.${randomUUID()}.tmp`
    const backupPath = `${path}.bak`
    const payload = `${JSON.stringify(value, null, 2)}\n`
    await writeFile(tempPath, payload, 'utf8')
    const handle = await open(tempPath, 'r+')
    await handle.sync()
    await handle.close()
    try {
      await copyFile(path, backupPath)
    } catch {
      // A new file has no previous version to preserve.
    }
    try {
      await rename(tempPath, path)
    } catch {
      try {
        await unlink(path)
      } catch {
        // Missing targets are expected for first writes.
      }
      await rename(tempPath, path)
    }
  }

  private async readValidated<T>(path: string, schema: ZodType<T>): Promise<T> {
    try {
      const value = JSON.parse(await readFile(path, 'utf8'))
      return schema.parse(value)
    } catch (error) {
      try {
        const backupPath = `${path}.bak`
        const backup = schema.parse(JSON.parse(await readFile(backupPath, 'utf8')))
        await this.atomicWrite(path, backup)
        return backup
      } catch {
        throw error
      }
    }
  }

  async getSettings(): Promise<AppSettings> {
    try {
      return await this.readValidated(this.settingsPath, settingsSchema)
    } catch {
      const settings = createSettings()
      await this.saveSettings(settings)
      return settings
    }
  }

  async saveSettings(settings: AppSettings): Promise<AppSettings> {
    const validated = settingsSchema.parse({ ...settings, updatedAt: now() })
    await this.atomicWrite(this.settingsPath, validated)
    return validated
  }

  async patchSettings(patch: Partial<AppSettings>): Promise<AppSettings> {
    const current = await this.getSettings()
    return this.saveSettings({ ...current, ...patch, id: current.id, createdAt: current.createdAt })
  }

  private async jsonFiles(directory: string): Promise<string[]> {
    return (await readdir(directory, { withFileTypes: true }))
      .filter((entry) => entry.isFile() && entry.name.endsWith('.json') && !entry.name.endsWith('.bak'))
      .map((entry) => join(directory, entry.name))
  }

  async listCharacters(): Promise<CharacterProfile[]> {
    const values = await Promise.all(
      (await this.jsonFiles(this.charactersDir)).map((path) => this.readValidated(path, characterSchema))
    )
    return values.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
  }

  async getCharacter(id: string): Promise<CharacterProfile> {
    return this.readValidated(join(this.charactersDir, `${id}.json`), characterSchema)
  }

  async saveCharacter(character: CharacterProfile): Promise<CharacterProfile> {
    const validated = characterSchema.parse({ ...character, updatedAt: now() })
    await this.atomicWrite(join(this.charactersDir, `${validated.id}.json`), validated)
    return validated
  }

  async listConversations(): Promise<Conversation[]> {
    const values = await Promise.all(
      (await this.jsonFiles(this.conversationsDir)).map((path) => this.readValidated(path, conversationSchema))
    )
    return values.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
  }

  async getConversation(id: string): Promise<Conversation> {
    return this.readValidated(join(this.conversationsDir, `${id}.json`), conversationSchema)
  }

  async saveConversation(conversation: Conversation): Promise<Conversation> {
    const validated = conversationSchema.parse({ ...conversation, updatedAt: now() })
    await this.atomicWrite(join(this.conversationsDir, `${validated.id}.json`), validated)
    return validated
  }

  async deleteConversation(id: string): Promise<void> {
    for (const suffix of ['', '.bak']) {
      try {
        await unlink(join(this.conversationsDir, `${id}.json${suffix}`))
      } catch {
        // Deleting a missing backup is harmless.
      }
    }
  }

  async deleteCharacter(id: string): Promise<void> {
    const conversations = await this.listConversations()
    for (const conversation of conversations.filter((item) => item.characterId === id)) {
      await this.deleteConversation(conversation.id)
    }
    for (const suffix of ['', '.bak']) {
      try {
        await unlink(join(this.charactersDir, `${id}.json${suffix}`))
      } catch {
        // Deleting a missing backup is harmless.
      }
    }
    const settings = await this.getSettings()
    await this.saveSettings({
      ...settings,
      selectedCharacterId: settings.selectedCharacterId === id ? undefined : settings.selectedCharacterId,
      selectedConversationId:
        conversations.some((item) => item.characterId === id && item.id === settings.selectedConversationId)
          ? undefined
          : settings.selectedConversationId
    })
  }

  async bootstrap(hasApiKey = false): Promise<Omit<BootstrapData, 'update'>> {
    const [settings, characters, conversations] = await Promise.all([
      this.getSettings(),
      this.listCharacters(),
      this.listConversations()
    ])
    return { settings, characters, conversations, hasApiKey, dataPath: this.baseDir }
  }

  async commitCorrection(character: CharacterProfile, conversation: Conversation): Promise<void> {
    const journal: CorrectionJournal = { id: randomUUID(), character, conversation }
    const journalPath = join(this.journalsDir, `${journal.id}.json`)
    await this.atomicWrite(journalPath, journal)
    await this.saveCharacter(character)
    await this.saveConversation(conversation)
    await unlink(journalPath)
  }

  private async recoverJournals(): Promise<void> {
    for (const path of await this.jsonFiles(this.journalsDir)) {
      try {
        const journal = JSON.parse(await readFile(path, 'utf8')) as CorrectionJournal
        const character = characterSchema.parse(journal.character)
        const conversation = conversationSchema.parse(journal.conversation)
        await this.saveCharacter(character)
        await this.saveConversation(conversation)
        await unlink(path)
      } catch {
        const failedName = join(this.journalsDir, `${basename(path)}.failed`)
        await rename(path, failedName)
      }
    }
  }

  async createExport(characterId?: string): Promise<ExportBundle> {
    const [settings, allCharacters, allConversations] = await Promise.all([
      this.getSettings(),
      this.listCharacters(),
      this.listConversations()
    ])
    const characters = characterId
      ? allCharacters.filter((character) => character.id === characterId)
      : allCharacters
    const characterIds = new Set(characters.map((character) => character.id))
    const conversations = allConversations.filter((conversation) => characterIds.has(conversation.characterId))
    const { selectedCharacterId: _selectedCharacterId, selectedConversationId: _selectedConversationId, ...safeSettings } =
      settings
    return exportBundleSchema.parse({
      ...newBase(),
      kind: characterId ? 'character' : 'full',
      appName: 'YourTalker',
      characters,
      conversations,
      settings: characterId ? undefined : safeSettings
    })
  }

  async writeBackup(reason = 'daily'): Promise<string> {
    const timestamp = now().replaceAll(':', '-')
    const path = join(this.backupsDir, `backup-${reason}-${timestamp}.json`)
    await this.atomicWrite(path, await this.createExport())
    const backups = (await this.jsonFiles(this.backupsDir)).sort().reverse()
    for (const oldPath of backups.slice(7)) {
      await unlink(oldPath)
      try {
        await unlink(`${oldPath}.bak`)
      } catch {
        // Old backups may not have a sidecar.
      }
    }
    return path
  }

  private async ensureDailyBackup(): Promise<void> {
    const settings = await this.getSettings()
    const today = now().slice(0, 10)
    if (settings.lastBackupDate === today) return
    await this.writeBackup('daily')
    await this.patchSettings({ lastBackupDate: today })
  }

  async importBundle(raw: unknown, mode: ImportMode): Promise<void> {
    const bundle = exportBundleSchema.parse(raw)
    await this.writeBackup(`before-import-${mode}`)
    if (mode === 'replace') {
      await this.removeJsonDataFiles()
      for (const character of bundle.characters) await this.saveCharacter(character)
      for (const conversation of bundle.conversations) await this.saveConversation(conversation)
      if (bundle.settings) {
        const current = await this.getSettings()
        await this.saveSettings({
          ...bundle.settings,
          id: current.id,
          schemaVersion: SCHEMA_VERSION,
          createdAt: current.createdAt,
          updatedAt: now()
        })
      }
      return
    }

    const remapped = remapBundle(bundle)
    for (const character of remapped.characters) await this.saveCharacter(character)
    for (const conversation of remapped.conversations) await this.saveConversation(conversation)
  }

  private async removeJsonDataFiles(): Promise<void> {
    for (const path of [...(await this.jsonFiles(this.charactersDir)), ...(await this.jsonFiles(this.conversationsDir))]) {
      await unlink(path)
      try {
        await unlink(`${path}.bak`)
      } catch {
        // Missing sidecars are expected.
      }
    }
  }
}

function remapBundle(bundle: ExportBundle): ExportBundle {
  const characterIds = new Map(bundle.characters.map((character) => [character.id, randomUUID()]))
  const conversationIds = new Map(bundle.conversations.map((conversation) => [conversation.id, randomUUID()]))
  const messageIds = new Map(
    bundle.conversations.flatMap((conversation) => conversation.messages.map((message) => [message.id, randomUUID()] as const))
  )
  const correctionIds = new Map(
    bundle.characters.flatMap((character) => character.corrections.map((correction) => [correction.id, randomUUID()] as const))
  )
  const timestamp = now()

  const characters = bundle.characters.map((character) => ({
    ...character,
    id: characterIds.get(character.id)!,
    createdAt: timestamp,
    updatedAt: timestamp,
    corrections: character.corrections.map((correction) => ({
      ...correction,
      id: correctionIds.get(correction.id)!,
      ruleGroupId: correction.ruleGroupId
        ? correctionIds.get(correction.ruleGroupId) ?? correctionIds.get(correction.id)!
        : undefined,
      conversationId: conversationIds.get(correction.conversationId)!,
      messageId: messageIds.get(correction.messageId)!,
      createdAt: timestamp,
      updatedAt: timestamp
    }))
  }))
  const conversations = bundle.conversations.map((conversation) => ({
    ...conversation,
    id: conversationIds.get(conversation.id)!,
    characterId: characterIds.get(conversation.characterId)!,
    createdAt: timestamp,
    updatedAt: timestamp,
    summaryThroughMessageId: conversation.summaryThroughMessageId
      ? messageIds.get(conversation.summaryThroughMessageId)
      : undefined,
    messages: conversation.messages.map((message) => ({
      ...message,
      id: messageIds.get(message.id)!,
      correctionId: message.correctionId ? correctionIds.get(message.correctionId) : undefined,
      createdAt: timestamp,
      updatedAt: timestamp
    }))
  }))
  return { ...bundle, id: randomUUID(), createdAt: timestamp, updatedAt: timestamp, characters, conversations }
}

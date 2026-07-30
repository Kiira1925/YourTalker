import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { createCharacter, createConversation, JsonStore } from '../src/main/store'

const directories: string[] = []

afterEach(async () => {
  for (const directory of directories.splice(0)) {
    await rm(directory, { recursive: true, force: true })
  }
})

async function testStore(): Promise<JsonStore> {
  const directory = await mkdtemp(join(tmpdir(), 'yourtalker-test-'))
  directories.push(directory)
  const store = new JsonStore(directory)
  await store.init()
  return store
}

describe('JsonStore', () => {
  it('keeps characters and conversations separated', async () => {
    const store = await testStore()
    const a = await store.saveCharacter({ ...createCharacter(), name: 'A' })
    const b = await store.saveCharacter({ ...createCharacter(), name: 'B' })
    await store.saveConversation({ ...createConversation(a.id), title: 'Aの会話' })
    await store.saveConversation({ ...createConversation(b.id), title: 'Bの会話' })

    const conversations = await store.listConversations()
    expect(conversations.filter((item) => item.characterId === a.id).map((item) => item.title)).toEqual(['Aの会話'])
    expect(conversations.filter((item) => item.characterId === b.id).map((item) => item.title)).toEqual(['Bの会話'])
  })

  it('round-trips a full export without secrets', async () => {
    const source = await testStore()
    const character = await source.saveCharacter({ ...createCharacter(), name: 'エクスポート対象' })
    await source.saveConversation({ ...createConversation(character.id), title: '残したい会話' })
    await writeFile(source.secretPath, 'must-not-leak', 'utf8')

    const bundle = await source.createExport()
    const serialized = JSON.stringify(bundle)
    expect(serialized).not.toContain('must-not-leak')

    const destination = await testStore()
    await destination.importBundle(JSON.parse(serialized), 'replace')
    expect((await destination.listCharacters()).map((item) => item.name)).toContain('エクスポート対象')
    expect((await destination.listConversations()).map((item) => item.title)).toContain('残したい会話')
  })

  it('keeps merged rule groups connected when IDs are remapped during import', async () => {
    const source = await testStore()
    const character = { ...createCharacter(), name: '統合ルール付き' }
    const conversation = createConversation(character.id)
    const createdAt = new Date().toISOString()
    const firstMessageId = crypto.randomUUID()
    const secondMessageId = crypto.randomUUID()
    const firstCorrectionId = crypto.randomUUID()
    const secondCorrectionId = crypto.randomUUID()
    conversation.messages = [firstMessageId, secondMessageId].map((id) => ({
      id,
      schemaVersion: 1,
      createdAt,
      updatedAt: createdAt,
      role: 'assistant' as const,
      content: '修正版'
    }))
    character.corrections = [
      {
        id: firstCorrectionId,
        schemaVersion: 1,
        createdAt,
        updatedAt: createdAt,
        conversationId: conversation.id,
        messageId: firstMessageId,
        ruleGroupId: firstCorrectionId,
        feedbackText: '敬語を避けて',
        derivedRule: '親しい場面では敬語を避ける',
        originalReply: '元返答1',
        revisedReply: '修正版1',
        active: true
      },
      {
        id: secondCorrectionId,
        schemaVersion: 1,
        createdAt,
        updatedAt: createdAt,
        conversationId: conversation.id,
        messageId: secondMessageId,
        ruleGroupId: firstCorrectionId,
        feedbackText: '軽口も入れて',
        derivedRule: '親しい場面では敬語を避け、軽口を交える',
        originalReply: '元返答2',
        revisedReply: '修正版2',
        active: true
      }
    ]
    await source.saveCharacter(character)
    await source.saveConversation(conversation)

    const destination = await testStore()
    await destination.importBundle(await source.createExport(), 'merge')
    const imported = (await destination.listCharacters()).find((item) => item.name === '統合ルール付き')!

    expect(imported.corrections[0].id).not.toBe(firstCorrectionId)
    expect(imported.corrections[0].ruleGroupId).toBe(imported.corrections[0].id)
    expect(imported.corrections[1].ruleGroupId).toBe(imported.corrections[0].id)
  })

  it('restores a valid sidecar when the primary JSON is corrupted', async () => {
    const store = await testStore()
    const character = await store.saveCharacter({ ...createCharacter(), name: '初期名' })
    await store.saveCharacter({ ...character, name: '復旧できる名前' })
    const path = join(store.charactersDir, `${character.id}.json`)
    await writeFile(path, '{broken json', 'utf8')

    const recovered = await store.getCharacter(character.id)
    expect(recovered.name).toBe('初期名')
    expect(JSON.parse(await readFile(path, 'utf8')).name).toBe('初期名')
  })

  it('recovers an interrupted correction journal on startup', async () => {
    const store = await testStore()
    const character = { ...createCharacter(), name: 'ジャーナル復旧', learnedGuidance: '- 復旧済み' }
    const conversation = { ...createConversation(character.id), title: '復旧会話' }
    const journal = { id: crypto.randomUUID(), character, conversation }
    await writeFile(join(store.journalsDir, `${journal.id}.json`), JSON.stringify(journal), 'utf8')

    const reopened = new JsonStore(store.baseDir)
    await reopened.init()
    expect((await reopened.getCharacter(character.id)).learnedGuidance).toBe('- 復旧済み')
    expect((await reopened.getConversation(conversation.id)).title).toBe('復旧会話')
  })

  it('loads settings created before local model support with compatible defaults', async () => {
    const store = await testStore()
    const current = await store.getSettings()
    const legacy = { ...current } as Record<string, unknown>
    delete legacy.modelProvider
    delete legacy.ollamaBaseUrl
    delete legacy.ollamaModel
    delete legacy.ollamaRuleReview
    await writeFile(store.settingsPath, JSON.stringify(legacy), 'utf8')

    const migrated = await store.getSettings()

    expect(migrated.modelProvider).toBe('openai')
    expect(migrated.ollamaBaseUrl).toBe('http://127.0.0.1:11434')
    expect(migrated.ollamaModel).toBe('')
    expect(migrated.ollamaRuleReview).toBe(true)
  })
})

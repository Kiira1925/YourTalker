import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { BrowserWindow } from 'electron'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { ChatEvent } from '../src/shared/types'

const mocks = vi.hoisted(() => ({ create: vi.fn() }))

vi.mock('openai', () => {
  class AuthenticationError extends Error {}
  class RateLimitError extends Error {}
  class APIConnectionError extends Error {}
  class MockOpenAI {
    static AuthenticationError = AuthenticationError
    static RateLimitError = RateLimitError
    static APIConnectionError = APIConnectionError
    responses = { create: mocks.create }
  }
  return { default: MockOpenAI }
})

import { OpenAIService } from '../src/main/openai-service'
import { createCharacter, createConversation, JsonStore } from '../src/main/store'

const directories: string[] = []

beforeEach(() => mocks.create.mockReset())
afterEach(async () => {
  for (const directory of directories.splice(0)) await rm(directory, { recursive: true, force: true })
})

async function fixture() {
  const directory = await mkdtemp(join(tmpdir(), 'yourtalker-openai-test-'))
  directories.push(directory)
  const store = new JsonStore(directory)
  await store.init()
  const character = await store.saveCharacter({ ...createCharacter(), name: '宵', speechStyle: '短めのため口' })
  const conversation = await store.saveConversation(createConversation(character.id))
  const events: ChatEvent[] = []
  const window = {
    webContents: {
      send: (_channel: string, event: ChatEvent) => events.push(event)
    }
  } as unknown as BrowserWindow
  const secrets = { get: vi.fn().mockResolvedValue('sk-test') }
  const service = new OpenAIService(store, secrets as never, () => window)
  return { store, character, conversation, events, service }
}

async function* textStream(...parts: string[]) {
  for (const part of parts) yield { type: 'response.output_text.delta' as const, delta: part }
}

describe('OpenAIService', () => {
  it('streams deltas and commits only the completed assistant message', async () => {
    const { store, conversation, events, service } = await fixture()
    mocks.create.mockResolvedValue(textStream('おかえり。', '今日はどうしたの？'))

    await service.startChat(conversation.id, 'ただいま')
    await vi.waitFor(() => expect(events.some((event) => event.type === 'completed')).toBe(true))

    expect(events.filter((event) => event.type === 'delta')).toHaveLength(2)
    const saved = await store.getConversation(conversation.id)
    expect(saved.messages.map((message) => message.content)).toEqual([
      'ただいま',
      'おかえり。今日はどうしたの？'
    ])
  })

  it('keeps a failed user message retryable without duplicating it', async () => {
    const { store, conversation, events, service } = await fixture()
    mocks.create.mockRejectedValueOnce(new Error('temporary failure'))
    await service.startChat(conversation.id, '聞いてほしい')
    await vi.waitFor(() => expect(events.some((event) => event.type === 'error')).toBe(true))

    let saved = await store.getConversation(conversation.id)
    expect(saved.messages).toHaveLength(1)
    expect(saved.messages[0].status).toBe('failed')

    mocks.create.mockResolvedValueOnce(textStream('うん、', '聞くよ。'))
    await service.startChat(conversation.id, saved.messages[0].content, saved.messages[0].id)
    await vi.waitFor(() => expect(events.filter((event) => event.type === 'completed')).toHaveLength(1))

    saved = await store.getConversation(conversation.id)
    expect(saved.messages).toHaveLength(2)
    expect(saved.messages[0].status).toBe('complete')
  })

  it('stores the raw feedback, derived rule, original reply and revision together', async () => {
    const { store, character, conversation, service } = await fixture()
    mocks.create.mockResolvedValue(textStream('少し丁寧すぎる返事です。'))
    await service.startChat(conversation.id, '疲れた')
    await vi.waitFor(async () => expect((await store.getConversation(conversation.id)).messages).toHaveLength(2))

    const withReply = await store.getConversation(conversation.id)
    const assistant = withReply.messages[1]
    mocks.create.mockResolvedValueOnce({
      output_text: JSON.stringify({
        derivedRule: '親しい場面では敬語を避け、少し茶化してから気遣う',
        learnedGuidance: '- 親しい場面では敬語を避け、少し茶化してから気遣う',
        revisedReply: 'もうへばったの？ しょうがないな、少し休みなよ。'
      })
    })
    await service.applyCorrection(conversation.id, assistant.id, 'もっと親しく、少し茶化す感じで')

    const correctedCharacter = await store.getCharacter(character.id)
    const correctedConversation = await store.getConversation(conversation.id)
    expect(correctedCharacter.corrections[0]).toMatchObject({
      feedbackText: 'もっと親しく、少し茶化す感じで',
      originalReply: assistant.content,
      active: true
    })
    expect(correctedConversation.messages[1].content).toContain('もうへばったの？')
  })
})

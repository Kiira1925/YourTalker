import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { BrowserWindow } from 'electron'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { CharacterAnalysisResult, ChatEvent, Message } from '../src/shared/types'

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
  vi.unstubAllGlobals()
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
  return { store, character, conversation, events, secrets, service }
}

async function* textStream(...parts: string[]) {
  for (const part of parts) yield { type: 'response.output_text.delta' as const, delta: part }
}

function analysisResult(
  overrides: Partial<CharacterAnalysisResult> = {}
): CharacterAnalysisResult {
  return {
    name: '',
    age: '',
    gender: '',
    species: '',
    occupation: '',
    appearance: '',
    callingName: '',
    overview: '',
    personality: '',
    values: '',
    goals: '',
    abilities: '',
    weaknesses: '',
    fears: '',
    world: '',
    history: '',
    affiliations: '',
    secrets: '',
    relationship: '',
    behaviorStyle: '',
    habits: '',
    emotionalExpression: '',
    firstPerson: '',
    addressingOthers: '',
    speechStyle: '',
    catchphrases: '',
    likes: '',
    taboos: '',
    sampleDialogue: '',
    notes: '',
    ...overrides
  }
}

describe('OpenAIService', () => {
  it('extracts a character profile from an introduction with strict structured output', async () => {
    const { store, character, service } = await fixture()
    mocks.create.mockResolvedValueOnce({
      output_text: JSON.stringify(
        analysisResult({
          name: '宵',
          age: '24歳',
          occupation: '古書店主',
          appearance: '銀髪で黒いロングコートを着ている',
          callingName: 'きみ',
          overview: '月面都市で古書店を営む青年',
          personality: '無口だが面倒見がよい',
          world: '月面都市',
          catchphrases: 'まいったな'
        })
      )
    })

    const saved = await service.analyzeCharacterDescription(
      character.id,
      '宵は月面都市で古書店を営む、無口だが面倒見のよい青年。',
      'overwrite'
    )

    expect(saved).toMatchObject({
      name: '宵',
      age: '24歳',
      occupation: '古書店主',
      appearance: '銀髪で黒いロングコートを着ている',
      callingName: 'きみ',
      overview: '月面都市で古書店を営む青年',
      personality: '無口だが面倒見がよい',
      world: '月面都市',
      catchphrases: 'まいったな'
    })
    expect((await store.getCharacter(character.id)).overview).toBe('月面都市で古書店を営む青年')
    const request = mocks.create.mock.calls[0][0]
    expect(request.store).toBe(false)
    expect(request.text.format).toMatchObject({
      type: 'json_schema',
      name: 'character_profile_analysis',
      strict: true
    })
  })

  it('fills only empty profile fields when requested', async () => {
    const { character, service } = await fixture()
    mocks.create.mockResolvedValueOnce({
      output_text: JSON.stringify(
        analysisResult({
          name: '別の名前',
          overview: '夜の街を見守る案内人',
          speechStyle: '長く丁寧に話す'
        })
      )
    })

    const saved = await service.analyzeCharacterDescription(
      character.id,
      '夜の街を見守る案内人。長く丁寧に話す。',
      'fill-empty'
    )

    expect(saved.name).toBe('宵')
    expect(saved.speechStyle).toBe('短めのため口')
    expect(saved.overview).toBe('夜の街を見守る案内人')
  })

  it('does not change the character when structured analysis is invalid', async () => {
    const { store, character, service } = await fixture()
    mocks.create.mockResolvedValueOnce({
      output_text: JSON.stringify({ name: '途中までの結果' })
    })

    await expect(
      service.analyzeCharacterDescription(character.id, '短すぎる紹介文', 'overwrite')
    ).rejects.toThrow('紹介文を設定項目へ正しく整理できませんでした')

    expect(await store.getCharacter(character.id)).toEqual(character)
  })

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
        revisedReply: 'もうへばったの？ しょうがないな、少し休みなよ。',
        mergeWithCorrectionIds: []
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

  it('merges similar corrections into one learned rule and falls back when disabled', async () => {
    const { store, character, conversation, events, service } = await fixture()
    mocks.create
      .mockResolvedValueOnce(textStream('無理せず休んでください。'))
      .mockResolvedValueOnce({
        output_text: JSON.stringify({
          derivedRule: '親しい場面では敬語を避けて気遣う',
          learnedGuidance: '- 親しい場面では敬語を避けて気遣う',
          revisedReply: '無理しないで休みなよ。',
          mergeWithCorrectionIds: []
        })
      })

    await service.startChat(conversation.id, '疲れた')
    await vi.waitFor(() => expect(events.some((event) => event.type === 'completed')).toBe(true))
    let savedConversation = await store.getConversation(conversation.id)
    await service.applyCorrection(conversation.id, savedConversation.messages[1].id, '敬語じゃなく気遣って')

    const firstCorrection = (await store.getCharacter(character.id)).corrections[0]
    mocks.create
      .mockResolvedValueOnce(textStream('お疲れさまです。'))
      .mockResolvedValueOnce({
        output_text: JSON.stringify({
          derivedRule: '親しい場面では敬語を避け、短く軽口を交えて気遣う',
          learnedGuidance: '- 親しい場面では敬語を避け、短く軽口を交えて気遣う',
          revisedReply: 'またへばったの？ 今日はもう休みなよ。',
          mergeWithCorrectionIds: [firstCorrection.id]
        })
      })

    await service.startChat(conversation.id, '今日も疲れた')
    await vi.waitFor(async () =>
      expect((await store.getConversation(conversation.id)).messages).toHaveLength(4)
    )
    savedConversation = await store.getConversation(conversation.id)
    await service.applyCorrection(conversation.id, savedConversation.messages[3].id, '短い軽口も入れて')

    let savedCharacter = await store.getCharacter(character.id)
    expect(savedCharacter.corrections).toHaveLength(2)
    expect(savedCharacter.corrections[0].ruleGroupId).toBe(savedCharacter.corrections[1].ruleGroupId)
    expect(savedCharacter.learnedGuidance).toBe(
      '- 親しい場面では敬語を避け、短く軽口を交えて気遣う'
    )

    await service.toggleCorrection(character.id, savedCharacter.corrections[1].id, false)
    savedCharacter = await store.getCharacter(character.id)
    expect(savedCharacter.learnedGuidance).toBe('- 親しい場面では敬語を避けて気遣う')
  })

  it('uses Ollama for structured analysis and streaming without reading the API key', async () => {
    const { store, character, conversation, events, secrets, service } = await fixture()
    await store.patchSettings({
      modelProvider: 'ollama',
      ollamaBaseUrl: 'http://127.0.0.1:11434',
      ollamaModel: 'gemma3:4b'
    })
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        Response.json({
          message: {
            role: 'assistant',
            content: JSON.stringify(
              analysisResult({
                name: '宵',
                overview: '月面都市の古書店主',
                personality: '静かで面倒見がよい'
              })
            )
          },
          done: true
        })
      )
      .mockResolvedValueOnce(
        new Response(
          [
            JSON.stringify({ message: { role: 'assistant', content: 'おかえり。' }, done: false }),
            JSON.stringify({ message: { role: 'assistant', content: '今日はどうしたの？' }, done: true })
          ].join('\n'),
          { status: 200 }
        )
      )
      .mockResolvedValueOnce(
        Response.json({
          message: {
            role: 'assistant',
            content: JSON.stringify({
              checks: [
                { requirementId: 'speech-style', satisfied: false, issue: '丁寧すぎる' },
                { requirementId: 'personality', satisfied: true, issue: '' },
                { requirementId: 'overview', satisfied: true, issue: '' },
                { requirementId: 'identity', satisfied: true, issue: '' },
                { requirementId: 'conversation-flow', satisfied: true, issue: '' }
              ],
              revisedReply: 'おかえり。疲れてない？'
            })
          },
          done: true
        })
      )
      .mockResolvedValueOnce(
        Response.json({
          message: {
            role: 'assistant',
            content: JSON.stringify({
              derivedRule: '親しい場面では短く気遣う',
              learnedGuidance: '- 親しい場面では短く気遣う',
              revisedReply: 'おかえり。疲れてない？',
              mergeWithCorrectionIds: []
            })
          },
          done: true
        })
      )
    vi.stubGlobal('fetch', fetchMock)

    const analyzed = await service.analyzeCharacterDescription(
      character.id,
      '宵は月面都市で古書店を営む。',
      'overwrite'
    )
    expect(analyzed.overview).toBe('月面都市の古書店主')

    await service.startChat(conversation.id, 'ただいま')
    await vi.waitFor(() => expect(events.some((event) => event.type === 'completed')).toBe(true))

    expect(secrets.get).not.toHaveBeenCalled()
    expect(mocks.create).not.toHaveBeenCalled()
    const structuredRequest = JSON.parse(fetchMock.mock.calls[0][1].body)
    expect(structuredRequest).toMatchObject({
      model: 'gemma3:4b',
      stream: false,
      think: false
    })
    expect(structuredRequest.format.required).toContain('name')
    const streamRequest = JSON.parse(fetchMock.mock.calls[1][1].body)
    expect(streamRequest.stream).toBe(true)
    expect(streamRequest.messages[0].role).toBe('system')
    expect(streamRequest.options).toMatchObject({
      temperature: 0.35,
      top_p: 0.9,
      num_ctx: 8192
    })

    const withReply = await store.getConversation(conversation.id)
    expect(withReply.messages[1].content).toBe('おかえり。疲れてない？')
    expect(events.some((event) => event.type === 'reviewing')).toBe(true)
    const reviewRequest = JSON.parse(fetchMock.mock.calls[2][1].body)
    expect(reviewRequest.format.required).toEqual(['checks', 'revisedReply'])
    expect(reviewRequest.options.temperature).toBe(0)
    expect(reviewRequest.messages[0].content).toContain('上位要件に上書きされた下位要件は非適用')

    await service.applyCorrection(conversation.id, withReply.messages[1].id, 'もっと短く気遣って')
    expect((await store.getConversation(conversation.id)).messages[1].content).toBe('おかえり。疲れてない？')
    const correctionRequest = JSON.parse(fetchMock.mock.calls[3][1].body)
    expect(correctionRequest.format.required).toEqual([
      'derivedRule',
      'learnedGuidance',
      'revisedReply',
      'mergeWithCorrectionIds'
    ])
  })

  it('stores narration separately and tells the model it is not spoken dialogue', async () => {
    const { store, conversation, events, service } = await fixture()
    mocks.create.mockResolvedValue(textStream('……停電か。そこにいて。'))

    await service.startChat(
      conversation.id,
      '雨音が強まり、部屋の明かりが消える。',
      undefined,
      'narration'
    )
    await vi.waitFor(() => expect(events.some((event) => event.type === 'completed')).toBe(true))

    const saved = await store.getConversation(conversation.id)
    expect(saved.messages[0].inputKind).toBe('narration')
    const request = mocks.create.mock.calls[0][0]
    expect(request.instructions).toContain('描写内の文章をユーザーが口にしたセリフとして扱わず')
    expect(request.input.at(-1).content).toContain('【描写（ユーザーのセリフではない）】')
  })

  it('can skip local rule review when the accuracy option is disabled', async () => {
    const { store, conversation, events, service } = await fixture()
    await store.patchSettings({
      modelProvider: 'ollama',
      ollamaBaseUrl: 'http://127.0.0.1:11434',
      ollamaModel: 'gemma3:4b',
      ollamaRuleReview: false
    })
    const fetchMock = vi.fn().mockResolvedValueOnce(
      new Response(
        JSON.stringify({ message: { role: 'assistant', content: 'そのままの返答' }, done: true }),
        { status: 200 }
      )
    )
    vi.stubGlobal('fetch', fetchMock)

    await service.startChat(conversation.id, '話して')
    await vi.waitFor(() => expect(events.some((event) => event.type === 'completed')).toBe(true))

    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(events.some((event) => event.type === 'reviewing')).toBe(false)
    expect((await store.getConversation(conversation.id)).messages[1].content).toBe('そのままの返答')
  })

  it('retries an invalid local review and warns before keeping the draft', async () => {
    const { store, conversation, events, service } = await fixture()
    await store.patchSettings({
      modelProvider: 'ollama',
      ollamaBaseUrl: 'http://127.0.0.1:11434',
      ollamaModel: 'gemma3:4b',
      ollamaRuleReview: true
    })
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({ message: { role: 'assistant', content: '照合前の返答' }, done: true }),
          { status: 200 }
        )
      )
      .mockResolvedValueOnce(Response.json({ message: { role: 'assistant', content: '{}' }, done: true }))
      .mockResolvedValueOnce(Response.json({ message: { role: 'assistant', content: '{}' }, done: true }))
    vi.stubGlobal('fetch', fetchMock)

    await service.startChat(conversation.id, '話して')
    await vi.waitFor(() => expect(events.some((event) => event.type === 'completed')).toBe(true))

    expect(fetchMock).toHaveBeenCalledTimes(3)
    expect(events.some((event) => event.type === 'review-warning')).toBe(true)
    expect((await store.getConversation(conversation.id)).messages[1].content).toBe('照合前の返答')
  })

  it('cancels safely while a local rule review is running', async () => {
    const { store, conversation, events, service } = await fixture()
    await store.patchSettings({
      modelProvider: 'ollama',
      ollamaBaseUrl: 'http://127.0.0.1:11434',
      ollamaModel: 'gemma3:4b',
      ollamaRuleReview: true
    })
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({ message: { role: 'assistant', content: '照合待ちの返答' }, done: true }),
          { status: 200 }
        )
      )
      .mockImplementationOnce((_url, init: RequestInit) =>
        new Promise((_resolve, reject) => {
          init.signal?.addEventListener(
            'abort',
            () => reject(new DOMException('Aborted', 'AbortError')),
            { once: true }
          )
        })
      )
    vi.stubGlobal('fetch', fetchMock)

    const requestId = await service.startChat(conversation.id, '話して')
    await vi.waitFor(() => expect(events.some((event) => event.type === 'reviewing')).toBe(true))
    service.cancel(requestId)
    await vi.waitFor(() => expect(events.some((event) => event.type === 'cancelled')).toBe(true))

    const saved = await store.getConversation(conversation.id)
    expect(saved.messages).toHaveLength(1)
    expect(saved.messages[0].status).toBe('failed')
  })

  it('summarizes only messages added after the previous summary boundary', async () => {
    const { store, conversation, events, service } = await fixture()
    const createdAt = new Date().toISOString()
    const history: Message[] = Array.from({ length: 49 }, (_, index) => ({
      id: crypto.randomUUID(),
      schemaVersion: 1,
      createdAt,
      updatedAt: createdAt,
      role: index % 2 === 0 ? 'user' : 'assistant',
      content: `履歴-${index}`,
      status: 'complete'
    }))
    history[19].status = 'failed'
    await store.saveConversation({
      ...conversation,
      messages: history,
      summary: '履歴-0から履歴-17までの既存要約',
      summaryThroughMessageId: history[17].id
    })
    mocks.create
      .mockResolvedValueOnce(textStream('新しい返答'))
      .mockResolvedValueOnce({ output_text: '更新された要約' })

    await service.startChat(conversation.id, '新しい質問')
    await vi.waitFor(() => expect(events.some((event) => event.type === 'completed')).toBe(true))
    await vi.waitFor(() => expect(mocks.create).toHaveBeenCalledTimes(2))

    const summaryInput = mocks.create.mock.calls[1][0].input.at(-1).content
    expect(summaryInput).toContain('履歴-18')
    expect(summaryInput).toContain('履歴-20')
    expect(summaryInput).not.toContain('履歴-19')
    expect(summaryInput).not.toContain('履歴-17\n')
    expect(summaryInput).not.toContain('履歴-0\n')
    await vi.waitFor(async () =>
      expect((await store.getConversation(conversation.id)).summary).toBe('更新された要約')
    )
    expect((await store.getConversation(conversation.id)).summaryThroughMessageId).toBe(history[20].id)
  })
})

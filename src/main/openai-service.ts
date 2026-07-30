import { randomUUID } from 'node:crypto'
import OpenAI from 'openai'
import type { BrowserWindow } from 'electron'
import { characterAnalysisResultSchema, correctionResultSchema } from '../shared/schemas'
import {
  SCHEMA_VERSION,
  type CharacterAnalysisMode,
  type CharacterAnalysisResult,
  type CharacterProfile,
  type ChatEvent,
  type Conversation,
  type Correction,
  type CorrectionResult,
  type Message,
  type AppSettings
} from '../shared/types'
import {
  activeRuleCorrections,
  applyCorrectionState,
  compileCharacterInstructions,
  conversationInput,
  rebuildLearnedGuidance
} from './domain'
import { OllamaClient, type OllamaMessage } from './ollama-client'
import type { SecretStore } from './secrets'
import type { JsonStore } from './store'

function timestamp(): string {
  return new Date().toISOString()
}

function newMessage(role: 'user' | 'assistant', content: string): Message {
  const createdAt = timestamp()
  return {
    id: randomUUID(),
    schemaVersion: SCHEMA_VERSION,
    createdAt,
    updatedAt: createdAt,
    role,
    content,
    status: 'complete'
  }
}

function friendlyError(error: unknown): string {
  if (error instanceof OpenAI.AuthenticationError) return 'APIキーが正しくありません。設定を確認してください。'
  if (error instanceof OpenAI.RateLimitError) return 'OpenAI APIの利用上限に達しました。少し待ってから再試行してください。'
  if (error instanceof OpenAI.APIConnectionError) return 'OpenAI APIへ接続できません。ネットワークを確認してください。'
  if (error instanceof Error && error.name === 'AbortError') return '生成を中止しました。'
  if (error instanceof Error) return error.message
  return '予期しないエラーが発生しました。'
}

const characterAnalysisProperties = {
  name: { type: 'string', description: 'キャラクターの名前' },
  callingName: { type: 'string', description: 'キャラクターがユーザーを呼ぶときの呼称' },
  overview: { type: 'string', description: 'キャラクター像を短くまとめた概要' },
  personality: { type: 'string', description: '性格、感情傾向、対人態度' },
  values: { type: 'string', description: '大切にする価値観、判断基準、信念' },
  world: { type: 'string', description: '背景、経歴、時代、場所、所属する世界観' },
  relationship: { type: 'string', description: 'キャラクターとユーザーの関係' },
  speechStyle: { type: 'string', description: '語尾、敬語、テンポ、文量などの話し方' },
  catchphrases: { type: 'string', description: '紹介文に示された口癖や特徴的な言い回し' },
  likes: { type: 'string', description: '好き嫌い、趣味、得意不得意' },
  taboos: { type: 'string', description: '避ける話題、言動、表現、してはいけないこと' },
  sampleDialogue: { type: 'string', description: '紹介文中の台詞や明確な会話例' },
  notes: { type: 'string', description: '他の項目に当てはまらない重要な補足' }
} satisfies Record<keyof CharacterAnalysisResult, { type: 'string'; description: string }>

const characterAnalysisKeys = Object.keys(
  characterAnalysisProperties
) as Array<keyof CharacterAnalysisResult>

const characterAnalysisJsonSchema = {
  type: 'object',
  additionalProperties: false,
  properties: characterAnalysisProperties,
  required: characterAnalysisKeys
}

const correctionJsonSchema = {
  type: 'object',
  additionalProperties: false,
  properties: {
    derivedRule: { type: 'string' },
    learnedGuidance: { type: 'string' },
    revisedReply: { type: 'string' },
    mergeWithCorrectionIds: {
      type: 'array',
      items: { type: 'string' }
    }
  },
  required: ['derivedRule', 'learnedGuidance', 'revisedReply', 'mergeWithCorrectionIds']
}

type CompletionMessage = { role: 'user' | 'assistant'; content: string }

function formatMergeCandidates(corrections: Correction[]): string {
  const activeRules = activeRuleCorrections(corrections)
  if (activeRules.length === 0) return 'なし'
  return activeRules
    .map((correction) => `${correction.id}: ${correction.derivedRule.trim()}`)
    .join('\n')
}

export class OpenAIService {
  private readonly active = new Map<string, AbortController>()

  constructor(
    private readonly store: JsonStore,
    private readonly secrets: SecretStore,
    private readonly window: () => BrowserWindow | null
  ) {}

  private emit(event: ChatEvent): void {
    this.window()?.webContents.send('chat:event', event)
  }

  private requireOllamaModel(settings: AppSettings): string {
    const model = settings.ollamaModel.trim()
    if (!model) throw new Error('使用するOllamaモデルを設定してください。')
    return model
  }

  private async complete(
    settings: AppSettings,
    instructions: string,
    input: CompletionMessage[],
    options: {
      effort?: 'none' | 'low' | 'medium' | 'high'
      schema?: Record<string, unknown>
      schemaName?: string
    } = {}
  ): Promise<string> {
    if (settings.modelProvider === 'ollama') {
      const localInstructions = options.schema
        ? [
            instructions,
            '次のJSON Schemaに一致するJSONだけを返してください。説明文やMarkdownは付けないでください。',
            JSON.stringify(options.schema)
          ].join('\n\n')
        : instructions
      return new OllamaClient(settings.ollamaBaseUrl).chat({
        model: this.requireOllamaModel(settings),
        messages: [{ role: 'system', content: localInstructions }, ...input] satisfies OllamaMessage[],
        format: options.schema
      })
    }

    const client = new OpenAI({ apiKey: await this.secrets.get() })
    const response = await client.responses.create({
      model: settings.model,
      reasoning: { effort: options.effort ?? settings.reasoningEffort },
      instructions,
      input,
      ...(options.schema
        ? {
            text: {
              format: {
                type: 'json_schema' as const,
                name: options.schemaName ?? 'structured_response',
                strict: true,
                schema: options.schema
              }
            }
          }
        : {}),
      safety_identifier: settings.id,
      store: false
    })
    return response.output_text
  }

  private async streamCompletion(
    settings: AppSettings,
    instructions: string,
    input: CompletionMessage[],
    signal: AbortSignal,
    onDelta: (delta: string) => void
  ): Promise<string> {
    if (settings.modelProvider === 'ollama') {
      return new OllamaClient(settings.ollamaBaseUrl).streamChat({
        model: this.requireOllamaModel(settings),
        messages: [{ role: 'system', content: instructions }, ...input] satisfies OllamaMessage[],
        signal,
        onDelta
      })
    }

    const client = new OpenAI({ apiKey: await this.secrets.get() })
    const stream = await client.responses.create(
      {
        model: settings.model,
        reasoning: { effort: settings.reasoningEffort },
        instructions,
        input,
        safety_identifier: settings.id,
        store: false,
        stream: true
      },
      { signal }
    )
    let content = ''
    for await (const event of stream) {
      if (event.type === 'response.output_text.delta') {
        content += event.delta
        onDelta(event.delta)
      }
    }
    return content
  }

  async startChat(conversationId: string, content: string, retryMessageId?: string): Promise<string> {
    let conversation = await this.store.getConversation(conversationId)
    const existing = retryMessageId
      ? conversation.messages.find((message) => message.id === retryMessageId && message.role === 'user')
      : undefined
    const userMessage = existing
      ? { ...existing, content, status: 'complete' as const, updatedAt: timestamp() }
      : newMessage('user', content)

    conversation = {
      ...conversation,
      title:
        conversation.messages.length === 0
          ? content.replace(/\s+/g, ' ').trim().slice(0, 32) || '新しい会話'
          : conversation.title,
      messages: existing
        ? conversation.messages.map((message) => (message.id === existing.id ? userMessage : message))
        : [...conversation.messages, userMessage],
      updatedAt: timestamp()
    }
    conversation = await this.store.saveConversation(conversation)

    const requestId = randomUUID()
    const controller = new AbortController()
    this.active.set(requestId, controller)
    this.emit({ type: 'accepted', requestId, conversation })
    void this.runChat(requestId, conversation, userMessage.id, controller)
    return requestId
  }

  cancel(requestId: string): void {
    this.active.get(requestId)?.abort()
  }

  async analyzeCharacterDescription(
    characterId: string,
    description: string,
    mode: CharacterAnalysisMode
  ): Promise<CharacterProfile> {
    try {
      const [character, settings] = await Promise.all([
        this.store.getCharacter(characterId),
        this.store.getSettings()
      ])
      const output = await this.complete(
        settings,
        [
          'あなたはキャラクター紹介文を、会話AI用のキャラクター設定へ整理する編集者です。',
          '紹介文に明記された内容、または文脈から強く判断できる内容だけを抽出してください。',
          '情報がない項目は空文字にし、設定を創作・補完しないでください。',
          'callingNameはキャラクターがユーザーをどう呼ぶかです。キャラクター自身の別名ではありません。',
          'overviewは人物像を短く要約し、その他の項目は会話生成に役立つ具体的な表現にしてください。',
          'sampleDialogueには紹介文中の台詞や、明確に示された話し方の例だけを入れてください。'
        ].join('\n'),
        [{ role: 'user', content: description }],
        {
          effort: 'low',
          schema: characterAnalysisJsonSchema,
          schemaName: 'character_profile_analysis'
        }
      )

      let analysis: CharacterAnalysisResult
      try {
        analysis = characterAnalysisResultSchema.parse(JSON.parse(output))
      } catch {
        throw new Error('紹介文を設定項目へ正しく整理できませんでした。もう一度お試しください。')
      }
      if (!characterAnalysisKeys.some((key) => analysis[key].trim())) {
        throw new Error('紹介文から設定に使える内容を読み取れませんでした。文章を追加してお試しください。')
      }

      const next: CharacterProfile = { ...character, updatedAt: timestamp() }
      for (const key of characterAnalysisKeys) {
        const value = analysis[key].trim()
        if (!value) continue
        if (mode === 'fill-empty' && character[key].trim()) continue
        next[key] = value
      }
      return this.store.saveCharacter(next)
    } catch (error) {
      throw new Error(friendlyError(error))
    }
  }

  private async runChat(
    requestId: string,
    conversation: Conversation,
    userMessageId: string,
    controller: AbortController
  ): Promise<void> {
    try {
      const [character, settings] = await Promise.all([
        this.store.getCharacter(conversation.characterId),
        this.store.getSettings()
      ])
      const content = await this.streamCompletion(
        settings,
        compileCharacterInstructions(character),
        conversationInput(conversation),
        controller.signal,
        (delta) => this.emit({ type: 'delta', requestId, delta })
      )

      if (!content.trim()) throw new Error('空の応答が返されました。')

      const fresh = await this.store.getConversation(conversation.id)
      const assistantMessage = newMessage('assistant', content)
      const completed = await this.store.saveConversation({
        ...fresh,
        messages: [...fresh.messages, assistantMessage],
        updatedAt: timestamp()
      })
      this.emit({ type: 'completed', requestId, conversation: completed })
      void this.summarizeIfNeeded(completed, character)
    } catch (error) {
      const fresh = await this.store.getConversation(conversation.id)
      const failed = await this.store.saveConversation({
        ...fresh,
        messages: fresh.messages.map((message) =>
          message.id === userMessageId ? { ...message, status: 'failed' as const, updatedAt: timestamp() } : message
        ),
        updatedAt: timestamp()
      })
      if (controller.signal.aborted) {
        this.emit({ type: 'cancelled', requestId, conversation: failed })
      } else {
        this.emit({ type: 'error', requestId, message: friendlyError(error), conversation: failed })
      }
    } finally {
      this.active.delete(requestId)
    }
  }

  private async summarizeIfNeeded(
    conversation: Conversation,
    character: CharacterProfile
  ): Promise<void> {
    if (conversation.messages.length < 50) return
    const olderMessages = conversation.messages.slice(0, -30)
    const lastIncluded = olderMessages.at(-1)
    if (!lastIncluded || conversation.summaryThroughMessageId === lastIncluded.id) return
    try {
      const settings = await this.store.getSettings()
      const summary = await this.complete(
        settings,
        '会話継続用の簡潔な日本語要約を作成してください。関係性、出来事、約束、感情の変化、固有名詞を残し、話し方の模倣は不要です。',
        [
          ...(conversation.summary
            ? [{ role: 'user' as const, content: `既存の要約:\n${conversation.summary}` }]
            : []),
          {
            role: 'user' as const,
            content: olderMessages.map((message) => `${message.role === 'user' ? 'ユーザー' : character.name}: ${message.content}`).join('\n')
          }
        ],
        { effort: 'low' }
      )
      const current = await this.store.getConversation(conversation.id)
      await this.store.saveConversation({
        ...current,
        summary: summary.trim(),
        summaryThroughMessageId: lastIncluded.id,
        updatedAt: timestamp()
      })
    } catch {
      // Summarization is best-effort and must never break the chat.
    }
  }

  async applyCorrection(conversationId: string, messageId: string, feedback: string): Promise<void> {
    const conversation = await this.store.getConversation(conversationId)
    const character = await this.store.getCharacter(conversation.characterId)
    const message = conversation.messages.find((item) => item.id === messageId && item.role === 'assistant')
    if (!message) throw new Error('修正対象の返答が見つかりません。')
    const settings = await this.store.getSettings()
    const result = await this.generateCorrection(settings, character, conversation, message, feedback)
    const createdAt = timestamp()
    const correctionId = randomUUID()
    const requestedMergeIds = new Set(result.mergeWithCorrectionIds)
    const mergeTargets = character.corrections.filter(
      (item) => item.active && requestedMergeIds.has(item.id)
    )
    const mergedGroupIds = new Set(
      mergeTargets.map((item) => item.ruleGroupId ?? item.id)
    )
    const ruleGroupId = mergeTargets[0]?.ruleGroupId ?? mergeTargets[0]?.id ?? correctionId
    const correction: Correction = {
      id: correctionId,
      schemaVersion: SCHEMA_VERSION,
      createdAt,
      updatedAt: createdAt,
      conversationId,
      messageId,
      ruleGroupId,
      feedbackText: feedback,
      derivedRule: result.derivedRule,
      originalReply: message.content,
      revisedReply: result.revisedReply,
      active: true
    }
    const existingCorrections = character.corrections.map((item) =>
      mergedGroupIds.has(item.ruleGroupId ?? item.id)
        ? { ...item, ruleGroupId, updatedAt: createdAt }
        : item
    )
    const corrections = [...existingCorrections, correction]
    const nextCharacter: CharacterProfile = {
      ...character,
      corrections,
      learnedGuidance: rebuildLearnedGuidance(corrections),
      updatedAt: createdAt
    }
    const nextConversation: Conversation = {
      ...conversation,
      messages: conversation.messages.map((item) =>
        item.id === message.id
          ? {
              ...item,
              originalContent: item.originalContent ?? item.content,
              content: result.revisedReply,
              correctionId: correction.id,
              updatedAt: createdAt
            }
          : item
      ),
      updatedAt: createdAt
    }
    await this.store.commitCorrection(nextCharacter, nextConversation)
  }

  async toggleCorrection(characterId: string, correctionId: string, active: boolean): Promise<void> {
    const character = await this.store.getCharacter(characterId)
    const correction = character.corrections.find((item) => item.id === correctionId)
    if (!correction) throw new Error('指摘履歴が見つかりません。')
    const conversation = await this.store.getConversation(correction.conversationId)
    const next = applyCorrectionState(character, conversation, correctionId, active)
    await this.store.commitCorrection(next.character, next.conversation)
  }

  private async generateCorrection(
    settings: AppSettings,
    character: CharacterProfile,
    conversation: Conversation,
    message: Message,
    feedback: string
  ): Promise<CorrectionResult> {
    const output = await this.complete(
      settings,
      [
        'キャラクター会話へのユーザー指摘を、今後も適用できる簡潔なルールへ変換してください。',
        '既存ルール一覧のうち、新しい指摘と意味・目的・適用場面が近いものは統合してください。',
        '統合する場合、derivedRuleには既存ルールと新しい指摘の重要な内容を落とさず、一つの簡潔なルールとして書いてください。',
        'mergeWithCorrectionIdsには統合対象のIDだけを入れてください。近くないルールは統合せず、該当しない場合は空配列にしてください。',
        'learnedGuidanceには統合後のルール一覧全文を書いてください。',
        'revisedReplyは指摘を反映し、会話の流れとキャラクター設定に沿った返答だけを書いてください。'
      ].join('\n'),
      [
        {
          role: 'user',
          content: [
            `キャラクター設定:\n${compileCharacterInstructions(character)}`,
            `既存ルール一覧（IDはmergeWithCorrectionIdsへの指定専用）:\n${formatMergeCandidates(character.corrections)}`,
            `直前までの会話:\n${conversation.messages.slice(-10).map((item) => `${item.role}: ${item.content}`).join('\n')}`,
            `修正対象:\n${message.content}`,
            `ユーザーの指摘:\n${feedback}`
          ].join('\n\n')
        }
      ],
      { effort: 'low', schema: correctionJsonSchema, schemaName: 'character_correction' }
    )
    try {
      return correctionResultSchema.parse(JSON.parse(output))
    } catch {
      throw new Error('指摘内容を正しく構造化できませんでした。もう一度お試しください。')
    }
  }
}

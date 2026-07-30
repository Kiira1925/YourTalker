import { describe, expect, it } from 'vitest'
import type { CharacterProfile, Conversation, Correction, Message } from '../src/shared/types'
import {
  applyCorrectionState,
  compileCharacterInstructions,
  conversationInput,
  rebuildLearnedGuidance
} from '../src/main/domain'
import { createCharacter, createConversation } from '../src/main/store'

describe('character domain', () => {
  it('builds instructions from profile and learned guidance', () => {
    const character = {
      ...createCharacter(),
      name: '宵',
      personality: '落ち着いているが、親しい相手には少し意地悪',
      speechStyle: '短めのため口',
      learnedGuidance: '- 励ます前に、軽い冗談で緊張をほぐす'
    }
    const instructions = compileCharacterInstructions(character)
    expect(instructions).toContain('あなたは「宵」')
    expect(instructions).toContain('短めのため口')
    expect(instructions).toContain('軽い冗談')
    expect(instructions).toContain('必ず守る優先順位')
    expect(instructions.indexOf('会話から学習した最優先ルール')).toBeLessThan(
      instructions.indexOf('キャラクター設定')
    )
  })

  it('rebuilds guidance from active corrections only', () => {
    const base = correction()
    const disabled = { ...correction(), id: crypto.randomUUID(), derivedRule: '敬語にする', active: false }
    expect(rebuildLearnedGuidance([base, disabled])).toBe(`- ${base.derivedRule}`)
  })

  it('uses only the newest active correction from each merged rule group', () => {
    const groupId = crypto.randomUUID()
    const first = {
      ...correction(),
      ruleGroupId: groupId,
      derivedRule: '親しい場面では敬語を避ける',
      createdAt: '2026-01-01T00:00:00.000Z'
    }
    const merged = {
      ...correction(),
      ruleGroupId: groupId,
      derivedRule: '親しい場面では敬語を避け、軽口を交えて気遣う',
      createdAt: '2026-01-02T00:00:00.000Z'
    }

    expect(rebuildLearnedGuidance([first, merged])).toBe(`- ${merged.derivedRule}`)
    expect(rebuildLearnedGuidance([first, { ...merged, active: false }])).toBe(`- ${first.derivedRule}`)
  })

  it('keeps the newest message within a local context character budget', () => {
    const conversation = createConversation(crypto.randomUUID())
    conversation.messages = [
      message('user', '古い内容'.repeat(100)),
      message('assistant', '途中の内容'.repeat(100)),
      message('user', `最新の質問${'長文'.repeat(500)}`)
    ]

    const input = conversationInput(conversation, 30, 120)

    expect(input).toHaveLength(1)
    expect(input[0].content).toContain('最新の質問')
    expect(input[0].content.length).toBeLessThanOrEqual(120)
  })

  it('marks narration as scene context instead of spoken dialogue', () => {
    const conversation = createConversation(crypto.randomUUID())
    conversation.messages = [
      { ...message('user', '雨音が強まり、部屋の明かりが消える。'), inputKind: 'narration' }
    ]

    const input = conversationInput(conversation)

    expect(input[0].content).toContain('【描写（ユーザーのセリフではない）】')
    expect(input[0].content).toContain('雨音が強まり')
    expect(input[0].content).toContain('【描写ここまで】')
  })

  it('disables a correction without deleting its audit record', () => {
    const character = createCharacter()
    const conversation = createConversation(character.id)
    const assistant = message('assistant', '大丈夫ですよ。頑張ってください。')
    conversation.messages = [message('user', '緊張する'), assistant, message('user', 'ありがとう')]
    const item = {
      ...correction(),
      conversationId: conversation.id,
      messageId: assistant.id,
      originalReply: assistant.content,
      revisedReply: '珍しく弱気だね。でも、まあ君なら平気でしょ。'
    }
    character.corrections = [item]
    character.learnedGuidance = `- ${item.derivedRule}`
    assistant.originalContent = assistant.content
    assistant.content = item.revisedReply
    assistant.correctionId = item.id

    const result = applyCorrectionState(character, conversation, item.id, false)
    expect(result.character.corrections).toHaveLength(1)
    expect(result.character.corrections[0].active).toBe(false)
    expect(result.character.learnedGuidance).toBe('')
    expect(result.conversation.messages[1].content).toBe(item.originalReply)
    expect(result.conversation.hasDisabledCorrectionImpact).toBe(true)
  })
})

function message(role: Message['role'], content: string): Message {
  const createdAt = new Date().toISOString()
  return {
    id: crypto.randomUUID(),
    schemaVersion: 1,
    createdAt,
    updatedAt: createdAt,
    role,
    content,
    status: 'complete'
  }
}

function correction(): Correction {
  const createdAt = new Date().toISOString()
  return {
    id: crypto.randomUUID(),
    schemaVersion: 1,
    createdAt,
    updatedAt: createdAt,
    conversationId: crypto.randomUUID(),
    messageId: crypto.randomUUID(),
    feedbackText: 'かしこまりすぎ。冗談っぽくしてほしい。',
    derivedRule: '親しい場面では敬語を避け、軽い冗談を交える',
    originalReply: '承知しました。',
    revisedReply: 'はいはい、分かったって。',
    active: true
  }
}

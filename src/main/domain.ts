import type { CharacterProfile, Conversation, Correction, Message } from '../shared/types'

const profileLine = (label: string, value: string): string =>
  value.trim() ? `${label}: ${value.trim()}` : ''

export function compileCharacterInstructions(character: CharacterProfile): string {
  const profile = [
    profileLine('名前', character.name),
    profileLine('ユーザーからの呼称', character.callingName),
    profileLine('キャラクター概要', character.overview),
    profileLine('性格', character.personality),
    profileLine('価値観', character.values),
    profileLine('背景・世界観', character.world),
    profileLine('ユーザーとの関係', character.relationship),
    profileLine('話し方', character.speechStyle),
    profileLine('口癖', character.catchphrases),
    profileLine('好きなもの・苦手なもの', character.likes),
    profileLine('避けること', character.taboos),
    profileLine('会話例', character.sampleDialogue),
    profileLine('補足', character.notes)
  ].filter(Boolean)

  return [
    `あなたは「${character.name}」としてユーザーと自然に会話します。`,
    'メタな説明やAIとしての自己言及は、ユーザーが明示的に求めない限り避けてください。',
    '設定にない事実を無理に断定せず、キャラクターらしさを保った自然な反応を優先してください。',
    '',
    '## キャラクター設定',
    ...profile,
    '',
    '## 会話から学習した最優先の調整ルール',
    character.learnedGuidance.trim() || 'まだありません。'
  ].join('\n')
}

export function activeRuleCorrections(corrections: Correction[]): Correction[] {
  const newestActiveByGroup = new Map<string, Correction>()
  for (const correction of corrections) {
    if (!correction.active) continue
    const groupId = correction.ruleGroupId ?? correction.id
    const current = newestActiveByGroup.get(groupId)
    if (
      !current ||
      correction.createdAt.localeCompare(current.createdAt) > 0 ||
      (correction.createdAt === current.createdAt && correction.id.localeCompare(current.id) > 0)
    ) {
      newestActiveByGroup.set(groupId, correction)
    }
  }
  return [...newestActiveByGroup.values()].sort((a, b) => a.createdAt.localeCompare(b.createdAt))
}

export function rebuildLearnedGuidance(corrections: Correction[]): string {
  const rules = activeRuleCorrections(corrections)
    .map((correction) => `- ${correction.derivedRule.trim()}`)
  return rules.join('\n')
}

export function applyCorrectionState(
  character: CharacterProfile,
  conversation: Conversation,
  correctionId: string,
  active: boolean
): { character: CharacterProfile; conversation: Conversation } {
  const now = new Date().toISOString()
  const corrections = character.corrections.map((correction) =>
    correction.id === correctionId ? { ...correction, active, updatedAt: now } : correction
  )
  const target = corrections.find((correction) => correction.id === correctionId)
  if (!target) throw new Error('指摘履歴が見つかりません。')

  const activeForMessage = corrections
    .filter((correction) => correction.messageId === target.messageId && correction.active)
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
  const newestActive = activeForMessage[0]
  const targetMessageIndex = conversation.messages.findIndex((message) => message.id === target.messageId)

  const messages: Message[] = conversation.messages.map((message) => {
    if (message.id !== target.messageId) return message
    if (newestActive) {
      return {
        ...message,
        content: newestActive.revisedReply,
        originalContent: message.originalContent ?? target.originalReply,
        correctionId: newestActive.id,
        updatedAt: now
      }
    }
    const { correctionId: _correctionId, ...rest } = message
    return {
      ...rest,
      content: message.originalContent ?? target.originalReply,
      updatedAt: now
    }
  })

  return {
    character: {
      ...character,
      corrections,
      learnedGuidance: rebuildLearnedGuidance(corrections),
      updatedAt: now
    },
    conversation: {
      ...conversation,
      messages,
      hasDisabledCorrectionImpact:
        conversation.hasDisabledCorrectionImpact ||
        (!active && targetMessageIndex >= 0 && targetMessageIndex < conversation.messages.length - 1),
      updatedAt: now
    }
  }
}

export function conversationInput(conversation: Conversation): Array<{ role: 'user' | 'assistant'; content: string }> {
  const recent = conversation.messages
    .filter((message) => message.status !== 'failed')
    .slice(-40)
    .map((message) => ({ role: message.role, content: message.content }))

  if (!conversation.summary.trim()) return recent
  return [
    {
      role: 'user' as const,
      content: `これまでの会話の要約です。この内容を会話の背景として扱ってください。\n${conversation.summary}`
    },
    {
      role: 'assistant' as const,
      content: '分かりました。これまでの流れを踏まえて会話を続けます。'
    },
    ...recent
  ]
}

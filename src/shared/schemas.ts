import { z } from 'zod'
import { SCHEMA_VERSION } from './types'

const entityBase = {
  id: z.string().uuid(),
  schemaVersion: z.literal(SCHEMA_VERSION),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime()
}

export const correctionSchema = z.object({
  ...entityBase,
  conversationId: z.string().uuid(),
  messageId: z.string().uuid(),
  feedbackText: z.string().min(1),
  derivedRule: z.string().min(1),
  originalReply: z.string(),
  revisedReply: z.string(),
  active: z.boolean()
})

const characterAnalysisFields = {
  name: z.string(),
  callingName: z.string(),
  overview: z.string(),
  personality: z.string(),
  values: z.string(),
  world: z.string(),
  relationship: z.string(),
  speechStyle: z.string(),
  catchphrases: z.string(),
  likes: z.string(),
  taboos: z.string(),
  sampleDialogue: z.string(),
  notes: z.string()
}

export const characterAnalysisResultSchema = z.object(characterAnalysisFields)

export const characterSchema = z.object({
  ...entityBase,
  ...characterAnalysisFields,
  name: z.string().min(1),
  learnedGuidance: z.string(),
  corrections: z.array(correctionSchema)
})

export const messageSchema = z.object({
  ...entityBase,
  role: z.enum(['user', 'assistant']),
  content: z.string(),
  originalContent: z.string().optional(),
  correctionId: z.string().uuid().optional(),
  status: z.enum(['complete', 'failed']).optional()
})

export const conversationSchema = z.object({
  ...entityBase,
  characterId: z.string().uuid(),
  title: z.string(),
  messages: z.array(messageSchema),
  summary: z.string(),
  summaryThroughMessageId: z.string().uuid().optional(),
  hasDisabledCorrectionImpact: z.boolean()
})

export const settingsSchema = z.object({
  ...entityBase,
  selectedCharacterId: z.string().uuid().optional(),
  selectedConversationId: z.string().uuid().optional(),
  modelProvider: z.enum(['openai', 'ollama']).default('openai'),
  model: z.string().min(1),
  reasoningEffort: z.enum(['none', 'low', 'medium', 'high']),
  ollamaBaseUrl: z.string().default('http://127.0.0.1:11434'),
  ollamaModel: z.string().default(''),
  lastBackupDate: z.string().optional()
})

export const exportBundleSchema = z.object({
  ...entityBase,
  kind: z.enum(['full', 'character']),
  appName: z.literal('YourTalker'),
  characters: z.array(characterSchema),
  conversations: z.array(conversationSchema),
  settings: settingsSchema
    .omit({ selectedCharacterId: true, selectedConversationId: true })
    .optional()
})

export const correctionResultSchema = z.object({
  derivedRule: z.string().min(1),
  learnedGuidance: z.string(),
  revisedReply: z.string().min(1)
})

export const nonEmptyTextSchema = z.string().trim().min(1).max(20_000)
export const uuidSchema = z.string().uuid()

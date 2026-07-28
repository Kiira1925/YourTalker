export const SCHEMA_VERSION = 1

export type ReasoningEffort = 'none' | 'low' | 'medium' | 'high'
export type ExportKind = 'full' | 'character'
export type ImportMode = 'merge' | 'replace'
export type UpdateStatus =
  | 'disabled'
  | 'idle'
  | 'checking'
  | 'available'
  | 'downloading'
  | 'preparing'
  | 'downloaded'
  | 'not-available'
  | 'error'

export interface UpdateState {
  enabled: boolean
  currentVersion: string
  status: UpdateStatus
  availableVersion?: string
  releaseNotes?: string
  percent?: number
  transferred?: number
  total?: number
  bytesPerSecond?: number
  checkedAt?: string
  message?: string
}

export interface EntityBase {
  id: string
  schemaVersion: number
  createdAt: string
  updatedAt: string
}

export interface Correction extends EntityBase {
  conversationId: string
  messageId: string
  feedbackText: string
  derivedRule: string
  originalReply: string
  revisedReply: string
  active: boolean
}

export interface CharacterProfile extends EntityBase {
  name: string
  callingName: string
  overview: string
  personality: string
  values: string
  world: string
  relationship: string
  speechStyle: string
  catchphrases: string
  likes: string
  taboos: string
  sampleDialogue: string
  notes: string
  learnedGuidance: string
  corrections: Correction[]
}

export type MessageRole = 'user' | 'assistant'

export interface Message extends EntityBase {
  role: MessageRole
  content: string
  originalContent?: string
  correctionId?: string
  status?: 'complete' | 'failed'
}

export interface Conversation extends EntityBase {
  characterId: string
  title: string
  messages: Message[]
  summary: string
  summaryThroughMessageId?: string
  hasDisabledCorrectionImpact: boolean
}

export interface AppSettings extends EntityBase {
  selectedCharacterId?: string
  selectedConversationId?: string
  model: string
  reasoningEffort: ReasoningEffort
  lastBackupDate?: string
}

export interface ExportBundle extends EntityBase {
  kind: ExportKind
  appName: 'YourTalker'
  characters: CharacterProfile[]
  conversations: Conversation[]
  settings?: Omit<AppSettings, 'selectedCharacterId' | 'selectedConversationId'>
}

export interface BootstrapData {
  settings: AppSettings
  characters: CharacterProfile[]
  conversations: Conversation[]
  hasApiKey: boolean
  dataPath: string
  update: UpdateState
}

export interface CorrectionResult {
  derivedRule: string
  learnedGuidance: string
  revisedReply: string
}

export type ChatEvent =
  | { type: 'accepted'; requestId: string; conversation: Conversation }
  | { type: 'delta'; requestId: string; delta: string }
  | { type: 'completed'; requestId: string; conversation: Conversation }
  | { type: 'cancelled'; requestId: string; conversation: Conversation }
  | { type: 'error'; requestId: string; message: string; conversation: Conversation }

export interface YourTalkerApi {
  bootstrap(): Promise<BootstrapData>
  character: {
    create(): Promise<CharacterProfile>
    save(character: CharacterProfile): Promise<CharacterProfile>
    remove(characterId: string): Promise<BootstrapData>
  }
  conversation: {
    create(characterId: string): Promise<Conversation>
    remove(conversationId: string): Promise<BootstrapData>
  }
  chat: {
    send(conversationId: string, content: string, retryMessageId?: string): Promise<{ requestId: string }>
    cancel(requestId: string): Promise<void>
    onEvent(listener: (event: ChatEvent) => void): () => void
  }
  correction: {
    apply(conversationId: string, messageId: string, feedback: string): Promise<BootstrapData>
    toggle(characterId: string, correctionId: string, active: boolean): Promise<BootstrapData>
  }
  settings: {
    save(patch: { model?: string; reasoningEffort?: ReasoningEffort; selectedCharacterId?: string; selectedConversationId?: string }): Promise<AppSettings>
  }
  secret: {
    set(apiKey: string): Promise<boolean>
    remove(): Promise<boolean>
  }
  data: {
    openFolder(): Promise<void>
    exportFull(): Promise<string | null>
    exportCharacter(characterId: string): Promise<string | null>
    importBundle(mode: ImportMode): Promise<BootstrapData | null>
  }
  updates: {
    getState(): Promise<UpdateState>
    check(): Promise<UpdateState>
    install(): Promise<void>
    onState(listener: (state: UpdateState) => void): () => void
  }
}

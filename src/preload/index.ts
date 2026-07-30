import { contextBridge, ipcRenderer } from 'electron'
import type {
  CharacterProfile,
  CharacterAnalysisMode,
  ChatEvent,
  ImportMode,
  ModelProvider,
  ReasoningEffort,
  UserInputKind,
  UpdateState,
  YourTalkerApi
} from '../shared/types'

const api: YourTalkerApi = {
  bootstrap: () => ipcRenderer.invoke('bootstrap'),
  character: {
    create: () => ipcRenderer.invoke('character:create'),
    save: (character: CharacterProfile) => ipcRenderer.invoke('character:save', character),
    selectAvatar: (characterId: string) => ipcRenderer.invoke('character:select-avatar', characterId),
    clearAvatar: (characterId: string) => ipcRenderer.invoke('character:clear-avatar', characterId),
    analyzeDescription: (characterId: string, description: string, mode: CharacterAnalysisMode) =>
      ipcRenderer.invoke('character:analyze-description', characterId, description, mode),
    remove: (characterId: string) => ipcRenderer.invoke('character:remove', characterId)
  },
  conversation: {
    create: (characterId: string) => ipcRenderer.invoke('conversation:create', characterId),
    remove: (conversationId: string) => ipcRenderer.invoke('conversation:remove', conversationId)
  },
  chat: {
    send: (conversationId: string, content: string, inputKind: UserInputKind, retryMessageId?: string) =>
      ipcRenderer.invoke('chat:send', conversationId, content, inputKind, retryMessageId),
    cancel: (requestId: string) => ipcRenderer.invoke('chat:cancel', requestId),
    onEvent: (listener: (event: ChatEvent) => void) => {
      const handler = (_event: Electron.IpcRendererEvent, payload: ChatEvent) => listener(payload)
      ipcRenderer.on('chat:event', handler)
      return () => ipcRenderer.removeListener('chat:event', handler)
    }
  },
  correction: {
    apply: (conversationId: string, messageId: string, feedback: string) =>
      ipcRenderer.invoke('correction:apply', conversationId, messageId, feedback),
    toggle: (characterId: string, correctionId: string, active: boolean) =>
      ipcRenderer.invoke('correction:toggle', characterId, correctionId, active)
  },
  settings: {
    save: (patch: {
      modelProvider?: ModelProvider
      model?: string
      reasoningEffort?: ReasoningEffort
      ollamaBaseUrl?: string
      ollamaModel?: string
      ollamaRuleReview?: boolean
      selectedCharacterId?: string
      selectedConversationId?: string
    }) => ipcRenderer.invoke('settings:save', patch)
  },
  localModels: {
    list: (baseUrl: string) => ipcRenderer.invoke('local-models:list', baseUrl)
  },
  secret: {
    set: (apiKey: string) => ipcRenderer.invoke('secret:set', apiKey),
    remove: () => ipcRenderer.invoke('secret:remove')
  },
  data: {
    openFolder: () => ipcRenderer.invoke('data:open-folder'),
    exportFull: () => ipcRenderer.invoke('data:export-full'),
    exportCharacter: (characterId: string) => ipcRenderer.invoke('data:export-character', characterId),
    importBundle: (mode: ImportMode) => ipcRenderer.invoke('data:import', mode)
  },
  updates: {
    getState: () => ipcRenderer.invoke('update:get-state'),
    check: () => ipcRenderer.invoke('update:check'),
    install: () => ipcRenderer.invoke('update:install'),
    onState: (listener: (state: UpdateState) => void) => {
      const handler = (_event: Electron.IpcRendererEvent, payload: UpdateState) => listener(payload)
      ipcRenderer.on('update:event', handler)
      return () => ipcRenderer.removeListener('update:event', handler)
    }
  }
}

contextBridge.exposeInMainWorld('yourTalker', api)

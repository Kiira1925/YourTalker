import {
  Archive,
  BookOpen,
  Bot,
  Camera,
  Check,
  ChevronLeft,
  CircleAlert,
  Download,
  Ellipsis,
  FolderOpen,
  KeyRound,
  LoaderCircle,
  MessageCircleMore,
  PanelRightClose,
  PanelRightOpen,
  PencilLine,
  Plus,
  RefreshCw,
  RotateCcw,
  Save,
  Send,
  Settings,
  Sparkles,
  Square,
  Trash2,
  Upload,
  UserRound,
  X
} from 'lucide-react'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type {
  BootstrapData,
  CharacterAnalysisMode,
  CharacterAnalysisResult,
  CharacterProfile,
  ChatEvent,
  Conversation,
  Correction,
  Message,
  ModelProvider,
  LocalModel,
  ReasoningEffort,
  UserInputKind,
  UpdateState
} from '../../shared/types'

type RightTab = 'profile' | 'memory'

type ProfileField = {
  key: keyof CharacterAnalysisResult
  label: string
  placeholder: string
  compact?: boolean
}

const profileFieldGroups: Array<{
  title: string
  description: string
  fields: ProfileField[]
}> = [
  {
    title: '基本情報',
    description: '人物を識別する基礎情報',
    fields: [
      { key: 'name', label: '名前', placeholder: '例：宵', compact: true },
      { key: 'age', label: '年齢・年代', placeholder: '例：23歳、外見は10代後半', compact: true },
      { key: 'gender', label: '性別・ジェンダー', placeholder: '必要な場合に設定', compact: true },
      { key: 'species', label: '種族・存在区分', placeholder: '人間、精霊、アンドロイド…', compact: true },
      { key: 'occupation', label: '職業・役割', placeholder: '古書店主、騎士、案内役…', compact: true },
      { key: 'overview', label: 'ひとことで', placeholder: 'キャラクターを一文で表すと？' },
      { key: 'appearance', label: '外見・服装', placeholder: '容姿、体格、髪や目、服装、持ち物' }
    ]
  },
  {
    title: '内面',
    description: '判断や感情を形づくるもの',
    fields: [
      { key: 'personality', label: '性格', placeholder: '穏やか、負けず嫌い、好奇心旺盛…' },
      { key: 'values', label: '価値観', placeholder: '大切にしている考え、判断基準' },
      { key: 'goals', label: '目的・望み', placeholder: '目指していること、現在の動機' },
      { key: 'abilities', label: '能力・得意分野', placeholder: '技能、知識、特殊能力、戦い方' },
      { key: 'weaknesses', label: '弱点・不得意', placeholder: '苦手なこと、能力の制約、欠点' },
      { key: 'fears', label: '恐れ・コンプレックス', placeholder: '恐れているもの、心の傷、触れられたくない点' },
      { key: 'likes', label: '好き・苦手', placeholder: '趣味、食べ物、好き嫌い' }
    ]
  },
  {
    title: '背景',
    description: '今の人物像へ至った文脈',
    fields: [
      { key: 'world', label: '世界観・時代・場所', placeholder: '暮らす場所、時代、文化、世界のルール' },
      { key: 'history', label: '生い立ち・経歴', placeholder: '過去の出来事、育った環境、転機' },
      { key: 'affiliations', label: '所属・立場', placeholder: '組織、家族、仲間、敵対勢力' },
      { key: 'secrets', label: '秘密・隠し事', placeholder: '本人が伏せている事実、話したがらないこと' }
    ]
  },
  {
    title: '関係性',
    description: 'ユーザーとの距離と呼び方',
    fields: [
      { key: 'relationship', label: 'あなたとの関係', placeholder: '幼なじみ、相談相手、旅の仲間…' },
      { key: 'callingName', label: 'あなたの呼び方', placeholder: 'ユーザーをどう呼ぶか', compact: true }
    ]
  },
  {
    title: '振る舞い',
    description: '場面ごとに表れる反応',
    fields: [
      { key: 'behaviorStyle', label: '行動傾向', placeholder: '困ったとき、対立時、日常でどう動くか' },
      { key: 'habits', label: '癖・習慣', placeholder: '仕草、日課、無意識にすること' },
      { key: 'emotionalExpression', label: '感情表現', placeholder: '喜び方、怒り方、照れ方、弱音の見せ方' },
      { key: 'taboos', label: '避けること', placeholder: '言ってほしくない表現、崩してほしくない設定' }
    ]
  },
  {
    title: '話し方',
    description: '声として現れる個性',
    fields: [
      { key: 'firstPerson', label: '一人称', placeholder: '私、僕、俺、自分の名前…', compact: true },
      { key: 'addressingOthers', label: '他者の呼び方', placeholder: '二人称、敬称、相手ごとの使い分け' },
      { key: 'speechStyle', label: '口調・文章の組み立て', placeholder: '語尾、テンポ、敬語、文章の長さ' },
      { key: 'catchphrases', label: '口癖', placeholder: 'よく使う言葉や独特の表現' },
      { key: 'sampleDialogue', label: '会話例', placeholder: '理想に近いセリフをいくつか' }
    ]
  },
  {
    title: 'その他',
    description: 'どの分類にも入らない情報だけ',
    fields: [
      { key: 'notes', label: '補足', placeholder: '上の項目に分類できない重要な設定のみ' }
    ]
  }
]

function App() {
  const [data, setData] = useState<BootstrapData | null>(null)
  const [selectedCharacterId, setSelectedCharacterId] = useState<string>()
  const [selectedConversationId, setSelectedConversationId] = useState<string>()
  const [draft, setDraft] = useState<CharacterProfile | null>(null)
  const [draftDirty, setDraftDirty] = useState(false)
  const [saving, setSaving] = useState(false)
  const [rightTab, setRightTab] = useState<RightTab>('profile')
  const [rightOpen, setRightOpen] = useState(true)
  const [composer, setComposer] = useState('')
  const [composerKind, setComposerKind] = useState<UserInputKind>('dialogue')
  const [streamText, setStreamText] = useState('')
  const [activeRequestId, setActiveRequestId] = useState<string>()
  const [reviewingReply, setReviewingReply] = useState(false)
  const [error, setError] = useState<string>()
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [descriptionOpen, setDescriptionOpen] = useState(false)
  const [descriptionText, setDescriptionText] = useState('')
  const [descriptionMode, setDescriptionMode] = useState<CharacterAnalysisMode>('overwrite')
  const [descriptionBusy, setDescriptionBusy] = useState(false)
  const [descriptionError, setDescriptionError] = useState<string>()
  const [correctionMessage, setCorrectionMessage] = useState<Message | null>(null)
  const [correctionFeedback, setCorrectionFeedback] = useState('')
  const [correctionBusy, setCorrectionBusy] = useState(false)
  const [toast, setToast] = useState<string>()
  const bottomRef = useRef<HTMLDivElement>(null)

  const refresh = useCallback(async () => {
    const next = await window.yourTalker.bootstrap()
    setData(next)
    setSelectedCharacterId((current) => current ?? next.settings.selectedCharacterId ?? next.characters[0]?.id)
    setSelectedConversationId((current) => current ?? next.settings.selectedConversationId)
  }, [])

  useEffect(() => {
    void refresh()
    return window.yourTalker.chat.onEvent((event: ChatEvent) => {
      if (event.type === 'delta') {
        setStreamText((current) => current + event.delta)
        return
      }
      if (event.type === 'reviewing') {
        setReviewingReply(true)
        return
      }
      if (event.type === 'review-warning') {
        setToast(event.message)
        return
      }
      setData((current) =>
        current
          ? {
              ...current,
              conversations: [
                event.conversation,
                ...current.conversations.filter((item) => item.id !== event.conversation.id)
              ]
            }
          : current
      )
      if (event.type === 'accepted') {
        setActiveRequestId(event.requestId)
        setReviewingReply(false)
        setError(undefined)
      } else {
        setActiveRequestId(undefined)
        setReviewingReply(false)
        setStreamText('')
        if (event.type === 'error') setError(event.message)
        if (event.type === 'cancelled') setToast('生成を中止しました')
      }
    })
  }, [refresh])

  useEffect(
    () =>
      window.yourTalker.updates.onState((update) => {
        setData((current) => (current ? { ...current, update } : current))
        if (update.status === 'downloaded') setToast('新しいバージョンの準備ができました')
      }),
    []
  )

  const selectedCharacter = useMemo(
    () => data?.characters.find((character) => character.id === selectedCharacterId),
    [data?.characters, selectedCharacterId]
  )
  const characterConversations = useMemo(
    () => data?.conversations.filter((conversation) => conversation.characterId === selectedCharacterId) ?? [],
    [data?.conversations, selectedCharacterId]
  )
  const selectedConversation = useMemo(
    () => characterConversations.find((conversation) => conversation.id === selectedConversationId),
    [characterConversations, selectedConversationId]
  )

  useEffect(() => {
    setDraft(selectedCharacter ? structuredClone(selectedCharacter) : null)
    setDraftDirty(false)
  }, [selectedCharacter?.id, selectedCharacter?.updatedAt])

  useEffect(() => {
    if (!draft || !draftDirty) return
    const timer = window.setTimeout(async () => {
      setSaving(true)
      try {
        const saved = await window.yourTalker.character.save(draft)
        setData((current) =>
          current
            ? { ...current, characters: current.characters.map((item) => (item.id === saved.id ? saved : item)) }
            : current
        )
        setDraftDirty(false)
      } catch (reason) {
        setError(messageFrom(reason))
      } finally {
        setSaving(false)
      }
    }, 650)
    return () => window.clearTimeout(timer)
  }, [draft, draftDirty])

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [selectedConversation?.messages.length, streamText])

  useEffect(() => {
    if (!toast) return
    const timer = window.setTimeout(() => setToast(undefined), 2600)
    return () => window.clearTimeout(timer)
  }, [toast])

  async function selectCharacter(id: string) {
    setSelectedCharacterId(id)
    const first = data?.conversations.find((conversation) => conversation.characterId === id)
    setSelectedConversationId(first?.id)
    await window.yourTalker.settings.save({
      selectedCharacterId: id,
      ...(first ? { selectedConversationId: first.id } : {})
    })
  }

  async function selectConversation(id: string) {
    setSelectedConversationId(id)
    await window.yourTalker.settings.save({ selectedConversationId: id })
  }

  async function addCharacter() {
    try {
      const character = await window.yourTalker.character.create()
      setData((current) => (current ? { ...current, characters: [character, ...current.characters] } : current))
      setSelectedCharacterId(character.id)
      setSelectedConversationId(undefined)
      setRightTab('profile')
      setRightOpen(true)
    } catch (reason) {
      setError(messageFrom(reason))
    }
  }

  async function selectAvatar() {
    if (!selectedCharacterId) return
    setSaving(true)
    try {
      if (draft && draftDirty) {
        const persisted = await window.yourTalker.character.save(draft)
        setData((current) =>
          current
            ? {
                ...current,
                characters: current.characters.map((item) => (item.id === persisted.id ? persisted : item))
              }
            : current
        )
        setDraft(structuredClone(persisted))
        setDraftDirty(false)
      }
      const saved = await window.yourTalker.character.selectAvatar(selectedCharacterId)
      if (!saved) return
      setData((current) =>
        current
          ? { ...current, characters: current.characters.map((item) => (item.id === saved.id ? saved : item)) }
          : current
      )
      setDraft(structuredClone(saved))
      setDraftDirty(false)
      setToast('アイコン画像を設定しました')
    } catch (reason) {
      setError(messageFrom(reason))
    } finally {
      setSaving(false)
    }
  }

  async function clearAvatar() {
    if (!selectedCharacterId) return
    setSaving(true)
    try {
      if (draft && draftDirty) {
        const persisted = await window.yourTalker.character.save(draft)
        setData((current) =>
          current
            ? {
                ...current,
                characters: current.characters.map((item) => (item.id === persisted.id ? persisted : item))
              }
            : current
        )
        setDraft(structuredClone(persisted))
        setDraftDirty(false)
      }
      const saved = await window.yourTalker.character.clearAvatar(selectedCharacterId)
      setData((current) =>
        current
          ? { ...current, characters: current.characters.map((item) => (item.id === saved.id ? saved : item)) }
          : current
      )
      setDraft(structuredClone(saved))
      setDraftDirty(false)
      setToast('アイコン画像を削除しました')
    } catch (reason) {
      setError(messageFrom(reason))
    } finally {
      setSaving(false)
    }
  }

  async function addConversation() {
    if (!selectedCharacterId) return
    try {
      const conversation = await window.yourTalker.conversation.create(selectedCharacterId)
      setData((current) =>
        current ? { ...current, conversations: [conversation, ...current.conversations] } : current
      )
      setSelectedConversationId(conversation.id)
    } catch (reason) {
      setError(messageFrom(reason))
    }
  }

  async function analyzeDescription() {
    if (!selectedCharacterId || !descriptionText.trim()) return
    if (data?.settings.modelProvider === 'openai' && !data.hasApiKey) {
      setDescriptionOpen(false)
      setSettingsOpen(true)
      setError('紹介文の解析にはOpenAI APIキーを設定してください。')
      return
    }
    if (data?.settings.modelProvider === 'ollama' && !data.settings.ollamaModel.trim()) {
      setDescriptionOpen(false)
      setSettingsOpen(true)
      setError('紹介文の解析に使うOllamaモデルを設定してください。')
      return
    }
    setDescriptionBusy(true)
    setDescriptionError(undefined)
    try {
      if (draft && draftDirty) {
        const savedDraft = await window.yourTalker.character.save(draft)
        setData((current) =>
          current
            ? {
                ...current,
                characters: current.characters.map((item) =>
                  item.id === savedDraft.id ? savedDraft : item
                )
              }
            : current
        )
        setDraftDirty(false)
      }
      const saved = await window.yourTalker.character.analyzeDescription(
        selectedCharacterId,
        descriptionText,
        descriptionMode
      )
      setData((current) =>
        current
          ? {
              ...current,
              characters: current.characters.map((item) => (item.id === saved.id ? saved : item))
            }
          : current
      )
      setDraft(structuredClone(saved))
      setDraftDirty(false)
      setDescriptionText('')
      setDescriptionOpen(false)
      setToast('紹介文からキャラクター設定を反映しました')
    } catch (reason) {
      setDescriptionError(messageFrom(reason))
    } finally {
      setDescriptionBusy(false)
    }
  }

  async function send(
    content = composer,
    retryMessageId?: string,
    inputKind: UserInputKind = composerKind
  ) {
    if (!content.trim() || activeRequestId) return
    if (data?.settings.modelProvider === 'openai' && !data.hasApiKey) {
      setSettingsOpen(true)
      setError('会話を始めるにはOpenAI APIキーを設定してください。')
      return
    }
    if (data?.settings.modelProvider === 'ollama' && !data.settings.ollamaModel.trim()) {
      setSettingsOpen(true)
      setError('会話に使うOllamaモデルを設定してください。')
      return
    }
    try {
      let conversationId = selectedConversationId
      if (!conversationId) {
        if (!selectedCharacterId) return
        const conversation = await window.yourTalker.conversation.create(selectedCharacterId)
        setData((current) =>
          current ? { ...current, conversations: [conversation, ...current.conversations] } : current
        )
        conversationId = conversation.id
        setSelectedConversationId(conversation.id)
      }
      setComposer('')
      setStreamText('')
      setReviewingReply(false)
      setError(undefined)
      const result = await window.yourTalker.chat.send(
        conversationId,
        content,
        inputKind,
        retryMessageId
      )
      setActiveRequestId(result.requestId)
    } catch (reason) {
      setError(messageFrom(reason))
    }
  }

  async function applyCorrection() {
    if (!selectedConversation || !correctionMessage || !correctionFeedback.trim()) return
    setCorrectionBusy(true)
    try {
      const next = await window.yourTalker.correction.apply(
        selectedConversation.id,
        correctionMessage.id,
        correctionFeedback
      )
      setData(next)
      setCorrectionMessage(null)
      setCorrectionFeedback('')
      setRightTab('memory')
      setToast('指摘を学習し、返答を修正しました')
    } catch (reason) {
      setError(messageFrom(reason))
    } finally {
      setCorrectionBusy(false)
    }
  }

  async function toggleCorrection(correction: Correction) {
    if (!selectedCharacterId) return
    try {
      const next = await window.yourTalker.correction.toggle(
        selectedCharacterId,
        correction.id,
        !correction.active
      )
      setData(next)
      setToast(correction.active ? 'ルールを無効にしました' : 'ルールを再び有効にしました')
    } catch (reason) {
      setError(messageFrom(reason))
    }
  }

  async function removeCharacter() {
    if (!selectedCharacter || !window.confirm(`「${selectedCharacter.name}」とすべての会話を削除しますか？`)) return
    const next = await window.yourTalker.character.remove(selectedCharacter.id)
    setData(next)
    setSelectedCharacterId(next.characters[0]?.id)
    setSelectedConversationId(undefined)
  }

  async function removeConversation(conversation: Conversation) {
    if (!window.confirm(`「${conversation.title}」を削除しますか？`)) return
    const next = await window.yourTalker.conversation.remove(conversation.id)
    setData(next)
    setSelectedConversationId(next.conversations.find((item) => item.characterId === selectedCharacterId)?.id)
  }

  async function installUpdate() {
    if (activeRequestId) throw new Error('会話の生成中は更新できません。生成を中止してからお試しください。')
    if (draft && draftDirty) {
      setSaving(true)
      try {
        const saved = await window.yourTalker.character.save(draft)
        setData((current) =>
          current
            ? { ...current, characters: current.characters.map((item) => (item.id === saved.id ? saved : item)) }
            : current
        )
        setDraftDirty(false)
      } finally {
        setSaving(false)
      }
    }
    await window.yourTalker.updates.install()
  }

  if (!data) {
    return (
      <div className="loading-screen">
        <div className="brand-mark"><Sparkles size={24} /></div>
        <LoaderCircle className="spin" />
        <span>YourTalkerを準備しています</span>
      </div>
    )
  }

  return (
    <div className={`app-shell ${rightOpen ? '' : 'right-closed'}`}>
      <aside className="left-rail">
        <header className="brand">
          <div className="brand-mark"><Sparkles size={18} /></div>
          <div>
            <strong>YourTalker</strong>
            <small>物語の続きを、いつでも。</small>
          </div>
        </header>

        <div className="section-heading">
          <span>キャラクター</span>
          <button className="icon-button" onClick={addCharacter} aria-label="キャラクターを追加">
            <Plus size={17} />
          </button>
        </div>
        <div className="character-list">
          {data.characters.map((character) => (
            <button
              key={character.id}
              className={`character-card ${character.id === selectedCharacterId ? 'active' : ''}`}
              onClick={() => void selectCharacter(character.id)}
            >
              <CharacterAvatar character={character} className="avatar" />
              <span>
                <strong>{character.name}</strong>
                <small>{character.overview || '設定を追加して育てましょう'}</small>
              </span>
            </button>
          ))}
          {data.characters.length === 0 && (
            <button className="empty-add" onClick={addCharacter}>
              <Plus size={18} />
              最初のキャラクターを作る
            </button>
          )}
        </div>

        {selectedCharacter && (
          <>
            <div className="section-heading conversations-heading">
              <span>会話</span>
              <button className="icon-button" onClick={addConversation} aria-label="新しい会話">
                <Plus size={17} />
              </button>
            </div>
            <div className="conversation-list">
              {characterConversations.map((conversation) => (
                <div
                  key={conversation.id}
                  className={`conversation-row ${conversation.id === selectedConversationId ? 'active' : ''}`}
                >
                  <button onClick={() => void selectConversation(conversation.id)}>
                    <MessageCircleMore size={16} />
                    <span>
                      <strong>{conversation.title}</strong>
                      <small>{relativeDate(conversation.updatedAt)}</small>
                    </span>
                  </button>
                  <button
                    className="row-delete"
                    onClick={() => void removeConversation(conversation)}
                    aria-label="会話を削除"
                  >
                    <Trash2 size={14} />
                  </button>
                </div>
              ))}
              {characterConversations.length === 0 && (
                <button className="empty-conversation" onClick={addConversation}>
                  <MessageCircleMore size={17} />
                  新しい会話を始める
                </button>
              )}
            </div>
          </>
        )}

        <button className="settings-button" onClick={() => setSettingsOpen(true)}>
          <Settings size={17} />
          設定とデータ
          {data.update.status === 'downloaded' && <span className="update-ready-badge">更新</span>}
          <span className={`key-dot ${data.hasApiKey ? 'ready' : ''}`} />
        </button>
      </aside>

      <main className="chat-pane">
        <header className="chat-header">
          <div>
            <span className="eyebrow">{selectedCharacter ? 'NOW TALKING WITH' : 'YOUR TALKER'}</span>
            <h1>{selectedCharacter?.name ?? 'キャラクターを作りましょう'}</h1>
          </div>
          {selectedCharacter && (
            <div className="header-actions">
              <span className="save-state">
                {saving ? <LoaderCircle className="spin" size={14} /> : <Check size={14} />}
                {saving ? '保存中' : '自動保存'}
              </span>
              <button className="icon-button large" onClick={() => setRightOpen((current) => !current)}>
                {rightOpen ? <PanelRightClose size={19} /> : <PanelRightOpen size={19} />}
              </button>
            </div>
          )}
        </header>

        {!selectedCharacter ? (
          <EmptyWelcome onCreate={addCharacter} />
        ) : !selectedConversation ? (
          <EmptyConversation character={selectedCharacter} onCreate={addConversation} />
        ) : (
          <>
            <div className="messages">
              {selectedConversation.hasDisabledCorrectionImpact && (
                <div className="impact-notice">
                  <CircleAlert size={16} />
                  無効にした指摘の影響が後続の会話に残っている可能性があります。
                </div>
              )}
              {selectedConversation.messages.map((message) => (
                <MessageBubble
                  key={message.id}
                  message={message}
                  character={selectedCharacter}
                  onCorrect={() => {
                    setCorrectionMessage(message)
                    setCorrectionFeedback('')
                  }}
                  onRetry={() => void send(message.content, message.id, message.inputKind ?? 'dialogue')}
                />
              ))}
              {activeRequestId && streamText && (
                <div className="message assistant">
                  <CharacterAvatar character={selectedCharacter} className="message-avatar" />
                  <div className="bubble">
                    <p>{streamText}<span className="stream-caret" /></p>
                    {reviewingReply && (
                      <small className="review-status"><Sparkles size={11} /> ルールとの整合性を確認中…</small>
                    )}
                  </div>
                </div>
              )}
              {activeRequestId && !streamText && (
                <div className="message assistant thinking">
                  <CharacterAvatar character={selectedCharacter} className="message-avatar" />
                  <div className="typing-dots"><i /><i /><i /></div>
                </div>
              )}
              <div ref={bottomRef} />
            </div>

            <div className="composer-wrap">
              {error && (
                <div className="error-banner">
                  <CircleAlert size={16} />
                  <span>{error}</span>
                  <button onClick={() => setError(undefined)}><X size={14} /></button>
                </div>
              )}
              <div className="composer-mode-switch" role="group" aria-label="入力の種類">
                <button
                  type="button"
                  className={composerKind === 'dialogue' ? 'active' : ''}
                  aria-pressed={composerKind === 'dialogue'}
                  onClick={() => setComposerKind('dialogue')}
                  disabled={Boolean(activeRequestId)}
                >
                  <MessageCircleMore size={13} /> セリフ
                </button>
                <button
                  type="button"
                  className={composerKind === 'narration' ? 'active' : ''}
                  aria-pressed={composerKind === 'narration'}
                  onClick={() => setComposerKind('narration')}
                  disabled={Boolean(activeRequestId)}
                >
                  <BookOpen size={13} /> 描写
                </button>
                <span>
                  {composerKind === 'dialogue'
                    ? `${selectedCharacter.name}へ話しかけます`
                    : '情景・行動・心情として伝えます'}
                </span>
              </div>
              <div className="composer">
                <textarea
                  value={composer}
                  onChange={(event) => setComposer(event.target.value)}
                  onKeyDown={(event) => {
                    if (event.key === 'Enter' && !event.shiftKey) {
                      event.preventDefault()
                      void send()
                    }
                  }}
                  placeholder={
                    composerKind === 'dialogue'
                      ? `${selectedCharacter.name}に話しかける…`
                      : '情景、出来事、行動や心情を描写する…'
                  }
                  rows={1}
                  disabled={Boolean(activeRequestId)}
                />
                {activeRequestId ? (
                  <button className="send-button stop" onClick={() => window.yourTalker.chat.cancel(activeRequestId)}>
                    <Square size={16} />
                  </button>
                ) : (
                  <button className="send-button" disabled={!composer.trim()} onClick={() => void send()}>
                    <Send size={17} />
                  </button>
                )}
              </div>
              <small className="composer-hint">Enterで送信 · Shift+Enterで改行</small>
            </div>
          </>
        )}
      </main>

      {selectedCharacter && rightOpen && draft && (
        <aside className="right-panel">
          <div className="right-tabs">
            <button className={rightTab === 'profile' ? 'active' : ''} onClick={() => setRightTab('profile')}>
              <UserRound size={16} /> キャラクター
            </button>
            <button className={rightTab === 'memory' ? 'active' : ''} onClick={() => setRightTab('memory')}>
              <BookOpen size={16} /> 学習したルール
              {selectedCharacter.corrections.length > 0 && <b>{selectedCharacter.corrections.length}</b>}
            </button>
          </div>
          {rightTab === 'profile' ? (
            <div className="profile-editor">
              <div className="panel-intro">
                <button
                  type="button"
                  className="avatar-picker"
                  onClick={() => void selectAvatar()}
                  aria-label="アイコン画像を選択"
                  title="アイコン画像を選択"
                >
                  <CharacterAvatar character={draft} className="avatar large-avatar" />
                  <span className="avatar-picker-badge"><Camera size={11} /></span>
                </button>
                <div className="panel-intro-copy">
                  <h2>らしさの設計図</h2>
                  <p>空欄のままでも大丈夫。会話しながら育てられます。</p>
                  <div className="avatar-actions">
                    <button type="button" onClick={() => void selectAvatar()}>画像を選択</button>
                    {draft.avatarDataUrl && (
                      <button type="button" onClick={() => void clearAvatar()}>削除</button>
                    )}
                  </div>
                </div>
              </div>
              <div className="description-import-card">
                <span><Sparkles size={17} /></span>
                <div>
                  <strong>紹介文から自動設定</strong>
                  <small>まとまった文章をAIが項目ごとに整理します。</small>
                </div>
                <button
                  className="secondary"
                  onClick={() => {
                    setDescriptionError(undefined)
                    setDescriptionOpen(true)
                  }}
                >
                  文章を解析
                </button>
              </div>
              {profileFieldGroups.map((group) => (
                <section className="profile-field-section" key={group.title}>
                  <header>
                    <strong>{group.title}</strong>
                    <small>{group.description}</small>
                  </header>
                  {group.fields.map((field) => (
                    <label className={field.compact ? 'compact-field' : ''} key={field.key}>
                      <span>{field.label}</span>
                      {field.compact ? (
                        <input
                          value={draft[field.key]}
                          placeholder={field.placeholder}
                          onChange={(event) => {
                            setDraft({ ...draft, [field.key]: event.target.value })
                            setDraftDirty(true)
                          }}
                        />
                      ) : (
                        <textarea
                          value={draft[field.key]}
                          placeholder={field.placeholder}
                          rows={field.key === 'sampleDialogue' ? 4 : 3}
                          onChange={(event) => {
                            setDraft({ ...draft, [field.key]: event.target.value })
                            setDraftDirty(true)
                          }}
                        />
                      )}
                    </label>
                  ))}
                </section>
              ))}
              <button className="danger-link" onClick={() => void removeCharacter()}>
                <Trash2 size={15} /> このキャラクターを削除
              </button>
            </div>
          ) : (
            <MemoryPanel character={selectedCharacter} onToggle={toggleCorrection} />
          )}
        </aside>
      )}

      {settingsOpen && (
        <SettingsModal
          data={data}
          onClose={() => setSettingsOpen(false)}
          onChange={setData}
          onToast={setToast}
          selectedCharacterId={selectedCharacterId}
          onInstallUpdate={installUpdate}
          installBlocked={Boolean(activeRequestId)}
        />
      )}

      {descriptionOpen && (
        <div
          className="modal-backdrop"
          onMouseDown={() => !descriptionBusy && setDescriptionOpen(false)}
        >
          <section
            className="modal description-modal"
            onMouseDown={(event) => event.stopPropagation()}
          >
            <button
              className="modal-close"
              disabled={descriptionBusy}
              onClick={() => setDescriptionOpen(false)}
            >
              <X size={18} />
            </button>
            <span className="modal-icon"><Sparkles size={20} /></span>
            <h2>紹介文からキャラクターを設定</h2>
            <p className="modal-lead">
              プロフィール、設定資料、あらすじなどを貼り付けると、各項目へ整理して保存します。
            </p>
            <label>
              <span>キャラクター紹介文</span>
              <textarea
                autoFocus
                rows={11}
                value={descriptionText}
                disabled={descriptionBusy}
                onChange={(event) => setDescriptionText(event.target.value)}
                placeholder="例：宵は月面都市で古書店を営む、無口だが面倒見のよい青年。ユーザーとは幼なじみで、「きみ」と呼ぶ。普段は短く穏やかに話し、驚くと『まいったな』が口癖として出る……"
              />
            </label>
            <fieldset className="description-modes" disabled={descriptionBusy}>
              <legend>既存設定への反映方法</legend>
              <label className={descriptionMode === 'overwrite' ? 'selected' : ''}>
                <input
                  type="radio"
                  name="description-mode"
                  value="overwrite"
                  checked={descriptionMode === 'overwrite'}
                  onChange={() => setDescriptionMode('overwrite')}
                />
                <span>
                  <strong>読み取れた項目を上書き</strong>
                  <small>紹介文に情報がある項目だけ更新し、不明な項目は残します。</small>
                </span>
              </label>
              <label className={descriptionMode === 'fill-empty' ? 'selected' : ''}>
                <input
                  type="radio"
                  name="description-mode"
                  value="fill-empty"
                  checked={descriptionMode === 'fill-empty'}
                  onChange={() => setDescriptionMode('fill-empty')}
                />
                <span>
                  <strong>空欄だけ補完</strong>
                  <small>すでに入力済みの項目を変更せず、空欄だけ埋めます。</small>
                </span>
              </label>
            </fieldset>
            <p className="api-disclosure">
              {data.settings.modelProvider === 'ollama'
                ? '解析は端末上のOllamaモデルで行われ、紹介文は外部へ送信されません。'
                : '解析時、この紹介文は設定中のOpenAIモデルへ送信されます。'}
            </p>
            {descriptionError && (
              <div className="modal-error">
                <CircleAlert size={15} />
                {descriptionError}
              </div>
            )}
            <div className="modal-actions">
              <button
                className="secondary"
                disabled={descriptionBusy}
                onClick={() => setDescriptionOpen(false)}
              >
                キャンセル
              </button>
              <button
                className="primary"
                disabled={!descriptionText.trim() || descriptionBusy}
                onClick={() => void analyzeDescription()}
              >
                {descriptionBusy ? <LoaderCircle className="spin" size={16} /> : <Sparkles size={16} />}
                {descriptionBusy ? '解析しています…' : '解析して反映'}
              </button>
            </div>
          </section>
        </div>
      )}

      {correctionMessage && (
        <div className="modal-backdrop" onMouseDown={() => !correctionBusy && setCorrectionMessage(null)}>
          <section className="modal correction-modal" onMouseDown={(event) => event.stopPropagation()}>
            <button className="modal-close" onClick={() => setCorrectionMessage(null)}><X size={18} /></button>
            <span className="modal-icon coral"><PencilLine size={20} /></span>
            <h2>この返答を修正する</h2>
            <p className="modal-lead">違和感と、次からどう話してほしいかを伝えてください。</p>
            <blockquote>{correctionMessage.content}</blockquote>
            <label>
              <span>指摘内容</span>
              <textarea
                autoFocus
                rows={5}
                value={correctionFeedback}
                onChange={(event) => setCorrectionFeedback(event.target.value)}
                placeholder="例：ここでは励ますより、少し呆れながら冗談っぽく返してほしい。敬語も使わないで。"
              />
            </label>
            <div className="modal-actions">
              <button className="secondary" disabled={correctionBusy} onClick={() => setCorrectionMessage(null)}>キャンセル</button>
              <button className="primary" disabled={!correctionFeedback.trim() || correctionBusy} onClick={() => void applyCorrection()}>
                {correctionBusy ? <LoaderCircle className="spin" size={16} /> : <Sparkles size={16} />}
                学習して返答を直す
              </button>
            </div>
          </section>
        </div>
      )}

      {toast && <div className="toast"><Check size={16} /> {toast}</div>}
    </div>
  )
}

function CharacterAvatar({
  character,
  className
}: {
  character: Pick<CharacterProfile, 'name' | 'avatarDataUrl'>
  className: string
}) {
  return (
    <span className={className} aria-hidden="true">
      {character.avatarDataUrl ? (
        <img src={character.avatarDataUrl} alt="" />
      ) : (
        character.name.trim().slice(0, 1) || '?'
      )}
    </span>
  )
}

function EmptyWelcome({ onCreate }: { onCreate: () => void }) {
  return (
    <div className="empty-stage">
      <div className="empty-orbit">
        <span><Sparkles /></span>
        <i />
      </div>
      <span className="eyebrow">A CHARACTER THAT REMEMBERS</span>
      <h2>思い描いた「その人」と、<br />会話を重ねていく。</h2>
      <p>性格や話し方を決め、違ったら伝える。<br />あなたの指摘は消えずに、その人らしさへ変わります。</p>
      <button className="primary hero-button" onClick={onCreate}><Plus size={18} /> キャラクターを作る</button>
    </div>
  )
}

function EmptyConversation({ character, onCreate }: { character: CharacterProfile; onCreate: () => void }) {
  return (
    <div className="empty-stage conversation-empty-stage">
      <CharacterAvatar character={character} className="avatar hero-avatar" />
      <span className="eyebrow">READY WHEN YOU ARE</span>
      <h2>{character.name}との新しい会話</h2>
      <p>{character.overview || '右側の設計図を埋めるか、まずは気軽に話しかけてみましょう。'}</p>
      <button className="primary hero-button" onClick={onCreate}><MessageCircleMore size={18} /> 会話を始める</button>
    </div>
  )
}

function MessageBubble({
  message,
  character,
  onCorrect,
  onRetry
}: {
  message: Message
  character: CharacterProfile
  onCorrect: () => void
  onRetry: () => void
}) {
  return (
    <div
      className={[
        'message',
        message.role,
        message.inputKind === 'narration' ? 'narration' : '',
        message.status === 'failed' ? 'failed' : ''
      ].filter(Boolean).join(' ')}
    >
      {message.role === 'assistant' && <CharacterAvatar character={character} className="message-avatar" />}
      <div className="bubble">
        {message.role === 'user' && message.inputKind === 'narration' && (
          <span className="narration-label"><BookOpen size={12} /> 描写</span>
        )}
        <p>{message.content}</p>
        {message.correctionId && <span className="corrected-label"><Sparkles size={12} /> 指摘を反映済み</span>}
        <div className="message-actions">
          {message.role === 'assistant' && (
            <button onClick={onCorrect}><PencilLine size={13} /> 指摘して修正</button>
          )}
          {message.role === 'user' && message.status === 'failed' && (
            <button onClick={onRetry}><RefreshCw size={13} /> 再送する</button>
          )}
          <time>{new Date(message.createdAt).toLocaleTimeString('ja-JP', { hour: '2-digit', minute: '2-digit' })}</time>
        </div>
      </div>
    </div>
  )
}

function MemoryPanel({
  character,
  onToggle
}: {
  character: CharacterProfile
  onToggle: (correction: Correction) => void
}) {
  const groupedCorrections = new Map<string, Correction[]>()
  for (const correction of character.corrections) {
    const groupId = correction.ruleGroupId ?? correction.id
    const group = groupedCorrections.get(groupId) ?? []
    group.push(correction)
    groupedCorrections.set(groupId, group)
  }
  const ruleGroups = [...groupedCorrections.values()]
    .map((corrections) => corrections.sort((a, b) => b.createdAt.localeCompare(a.createdAt)))
    .sort((a, b) => b[0].createdAt.localeCompare(a[0].createdAt))
  const activeCount = ruleGroups.filter((group) => group.some((item) => item.active)).length
  return (
    <div className="memory-panel">
      <div className="memory-summary">
        <span><Sparkles size={18} /></span>
        <div>
          <strong>{activeCount}個のルールを反映中</strong>
          <p>指摘は原文とともに残り、いつでも切り替えられます。</p>
        </div>
      </div>
      {character.learnedGuidance && (
        <div className="guidance-card">
          <span className="eyebrow">CURRENT GUIDANCE</span>
          <p>{character.learnedGuidance}</p>
        </div>
      )}
      <div className="memory-list">
        {ruleGroups.map((group, index) => {
          const current = group.find((correction) => correction.active) ?? group[0]
          const groupActive = group.some((correction) => correction.active)
          return (
            <article className={`memory-card ${groupActive ? '' : 'inactive'}`} key={current.ruleGroupId ?? current.id}>
              <header>
                <span>
                  RULE {ruleGroups.length - index}
                  {group.length > 1 && ` · ${group.length}件を統合`}
                </span>
                <button
                  className={`toggle ${current.active ? 'on' : ''}`}
                  onClick={() => void onToggle(current)}
                  aria-label={current.active ? '最新の指摘を無効にする' : '最新の指摘を有効にする'}
                >
                  <i />
                </button>
              </header>
              <strong>{current.derivedRule}</strong>
              <details>
                <summary>{group.length > 1 ? `${group.length}件の統合履歴を見る` : '指摘と修正履歴を見る'}</summary>
                {group.map((correction, historyIndex) => (
                  <section className="correction-history" key={correction.id}>
                    <header>
                      <b>指摘 {group.length - historyIndex}</b>
                      <button
                        className={`toggle compact ${correction.active ? 'on' : ''}`}
                        onClick={() => void onToggle(correction)}
                        aria-label={correction.active ? 'この指摘を無効にする' : 'この指摘を有効にする'}
                      >
                        <i />
                      </button>
                    </header>
                    <dl>
                      <dt>ルール</dt><dd>{correction.derivedRule}</dd>
                      <dt>指摘</dt><dd>{correction.feedbackText}</dd>
                      <dt>元の返答</dt><dd>{correction.originalReply}</dd>
                      <dt>修正版</dt><dd>{correction.revisedReply}</dd>
                    </dl>
                    <time>{new Date(correction.createdAt).toLocaleString('ja-JP')}</time>
                  </section>
                ))}
              </details>
              <time>{new Date(current.createdAt).toLocaleString('ja-JP')}</time>
            </article>
          )
        })}
        {character.corrections.length === 0 && (
          <div className="empty-memory">
            <BookOpen size={28} />
            <strong>まだ指摘はありません</strong>
            <p>会話の返答にある「指摘して修正」から、らしさを教えられます。</p>
          </div>
        )}
      </div>
    </div>
  )
}

function SettingsModal({
  data,
  onClose,
  onChange,
  onToast,
  selectedCharacterId,
  onInstallUpdate,
  installBlocked
}: {
  data: BootstrapData
  onClose: () => void
  onChange: (data: BootstrapData) => void
  onToast: (message: string) => void
  selectedCharacterId?: string
  onInstallUpdate: () => Promise<void>
  installBlocked: boolean
}) {
  const [apiKey, setApiKey] = useState('')
  const [provider, setProvider] = useState<ModelProvider>(data.settings.modelProvider)
  const [model, setModel] = useState(data.settings.model)
  const [effort, setEffort] = useState<ReasoningEffort>(data.settings.reasoningEffort)
  const [ollamaBaseUrl, setOllamaBaseUrl] = useState(data.settings.ollamaBaseUrl)
  const [ollamaModel, setOllamaModel] = useState(data.settings.ollamaModel)
  const [ollamaRuleReview, setOllamaRuleReview] = useState(data.settings.ollamaRuleReview)
  const [localModels, setLocalModels] = useState<LocalModel[]>([])
  const [checkingLocal, setCheckingLocal] = useState(false)
  const [busy, setBusy] = useState(false)
  const [updateBusy, setUpdateBusy] = useState(false)
  const [localError, setLocalError] = useState<string>()

  async function saveSettings() {
    setBusy(true)
    setLocalError(undefined)
    try {
      if (provider === 'ollama' && !ollamaModel.trim()) {
        throw new Error('使用するOllamaモデルを選択または入力してください。')
      }
      if (apiKey.trim()) await window.yourTalker.secret.set(apiKey)
      const settings = await window.yourTalker.settings.save({
        modelProvider: provider,
        model,
        reasoningEffort: effort,
        ollamaBaseUrl,
        ollamaModel,
        ollamaRuleReview
      })
      onChange({ ...data, settings, hasApiKey: data.hasApiKey || Boolean(apiKey.trim()) })
      onToast('設定を保存しました')
      onClose()
    } catch (reason) {
      setLocalError(messageFrom(reason))
    } finally {
      setBusy(false)
    }
  }

  async function checkLocalModels() {
    setCheckingLocal(true)
    setLocalError(undefined)
    try {
      const models = await window.yourTalker.localModels.list(ollamaBaseUrl)
      setLocalModels(models)
      if (!models.length) {
        throw new Error('Ollamaにモデルがありません。先にモデルをダウンロードしてください。')
      }
      if (!ollamaModel.trim() || !models.some((item) => item.name === ollamaModel)) {
        setOllamaModel(models[0].name)
      }
      onToast(`${models.length}件のローカルモデルを確認しました`)
    } catch (reason) {
      setLocalError(messageFrom(reason))
    } finally {
      setCheckingLocal(false)
    }
  }

  async function importData(mode: 'merge' | 'replace') {
    if (mode === 'replace' && !window.confirm('現在のデータをバックアップしたあと、読み込んだ内容で置き換えますか？')) return
    setBusy(true)
    try {
      const next = await window.yourTalker.data.importBundle(mode)
      if (next) {
        onChange(next)
        onToast(mode === 'merge' ? 'データを追加しました' : 'データを復元しました')
        onClose()
      }
    } catch (reason) {
      setLocalError(messageFrom(reason))
    } finally {
      setBusy(false)
    }
  }

  async function checkForUpdates() {
    setUpdateBusy(true)
    setLocalError(undefined)
    try {
      const update = await window.yourTalker.updates.check()
      onChange({ ...data, update })
    } catch (reason) {
      setLocalError(messageFrom(reason))
    } finally {
      setUpdateBusy(false)
    }
  }

  async function applyUpdate() {
    setUpdateBusy(true)
    setLocalError(undefined)
    try {
      await onInstallUpdate()
    } catch (reason) {
      setLocalError(messageFrom(reason))
      setUpdateBusy(false)
    }
  }

  return (
    <div className="modal-backdrop" onMouseDown={onClose}>
      <section className="modal settings-modal" onMouseDown={(event) => event.stopPropagation()}>
        <button className="modal-close" onClick={onClose}><X size={18} /></button>
        <span className="modal-icon"><Settings size={20} /></span>
        <h2>設定とデータ</h2>
        <UpdateSection
          state={data.update}
          busy={updateBusy}
          installBlocked={installBlocked}
          onCheck={checkForUpdates}
          onInstall={applyUpdate}
        />
        <div className="settings-section">
          <div className="setting-title"><Bot size={17} /><div><strong>会話の生成方法</strong><small>クラウドAPIと端末内のモデルを切り替えられます</small></div></div>
          <div className="provider-options">
            <button
              type="button"
              className={provider === 'ollama' ? 'selected' : ''}
              onClick={() => setProvider('ollama')}
            >
              <strong>ローカルLLM</strong>
              <small>APIキー不要・Ollamaを使用</small>
            </button>
            <button
              type="button"
              className={provider === 'openai' ? 'selected' : ''}
              onClick={() => setProvider('openai')}
            >
              <strong>OpenAI API</strong>
              <small>クラウドモデルを使用</small>
            </button>
          </div>

          {provider === 'ollama' ? (
            <div className="provider-panel">
              <div className="setting-title compact-title">
                <Bot size={17} />
                <div><strong>Ollama</strong><small>Windows上で動作するローカルモデルへ接続します</small></div>
              </div>
              <label>
                <span>接続先</span>
                <input
                  value={ollamaBaseUrl}
                  onChange={(event) => setOllamaBaseUrl(event.target.value)}
                  placeholder="http://127.0.0.1:11434"
                  autoComplete="off"
                />
              </label>
              <div className="local-model-row">
                <label>
                  <span>使用するモデル</span>
                  <input
                    list="ollama-models"
                    value={ollamaModel}
                    onChange={(event) => setOllamaModel(event.target.value)}
                    placeholder="例：gemma3:4b"
                    autoComplete="off"
                  />
                  <datalist id="ollama-models">
                    {localModels.map((item) => <option value={item.name} key={item.name} />)}
                  </datalist>
                </label>
                <button
                  type="button"
                  className="secondary local-check"
                  disabled={checkingLocal}
                  onClick={() => void checkLocalModels()}
                >
                  {checkingLocal ? <LoaderCircle className="spin" size={15} /> : <RefreshCw size={15} />}
                  接続確認
                </button>
              </div>
              {localModels.length > 0 && (
                <div className="model-summary">
                  {localModels.map((item) => (
                    <span className={item.name === ollamaModel ? 'active' : ''} key={item.name}>
                      {item.name}{item.parameterSize ? ` · ${item.parameterSize}` : ''}
                    </span>
                  ))}
                </div>
              )}
              <label className="quality-toggle">
                <input
                  type="checkbox"
                  checked={ollamaRuleReview}
                  onChange={(event) => setOllamaRuleReview(event.target.checked)}
                />
                <span>
                  <strong>返答をルール照合して自動修正</strong>
                  <small>追加の確認処理で完了まで長くなりますが、キャラクター設定や学習ルールからのズレを抑えます</small>
                </span>
              </label>
              <p className="privacy-note">
                Ollamaをインストールして起動し、モデルがない場合はPowerShellで
                <code>ollama pull gemma3:4b</code>などを実行してください。
              </p>
            </div>
          ) : (
            <div className="provider-panel">
              <div className="setting-title compact-title"><KeyRound size={17} /><div><strong>OpenAI API</strong><small>キーはWindowsの暗号化機能で保護されます</small></div></div>
              <label>
                <span>
                  APIキー {data.hasApiKey && <em>設定済み</em>}
                  {data.hasApiKey && (
                    <button
                      type="button"
                      className="inline-danger"
                      onClick={async () => {
                        if (!window.confirm('保存済みのAPIキーを削除しますか？')) return
                        await window.yourTalker.secret.remove()
                        onChange({ ...data, hasApiKey: false })
                        setApiKey('')
                        onToast('APIキーを削除しました')
                      }}
                    >
                      削除
                    </button>
                  )}
                </span>
                <input
                  type="password"
                  value={apiKey}
                  onChange={(event) => setApiKey(event.target.value)}
                  placeholder={data.hasApiKey ? '変更する場合だけ入力' : 'sk-…'}
                  autoComplete="off"
                />
              </label>
              <div className="settings-grid">
                <label>
                  <span>モデル</span>
                  <select value={model} onChange={(event) => setModel(event.target.value)}>
                    <option value="gpt-5.6-terra">GPT-5.6 Terra — バランス</option>
                    <option value="gpt-5.6-sol">GPT-5.6 Sol — 品質優先</option>
                    <option value="gpt-5.6-luna">GPT-5.6 Luna — コスト優先</option>
                  </select>
                </label>
                <label>
                  <span>推論強度</span>
                  <select value={effort} onChange={(event) => setEffort(event.target.value as ReasoningEffort)}>
                    <option value="none">なし — 最速</option>
                    <option value="low">低 — おすすめ</option>
                    <option value="medium">中</option>
                    <option value="high">高 — じっくり</option>
                  </select>
                </label>
              </div>
            </div>
          )}
        </div>
        <div className="settings-section">
          <div className="setting-title"><Archive size={17} /><div><strong>保存とバックアップ</strong><small>{data.dataPath}</small></div></div>
          <div className="data-actions">
            <button onClick={() => window.yourTalker.data.openFolder()}><FolderOpen size={16} /> 保存フォルダ</button>
            <button onClick={async () => {
              const path = await window.yourTalker.data.exportFull()
              if (path) onToast('すべてのデータを書き出しました')
            }}><Download size={16} /> 全データを書き出す</button>
            <button disabled={!selectedCharacterId} onClick={async () => {
              if (!selectedCharacterId) return
              const path = await window.yourTalker.data.exportCharacter(selectedCharacterId)
              if (path) onToast('キャラクターを書き出しました')
            }}><UserRound size={16} /> このキャラを書き出す</button>
            <button onClick={() => void importData('merge')}><Upload size={16} /> データを追加</button>
            <button onClick={() => void importData('replace')}><RotateCcw size={16} /> バックアップから復元</button>
          </div>
          <p className="privacy-note">
            {provider === 'ollama'
              ? 'ローカルLLM利用時、キャラクター設定と会話内容は端末外へ送信されません。'
              : 'APIキーは書き出しデータに含まれません。会話内容は生成時のみOpenAI APIへ送信されます。'}
          </p>
        </div>
        {localError && <div className="error-banner static"><CircleAlert size={16} />{localError}</div>}
        <div className="modal-actions">
          <button className="secondary" onClick={onClose}>閉じる</button>
          <button className="primary" disabled={busy} onClick={() => void saveSettings()}>
            {busy ? <LoaderCircle className="spin" size={16} /> : <Save size={16} />} 設定を保存
          </button>
        </div>
      </section>
    </div>
  )
}

function UpdateSection({
  state,
  busy,
  installBlocked,
  onCheck,
  onInstall
}: {
  state: UpdateState
  busy: boolean
  installBlocked: boolean
  onCheck: () => Promise<void>
  onInstall: () => Promise<void>
}) {
  const working = ['checking', 'available', 'downloading', 'preparing'].includes(state.status)
  const percent = state.percent ?? 0
  return (
    <div className="settings-section update-section">
      <div className="setting-title">
        <RefreshCw size={17} className={working ? 'spin' : ''} />
        <div>
          <strong>アプリの更新</strong>
          <small>現在のバージョン {state.currentVersion}</small>
        </div>
        <span className={`update-status status-${state.status}`}>{updateStatusLabel(state)}</span>
      </div>
      <div className="update-card">
        <div className="update-copy">
          <strong>
            {state.availableVersion && state.availableVersion !== state.currentVersion
              ? `バージョン ${state.availableVersion}`
              : 'YourTalker'}
          </strong>
          <p>{state.message}</p>
        </div>
        {['downloading', 'preparing', 'downloaded'].includes(state.status) && (
          <div className="update-progress">
            <span style={{ width: `${state.status === 'preparing' || state.status === 'downloaded' ? 100 : percent}%` }} />
          </div>
        )}
        {state.status === 'downloading' && (
          <div className="update-metrics">
            <span>{percent.toFixed(1)}%</span>
            <span>{formatBytes(state.transferred)} / {formatBytes(state.total)}</span>
            <span>{formatBytes(state.bytesPerSecond)}/秒</span>
          </div>
        )}
        {state.releaseNotes && (
          <details className="release-notes">
            <summary>更新内容を見る</summary>
            <p>{state.releaseNotes}</p>
          </details>
        )}
        {installBlocked && state.status === 'downloaded' && (
          <p className="update-warning">会話の生成が終わるまで更新の適用はできません。</p>
        )}
        <div className="update-actions">
          {state.status === 'downloaded' ? (
            <button className="primary" disabled={busy || installBlocked} onClick={() => void onInstall()}>
              {busy ? <LoaderCircle className="spin" size={15} /> : <RotateCcw size={15} />}
              再起動して更新
            </button>
          ) : (
            <button
              className="secondary"
              disabled={!state.enabled || busy || working}
              onClick={() => void onCheck()}
            >
              {busy || working ? <LoaderCircle className="spin" size={15} /> : <RefreshCw size={15} />}
              更新を確認
            </button>
          )}
        </div>
      </div>
    </div>
  )
}

function messageFrom(reason: unknown): string {
  if (reason instanceof Error) return reason.message.replace(/^Error invoking remote method '[^']+': Error: /, '')
  return '予期しないエラーが発生しました。'
}

function relativeDate(iso: string): string {
  const date = new Date(iso)
  const today = new Date()
  if (date.toDateString() === today.toDateString()) {
    return date.toLocaleTimeString('ja-JP', { hour: '2-digit', minute: '2-digit' })
  }
  return date.toLocaleDateString('ja-JP', { month: 'short', day: 'numeric' })
}

function updateStatusLabel(state: UpdateState): string {
  switch (state.status) {
    case 'disabled': return '利用不可'
    case 'idle': return '待機中'
    case 'checking': return '確認中'
    case 'available': return '更新あり'
    case 'downloading': return '取得中'
    case 'preparing': return '準備中'
    case 'downloaded': return '適用可能'
    case 'not-available': return '最新版'
    case 'error': return '要確認'
  }
}

function formatBytes(value?: number): string {
  if (!value || value < 0) return '0 B'
  const units = ['B', 'KB', 'MB', 'GB']
  const index = Math.min(Math.floor(Math.log(value) / Math.log(1024)), units.length - 1)
  return `${(value / 1024 ** index).toFixed(index === 0 ? 0 : 1)} ${units[index]}`
}

export default App

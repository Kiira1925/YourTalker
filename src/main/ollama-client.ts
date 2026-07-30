import type { LocalModel } from '../shared/types'

export interface OllamaMessage {
  role: 'system' | 'user' | 'assistant'
  content: string
}

interface OllamaChatChunk {
  message?: {
    content?: string
  }
  error?: string
}

export interface OllamaGenerationOptions {
  temperature?: number
  top_p?: number
  num_ctx?: number
  num_predict?: number
}

export function normalizeOllamaBaseUrl(raw: string): string {
  let url: URL
  try {
    url = new URL(raw.trim())
  } catch {
    throw new Error('Ollamaの接続先URLを確認してください。')
  }
  if (!['http:', 'https:'].includes(url.protocol)) {
    throw new Error('Ollamaの接続先はhttpまたはhttpsで指定してください。')
  }
  if (url.username || url.password) {
    throw new Error('Ollamaの接続先URLに認証情報は含められません。')
  }
  if (!['localhost', '127.0.0.1', '[::1]'].includes(url.hostname)) {
    throw new Error('ローカル利用を保つため、Ollamaの接続先はlocalhost、127.0.0.1、または::1に限定されます。')
  }
  if (url.pathname !== '/' || url.search || url.hash) {
    throw new Error('Ollamaの接続先は例のようにサーバーのURLだけを指定してください。')
  }
  return url.origin
}

export class OllamaClient {
  readonly baseUrl: string

  constructor(baseUrl: string) {
    this.baseUrl = normalizeOllamaBaseUrl(baseUrl)
  }

  async listModels(): Promise<LocalModel[]> {
    const response = await this.fetch('/api/tags', { signal: AbortSignal.timeout(5_000) })
    const payload = (await response.json()) as {
      models?: Array<{
        name?: unknown
        size?: unknown
        details?: { parameter_size?: unknown; quantization_level?: unknown }
      }>
    }
    if (!Array.isArray(payload.models)) throw new Error('Ollamaからモデル一覧を取得できませんでした。')
    return payload.models
      .filter((model): model is typeof model & { name: string } => typeof model.name === 'string')
      .map((model) => ({
        name: model.name,
        size: typeof model.size === 'number' ? model.size : 0,
        parameterSize:
          typeof model.details?.parameter_size === 'string' ? model.details.parameter_size : undefined,
        quantizationLevel:
          typeof model.details?.quantization_level === 'string'
            ? model.details.quantization_level
            : undefined
      }))
      .sort((a, b) => a.name.localeCompare(b.name))
  }

  async chat(options: {
    model: string
    messages: OllamaMessage[]
    format?: Record<string, unknown>
    signal?: AbortSignal
    generationOptions?: OllamaGenerationOptions
    think?: boolean | 'low' | 'medium' | 'high'
  }): Promise<string> {
    const generationOptions = {
      ...(options.format ? { temperature: 0 } : {}),
      ...options.generationOptions
    }
    const response = await this.fetch('/api/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: options.model,
        messages: options.messages,
        stream: false,
        ...(options.think !== undefined ? { think: options.think } : {}),
        ...(options.format ? { format: options.format } : {}),
        ...(Object.keys(generationOptions).length > 0 ? { options: generationOptions } : {})
      }),
      signal: options.signal
    })
    const payload = (await response.json()) as OllamaChatChunk
    if (payload.error) throw new Error(payload.error)
    const content = payload.message?.content
    if (typeof content !== 'string') throw new Error('Ollamaから正しい応答を受け取れませんでした。')
    return content
  }

  async streamChat(options: {
    model: string
    messages: OllamaMessage[]
    signal: AbortSignal
    onDelta: (delta: string) => void
    generationOptions?: OllamaGenerationOptions
  }): Promise<string> {
    const response = await this.fetch('/api/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: options.model,
        messages: options.messages,
        stream: true,
        think: false,
        ...(options.generationOptions ? { options: options.generationOptions } : {})
      }),
      signal: options.signal
    })
    if (!response.body) throw new Error('Ollamaのストリームを開始できませんでした。')

    const reader = response.body.getReader()
    const decoder = new TextDecoder()
    let buffer = ''
    let content = ''

    const consume = (line: string): void => {
      if (!line.trim()) return
      let chunk: OllamaChatChunk
      try {
        chunk = JSON.parse(line) as OllamaChatChunk
      } catch {
        throw new Error('Ollamaから不正なストリームデータを受信しました。')
      }
      if (chunk.error) throw new Error(chunk.error)
      const delta = chunk.message?.content
      if (typeof delta === 'string' && delta) {
        content += delta
        options.onDelta(delta)
      }
    }

    while (true) {
      const { done, value } = await reader.read()
      buffer += decoder.decode(value, { stream: !done })
      const lines = buffer.split('\n')
      buffer = lines.pop() ?? ''
      for (const line of lines) consume(line)
      if (done) break
    }
    consume(buffer)
    return content
  }

  private async fetch(path: string, init: RequestInit): Promise<Response> {
    let response: Response
    try {
      response = await fetch(`${this.baseUrl}${path}`, init)
    } catch (error) {
      if (error instanceof Error && error.name === 'AbortError') throw error
      if (error instanceof Error && error.name === 'TimeoutError') {
        throw new Error('Ollamaへの接続がタイムアウトしました。起動状態を確認してください。')
      }
      throw new Error('Ollamaに接続できません。Ollamaが起動しているか確認してください。')
    }
    if (!response.ok) {
      let detail = ''
      try {
        const payload = (await response.json()) as { error?: unknown }
        if (typeof payload.error === 'string') detail = payload.error
      } catch {
        // Some proxies return a plain response without JSON.
      }
      throw new Error(detail || `Ollamaがエラーを返しました（HTTP ${response.status}）。`)
    }
    return response
  }
}

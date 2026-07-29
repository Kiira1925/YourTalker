import { describe, expect, it, vi } from 'vitest'
import { normalizeOllamaBaseUrl, OllamaClient } from '../src/main/ollama-client'

describe('OllamaClient', () => {
  it('accepts only loopback server URLs', () => {
    expect(normalizeOllamaBaseUrl('http://localhost:11434/')).toBe('http://localhost:11434')
    expect(normalizeOllamaBaseUrl('http://127.0.0.1:11434')).toBe('http://127.0.0.1:11434')
    expect(() => normalizeOllamaBaseUrl('https://example.com')).toThrow('ローカル利用を保つため')
    expect(() => normalizeOllamaBaseUrl('file:///tmp/ollama')).toThrow('httpまたはhttps')
  })

  it('lists installed models with useful details', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      Response.json({
        models: [
          {
            name: 'gemma3:4b',
            size: 3_300_000_000,
            details: { parameter_size: '4.3B', quantization_level: 'Q4_K_M' }
          }
        ]
      })
    )
    vi.stubGlobal('fetch', fetchMock)

    const models = await new OllamaClient('http://127.0.0.1:11434').listModels()

    expect(models).toEqual([
      {
        name: 'gemma3:4b',
        size: 3_300_000_000,
        parameterSize: '4.3B',
        quantizationLevel: 'Q4_K_M'
      }
    ])
    expect(fetchMock).toHaveBeenCalledWith(
      'http://127.0.0.1:11434/api/tags',
      expect.objectContaining({ signal: expect.any(AbortSignal) })
    )
    vi.unstubAllGlobals()
  })

  it('parses newline-delimited streaming chat responses', async () => {
    const body = [
      JSON.stringify({ message: { role: 'assistant', content: 'おかえり。' }, done: false }),
      JSON.stringify({ message: { role: 'assistant', content: '待ってたよ。' }, done: true })
    ].join('\n')
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(body, { status: 200 })))
    const deltas: string[] = []

    const content = await new OllamaClient('http://localhost:11434').streamChat({
      model: 'gemma3:4b',
      messages: [{ role: 'user', content: 'ただいま' }],
      signal: new AbortController().signal,
      onDelta: (delta) => deltas.push(delta)
    })

    expect(content).toBe('おかえり。待ってたよ。')
    expect(deltas).toEqual(['おかえり。', '待ってたよ。'])
    vi.unstubAllGlobals()
  })
})

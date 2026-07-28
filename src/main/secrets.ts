import { randomUUID } from 'node:crypto'
import { readFile, rename, unlink, writeFile } from 'node:fs/promises'
import { safeStorage } from 'electron'

export class SecretStore {
  constructor(private readonly path: string) {}

  async has(): Promise<boolean> {
    try {
      return (await readFile(this.path)).length > 0
    } catch {
      return false
    }
  }

  async set(apiKey: string): Promise<void> {
    if (!(await safeStorage.isAsyncEncryptionAvailable())) {
      throw new Error('Windowsの暗号化機能を利用できないため、APIキーを保存できません。')
    }
    const encrypted = await safeStorage.encryptStringAsync(apiKey.trim())
    const tempPath = `${this.path}.${randomUUID()}.tmp`
    await writeFile(tempPath, encrypted)
    try {
      await rename(tempPath, this.path)
    } catch {
      try {
        await unlink(this.path)
      } catch {
        // The secret file does not exist on first save.
      }
      await rename(tempPath, this.path)
    }
  }

  async get(): Promise<string> {
    if (!(await this.has())) throw new Error('OpenAI APIキーが設定されていません。')
    const encrypted = await readFile(this.path)
    const decrypted = await safeStorage.decryptStringAsync(encrypted)
    if (decrypted.shouldReEncrypt) await this.set(decrypted.result)
    return decrypted.result
  }

  async remove(): Promise<void> {
    try {
      await unlink(this.path)
    } catch {
      // Removing an unset key is idempotent.
    }
  }
}

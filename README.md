# YourTalker

思い描いたキャラクターを設定し、会話の違和感を指摘しながら「その人らしさ」を育てられるWindowsデスクトップアプリです。

## 主な機能

- 複数キャラクターと会話の分離管理
- OpenAI Responses APIまたはOllamaローカルLLMによるストリーミング会話
- APIキー不要で会話・紹介文解析・指摘修正・要約を端末内処理
- 返答への指摘から、恒久ルールと修正版を自動生成
- 指摘原文・元返答・修正版を残す監査履歴
- 指摘ルールの無効化と再有効化
- AppDataへのJSON自動保存、日次7世代バックアップ
- 全データ／キャラクター単体のJSON書き出しと復元
- Windowsの暗号化機能によるAPIキー保護
- アプリ内での更新確認、進捗表示、再起動適用

## 開発

Node.js 20以降を用意し、次を実行します。

```powershell
npm.cmd install
npm.cmd run dev
```

テストとビルド:

```powershell
npm.cmd test
npm.cmd run build
```

Windowsインストーラー:

```powershell
npm.cmd run package:win
```

生成物は `release` フォルダに出力されます。

公開GitHubリポジトリへ `v<version>` タグをpushすると、GitHub Actionsが自動更新対応のWindowsリリースを作成します。GitHub以外へ配信する方法や成果物の公開順序は [docs/UPDATES.md](docs/UPDATES.md) を参照してください。

## ローカルLLMを使う

1. [Ollama for Windows](https://ollama.com/download/windows) をインストールして起動します。
2. PowerShellで使用するモデルを取得します。

```powershell
ollama pull gemma3:4b
```

3. YourTalkerの「設定とデータ」→「会話の生成方法」で「ローカルLLM」を選びます。
4. 「接続確認」を押してモデルを選び、設定を保存します。

接続先は既定で `http://127.0.0.1:11434` です。ローカルモードではOpenAI APIキーは不要で、キャラクター設定と会話内容は端末外へ送信されません。モデルの必要メモリ・応答品質・速度は使用するモデルとPC性能により異なります。

## 保存場所

通常は `%APPDATA%\YourTalker\data` に保存されます。アプリの「設定とデータ」から保存フォルダを開けます。

- `manifest.json`: 選択状態とモデル設定
- `characters`: キャラクター設定と指摘履歴
- `conversations`: 会話履歴と要約
- `backups`: 自動バックアップ
- `secrets.bin`: OS機能で暗号化したOpenAI APIキー

APIキーはエクスポートに含まれません。OpenAIモードではキャラクター設定と会話の必要部分が生成時にOpenAI APIへ送信されます。ローカルLLMモードではOllamaのループバック接続だけを使用します。

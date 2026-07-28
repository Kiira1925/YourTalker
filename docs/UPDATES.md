# YourTalker 自動更新の配信手順

YourTalkerは、公開GitHubリポジトリのGitHub Releasesを更新配信先として使います。更新元のowner/repositoryはGitHub Actionsの `GITHUB_REPOSITORY` からビルド時に固定され、エンドユーザーは変更できません。

## 初回の自動更新対応版

バージョン0.1.0には更新クライアントがないため、0.2.0だけは既存利用者が新しいインストーラーを手動で上書きインストールする必要があります。0.2.0以降はアプリ内更新を利用できます。

## GitHub Releasesでの公開

`.github/workflows/release.yml` がWindows上でテスト、ビルド、リリース公開を行います。

1. `package.json` のバージョンを上げる
2. 同じバージョンのタグを作る（例：`v0.3.0`）
3. タグをGitHubへpushする
4. GitHub ActionsがドラフトリリースへEXEとblockmapを先にアップロードする
5. `latest.yml` を最後にアップロードし、リリースを公開する

アプリにはGitHubリポジトリが更新元として埋め込まれ、公開済みの最新リリースを自動確認します。private repositoryでは利用者ごとのGitHub認証が必要になるため、この配布方式ではpublic repositoryを前提とします。

## GitHub以外へ手動配信する場合

`GITHUB_REPOSITORY` がないローカルビルドでは、代わりにHTTPSフィードを指定できます。

```powershell
$env:YOURTALKER_UPDATE_URL = 'https://downloads.example.com/yourtalker/windows'
npm.cmd run package:win
```

`release` に次の3ファイルが生成されます。

- `latest.yml`
- `YourTalker-Setup-<version>.exe`
- `YourTalker-Setup-<version>.exe.blockmap`

GitHub Actionsのビルドでは、パッケージ内の `resources/app-update.yml` もGitHub Releasesを参照します。

## 手動配信時の公開順序

同じHTTPSディレクトリへ、必ず次の順序で公開します。

1. 新しいセットアップEXE
2. 対応するblockmap
3. 最後に `latest.yml`

`latest.yml` を先に公開すると、公開途中に更新確認したアプリが未配置のEXEを取得しようとして失敗します。過去のEXEとblockmapは差分更新に使われるため、直前バージョンまでは削除しないでください。

配信先はRangeリクエスト、正しいContent-Length、HTTPSに対応させます。`latest.yml` は短いキャッシュまたは再検証、バージョン付きEXEとblockmapはimmutableキャッシュが適します。

## リリースごとの確認

1. `package.json` のバージョンを上げる
2. `CHANGELOG.md` に変更点を書く
3. テストと型検査を実行する
4. GitHubタグをpushしてワークフローを実行する
5. コード署名された成果物と公開済みReleaseを確認する
6. 一つ前のインストール版から更新検出、ダウンロード、再起動、データ保持を確認する

更新適用前には `%APPDATA%\YourTalker\data\backups` へ完全バックアップが作られます。バックアップに失敗した場合、アプリは再起動・更新を行いません。

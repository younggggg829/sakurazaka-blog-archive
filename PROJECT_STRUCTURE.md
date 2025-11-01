# プロジェクト構造

## 📁 ディレクトリ構造

```
sakurazaka-blog-archive/
├── 📄 主要ファイル
│   ├── index.js                    # CLIメインエントリーポイント
│   ├── webServer.js                # Webサーバー
│   ├── database.js                 # データベース層
│   ├── blogScraper.js              # 櫻坂46スクレイパー
│   ├── keyakiBlogScraper.js        # 欅坂46スクレイパー
│   ├── imageDownloader.js          # 画像ダウンローダー
│   ├── fetchMembers.js             # メンバー情報取得
│   ├── storageAdapter.js           # ストレージ抽象化
│   └── config.js                   # 設定ファイル
│
├── 📂 utils/ (新規 - 共通ユーティリティ)
│   ├── dateUtils.js                # 日付処理
│   ├── dateUtils.test.js           # 日付処理テスト
│   ├── constants.js                # 定数定義
│   ├── formatting.js               # テキスト処理
│   ├── formatting.test.js          # テキスト処理テスト
│   ├── scraperUtils.js             # スクレイピング共通処理
│   └── errorHandler.js             # エラーハンドリング
│
├── 📂 views/ (EJSテンプレート)
│   ├── index.ejs                   # メインページ
│   ├── search.ejs                  # 検索結果
│   ├── members.ejs                 # メンバー一覧
│   ├── member.ejs                  # メンバー詳細
│   └── post.ejs                    # 投稿詳細
│
├── 📂 public/ (静的ファイル)
│   └── css/style.css               # スタイルシート
│
├── 📂 images/ (ダウンロード済み画像)
│   └── [メンバー名_サイト名]/
│
├── 📄 データ・設定ファイル
│   ├── sakurazaka_blog.db          # SQLiteデータベース
│   ├── image_cache.json            # 画像キャッシュ情報
│   ├── package.json                # npm設定（Jest追加)
│   └── config.js                   # アプリケーション設定
│
├── 📄 Docker関連
│   ├── Dockerfile
│   ├── docker-compose.yml
│   └── .dockerignore
│
└── 📄 ドキュメント
    ├── README.md                   # プロジェクト概要
    ├── REFACTORING.md              # リファクタリング報告
    ├── PROJECT_STRUCTURE.md        # このファイル
    └── DEPLOYMENT.md               # デプロイ手順
```

## 📊 ファイル統計

### メインコード

| カテゴリ       | ファイル数 | 総行数      |
| -------------- | ---------- | ----------- |
| コアロジック   | 9 ファイル | 約 3,500 行 |
| ユーティリティ | 5 ファイル | 約 640 行   |
| テスト         | 2 ファイル | 約 254 行   |
| テンプレート   | 5 ファイル | 約 1,190 行 |

## 🎯 主要コンポーネント

### 1. CLI インターフェース (index.js)

- メンバー選択
- スクレイピング実行
- 検索機能
- Web サーバー起動

### 2. Web サーバー (webServer.js)

- Express.js ベース
- EJS テンプレート使用
- REST API エンドポイント

### 3. データベース (database.js)

- SQLite3 使用
- async/await 対応
- 3 テーブル構成

### 4. スクレイパー

- **blogScraper.js** - 櫻坂 46
- **keyakiBlogScraper.js** - 欅坂 46
- Playwright 使用
- レート制限機能

### 5. ユーティリティ (utils/)

- 日付処理
- テキスト処理
- 定数管理
- エラーハンドリング

## 🔧 技術スタック

### バックエンド

- Node.js 20+
- Express.js 5.1.0
- SQLite3 5.1.7
- Playwright 1.56.1

### 開発ツール

- Jest 29.7.0
- Inquirer 12.10.0
- Chalk 4.1.2

---

**最終更新:** 2025-10-30
**バージョン:** v1.1.0

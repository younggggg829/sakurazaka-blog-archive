# 櫻坂 46・欅坂 46 ブログスクレイピングツール デプロイメントガイド

このドキュメントでは、本プロジェクトを別の環境にデプロイする手順を説明します。

## 目次

- [システム要件](#システム要件)
- [環境別セットアップ](#環境別セットアップ)
- [初回セットアップ手順](#初回セットアップ手順)
- [設定とカスタマイズ](#設定とカスタマイズ)
- [トラブルシューティング](#トラブルシューティング)
- [バックアップとメンテナンス](#バックアップとメンテナンス)

---

## システム要件

### 必須ソフトウェア

- **Node.js**: v18.0.0 以上（推奨: v20.x LTS）
- **npm**: v9.0.0 以上
- **Git**: バージョン管理用（オプション）

### システムリソース

- **ディスク容量**: 最低 2GB 以上（画像保存用に追加容量が必要）
- **メモリ**: 最低 1GB RAM（推奨: 2GB 以上）
- **ネットワーク**: インターネット接続必須

### 対応 OS

- macOS 10.15 以上
- Windows 10/11
- Linux (Ubuntu 20.04 以上、Debian 11 以上、CentOS 8 以上)

---

## 環境別セットアップ

### A. ローカル環境

#### 1. Node.js のインストール

**macOS:**

```bash
# Homebrewを使用
brew install node

# または公式サイトからダウンロード
# https://nodejs.org/
```

**Windows:**

```powershell
# 公式サイトからインストーラーをダウンロード
# https://nodejs.org/

# またはwingetを使用
winget install OpenJS.NodeJS.LTS
```

**Linux (Ubuntu/Debian):**

```bash
# NodeSource repositoryを使用
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
sudo apt-get install -y nodejs

# ビルドツールも必要
sudo apt-get install -y build-essential
```

**Linux (CentOS/RHEL):**

```bash
# NodeSource repositoryを使用
curl -fsSL https://rpm.nodesource.com/setup_20.x | sudo bash -
sudo yum install -y nodejs

# ビルドツールも必要
sudo yum groupinstall 'Development Tools'
```

#### 2. インストール確認

```bash
node --version  # v18以上であることを確認
npm --version   # v9以上であることを確認
```

---

### B. クラウド環境

#### AWS EC2

**1. EC2 インスタンスの作成**

- AMI: Ubuntu Server 22.04 LTS
- インスタンスタイプ: t2.micro 以上（推奨: t2.small）
- ストレージ: 20GB 以上（画像保存量に応じて調整）
- セキュリティグループ:
  - SSH (22) - 管理用
  - HTTP (80) または カスタム TCP (3000) - Web ビューアー用（必要に応じて）

**2. 接続とセットアップ**

```bash
# SSHで接続
ssh -i your-key.pem ubuntu@your-instance-ip

# システムアップデート
sudo apt update && sudo apt upgrade -y

# Node.jsインストール
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
sudo apt-get install -y nodejs build-essential

# 必要なシステムライブラリ（Playwright用）
sudo apt-get install -y \
    libnss3 \
    libatk1.0-0 \
    libatk-bridge2.0-0 \
    libcups2 \
    libdrm2 \
    libxkbcommon0 \
    libxcomposite1 \
    libxdamage1 \
    libxfixes3 \
    libxrandr2 \
    libgbm1 \
    libasound2
```

**3. 画像ストレージオプション**

EC2 では以下の方法で画像を保存できます：

**オプション A: ローカルディスク（デフォルト、設定不要）**

```bash
# プロジェクトディレクトリにimages/フォルダが自動作成される
# 追加設定不要で動作
```

**オプション B: S3 ストレージ（大規模運用向け）**

```bash
# 環境変数を設定
export STORAGE_TYPE=s3
export S3_BUCKET=your-bucket-name
export S3_REGION=ap-northeast-1
export S3_BASE_URL=https://your-cloudfront-domain.cloudfront.net

# または.envファイルに記載
```

**推奨構成:**

- 小〜中規模（〜10GB 画像）: ローカルディスク（デフォルト）
- 大規模（10GB 以上）: S3 + CloudFront

#### Google Cloud Platform (GCP)

**1. Compute Engine インスタンス作成**

```bash
gcloud compute instances create sakurazaka-blog \
  --image-family=ubuntu-2204-lts \
  --image-project=ubuntu-os-cloud \
  --machine-type=e2-small \
  --boot-disk-size=20GB \
  --zone=asia-northeast1-a
```

**2. 接続とセットアップ**

```bash
# SSH接続
gcloud compute ssh sakurazaka-blog --zone=asia-northeast1-a

# Node.jsインストール（AWS EC2と同じ手順）
```

#### Azure VM

**1. VM の作成**

```bash
az vm create \
  --resource-group sakurazaka-rg \
  --name sakurazaka-blog \
  --image UbuntuLTS \
  --size Standard_B1s \
  --admin-username azureuser \
  --generate-ssh-keys
```

**2. 接続とセットアップ**

```bash
# SSH接続
ssh azureuser@your-vm-ip

# Node.jsインストール（AWS EC2と同じ手順）
```

#### Docker コンテナ（推奨）

**Dockerfile:**

```dockerfile
FROM node:20-slim

# Playwrightの依存関係をインストール
RUN apt-get update && apt-get install -y \
    libnss3 \
    libatk1.0-0 \
    libatk-bridge2.0-0 \
    libcups2 \
    libdrm2 \
    libxkbcommon0 \
    libxcomposite1 \
    libxdamage1 \
    libxfixes3 \
    libxrandr2 \
    libgbm1 \
    libasound2 \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# package.jsonをコピーして依存関係をインストール
COPY package*.json ./
RUN npm ci

# Playwrightブラウザをインストール
RUN npx playwright install chromium

# アプリケーションファイルをコピー
COPY . .

# データ永続化用のボリューム
VOLUME ["/app/images", "/app/sakurazaka_blog.db", "/app/image_cache.json"]

# ポート公開（Webビューアー用）
EXPOSE 3000

CMD ["npm", "start"]
```

**docker-compose.yml:**

```yaml
version: "3.8"

services:
  sakurazaka-blog:
    build: .
    container_name: sakurazaka-blog
    volumes:
      - ./images:/app/images
      - ./sakurazaka_blog.db:/app/sakurazaka_blog.db
      - ./image_cache.json:/app/image_cache.json
    ports:
      - "3000:3000"
    restart: unless-stopped
    environment:
      - NODE_ENV=production
```

**使用方法:**

```bash
# イメージビルドと起動
docker-compose up -d

# ログ確認
docker-compose logs -f

# コンテナに入る
docker-compose exec sakurazaka-blog bash

# 停止
docker-compose down
```

---

## 初回セットアップ手順

### 1. プロジェクトの取得

**Git を使用する場合:**

```bash
# リポジトリをクローン
git clone <repository-url>
cd sakurazaka-blog-archive
```

**手動コピーの場合:**

```bash
# プロジェクトディレクトリを作成
mkdir sakurazaka-blog-archive
cd sakurazaka-blog-archive

# ファイルを転送（scp、rsync、またはFTPなど）
# 例: SCPを使用
scp -r /path/to/local/sakurazaka-blog-archive/* user@remote:/path/to/sakurazaka-blog-archive/
```

### 2. 依存パッケージのインストール

```bash
# Node.js依存パッケージをインストール
npm install

# Playwrightブラウザをインストール
npx playwright install chromium

# システム依存関係をインストール（Linux）
npx playwright install-deps chromium
```

**Windows の場合:**

```powershell
# 管理者権限でPowerShellを開く必要がある場合があります
npm install
npx playwright install chromium
```

### 3. ディレクトリ構造の確認

インストール後、以下のディレクトリ構造になっていることを確認：

```
sakurazaka-blog-archive/
├── node_modules/          # npm依存パッケージ
├── public/                # 静的ファイル
│   └── css/
│       └── style.css
├── views/                 # EJSテンプレート
│   ├── index.ejs
│   ├── members.ejs
│   ├── member.ejs
│   ├── post.ejs
│   └── search.ejs
├── images/                # 画像保存先（自動作成）
├── blogScraper.js         # 櫻坂46スクレイパー
├── keyakiBlogScraper.js   # 欅坂46スクレイパー
├── fetchMembers.js        # メンバー情報取得
├── imageDownloader.js     # 画像ダウンロード
├── database.js            # SQLiteデータベース
├── webServer.js           # Expressサーバー
├── index.js               # CLIメインプログラム
├── package.json           # プロジェクト設定
├── sakurazaka_blog.db     # SQLiteデータベース（自動作成）
├── image_cache.json       # 画像キャッシュ（自動作成）
└── README.md              # プロジェクト説明
```

### 4. 初回起動テスト

```bash
# CLIモードで起動
npm start

# または直接実行
node index.js
```

正常に起動すると以下のメニューが表示されます：

```
=== Sakurazaka46 Blog Tool ===

? What would you like to do? (Use arrow keys)
❯ 🌐 Open member blog in browser
  💾 Scrape and save sakurazaka46 blog posts
  🌳 Scrape Keyakizaka46 blog posts
  🔍 Search saved blog posts
  🌐 Webページビューアーを起動
  ❌ Exit
```

### 5. Web サーバーモード（オプション）

```bash
# Web UIでアクセスする場合
node webServer.js

# またはCLIから起動
npm start
# → 「Webページビューアーを起動」を選択
```

ブラウザで `http://localhost:3000` にアクセスして動作確認

---

## 設定とカスタマイズ

### ストレージ設定（config.js）

プロジェクトは`config.js`を使用して環境に応じたストレージ設定を管理します。

**デフォルト設定（ローカル環境・EC2 など）:**

```javascript
// config.js
const config = {
  storage: {
    type: "local", // デフォルト: ローカルストレージ
    local: {
      baseDir: __dirname,
      imagesDir: "images",
    },
  },
};
```

この設定では：

- **ローカル開発環境**: そのまま動作
- **EC2/GCP/Azure**: そのまま動作（追加設定不要）
- **Docker**: ボリュームマウントで動作
- 画像は`images/`ディレクトリに保存され、Express.static で配信

**S3 ストレージを使用する場合:**

環境変数を設定：

```bash
# .envファイルまたはシステム環境変数
STORAGE_TYPE=s3
S3_BUCKET=your-bucket-name
S3_REGION=ap-northeast-1
S3_BASE_URL=https://your-cloudfront-domain.cloudfront.net
# またはS3直接: https://your-bucket.s3.ap-northeast-1.amazonaws.com
```

この設定では：

- 画像は指定されたベース URL から配信
- S3 へのアップロード機能は別途実装が必要
- CloudFront と組み合わせることでグローバル配信が可能

**環境別の動作:**

| 環境            | STORAGE_TYPE        | 設定               | 画像 URL 例                                      |
| --------------- | ------------------- | ------------------ | ------------------------------------------------ |
| ローカル開発    | local（デフォルト） | 不要               | `/images/member/post.jpg`                        |
| EC2             | local（デフォルト） | 不要               | `/images/member/post.jpg`                        |
| Docker          | local（デフォルト） | ボリュームマウント | `/images/member/post.jpg`                        |
| S3 + CloudFront | s3                  | S3_BASE_URL 設定   | `https://cdn.example.com/images/member/post.jpg` |

### データベース設定

デフォルトでは SQLite を使用します。設定は`config.js`で管理されます。

```javascript
// config.js
const config = {
  database: {
    path: path.join(__dirname, "sakurazaka_blog.db"),
  },
};
```

### スクレイピング設定

#### レート制限の調整

**櫻坂 46 (`blogScraper.js`):**

```javascript
const RATE_LIMIT = {
  REQUESTS_PER_MINUTE: 15, // 1分間の最大リクエスト数
  MIN_DELAY: 2000, // 最小遅延（ミリ秒）
  MAX_DELAY: 4000, // 最大遅延（ミリ秒）
  BURST_LIMIT: 10, // 連続リクエスト制限
  LONG_BREAK: 5000, // 長時間休憩（ミリ秒）
};
```

**欅坂 46 (`keyakiBlogScraper.js`):**
同様の設定が可能です。

**注意:** レート制限を緩めすぎると、対象サイトからアクセス制限を受ける可能性があります。

#### タイムアウト設定

```javascript
// ページ読み込みタイムアウト
await page.goto(url, {
  waitUntil: "domcontentloaded",
  timeout: 30000, // 30秒（調整可能）
});
```

### 画像保存設定

**`imageDownloader.js`:**

```javascript
// 画像保存ディレクトリ
const IMAGE_DIR = path.join(__dirname, "images");

// 並列ダウンロード数
const maxConcurrent = 3; // 同時ダウンロード数（調整可能）

// リトライ回数
const retryCount = 3; // ダウンロード失敗時のリトライ回数
```

### Web サーバー設定

**`webServer.js`:**

```javascript
const PORT = 3000; // ポート番号（変更可能）

// 本番環境でポート80を使用する場合
const PORT = process.env.PORT || 80;
```

**リバースプロキシ設定（Nginx 例）:**

```nginx
server {
    listen 80;
    server_name your-domain.com;

    location / {
        proxy_pass http://localhost:3000;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host $host;
        proxy_cache_bypass $http_upgrade;
    }
}
```

---

## バックグラウンド実行（Linux/macOS）

### systemd サービス（推奨）

**`/etc/systemd/system/sakurazaka-blog.service`:**

```ini
[Unit]
Description=Sakurazaka46 Blog Scraping Tool
After=network.target

[Service]
Type=simple
User=your-username
WorkingDirectory=/path/to/sakurazaka-blog-archive
ExecStart=/usr/bin/node /path/to/sakurazaka-blog-archive/webServer.js
Restart=on-failure
RestartSec=10
StandardOutput=syslog
StandardError=syslog
SyslogIdentifier=sakurazaka-blog

[Install]
WantedBy=multi-user.target
```

**サービスの管理:**

```bash
# サービスを有効化
sudo systemctl enable sakurazaka-blog

# サービスを開始
sudo systemctl start sakurazaka-blog

# ステータス確認
sudo systemctl status sakurazaka-blog

# ログ確認
sudo journalctl -u sakurazaka-blog -f

# サービスを停止
sudo systemctl stop sakurazaka-blog
```

### PM2（Node.js プロセスマネージャー）

```bash
# PM2をグローバルインストール
npm install -g pm2

# アプリケーションを起動
pm2 start webServer.js --name sakurazaka-blog

# ステータス確認
pm2 status

# ログ確認
pm2 logs sakurazaka-blog

# 再起動
pm2 restart sakurazaka-blog

# 停止
pm2 stop sakurazaka-blog

# 自動起動設定
pm2 startup
pm2 save
```

### screen/tmux（シンプルな方法）

```bash
# screenを使用
screen -S sakurazaka
cd /path/to/sakurazaka-blog-archive
node webServer.js
# Ctrl+A → D でデタッチ

# 再接続
screen -r sakurazaka

# または tmuxを使用
tmux new -s sakurazaka
cd /path/to/sakurazaka-blog-archive
node webServer.js
# Ctrl+B → D でデタッチ

# 再接続
tmux attach -t sakurazaka
```

---

## トラブルシューティング

### 1. Playwright のインストールエラー

**症状:** `npx playwright install`が失敗する

**解決策:**

```bash
# Linux: 必要なシステムライブラリをインストール
sudo npx playwright install-deps

# 特定のブラウザのみインストール
npx playwright install chromium

# キャッシュをクリアして再インストール
rm -rf ~/.cache/ms-playwright
npx playwright install chromium
```

### 2. データベースロックエラー

**症状:** `SQLITE_BUSY: database is locked`

**解決策:**

```bash
# データベースファイルの権限を確認
ls -l sakurazaka_blog.db

# 権限を修正
chmod 664 sakurazaka_blog.db

# プロセスが重複していないか確認
ps aux | grep node
```

### 3. ポート使用中エラー

**症状:** `EADDRINUSE: address already in use :::3000`

**解決策:**

```bash
# ポートを使用しているプロセスを確認
# macOS/Linux
lsof -i :3000

# Windows
netstat -ano | findstr :3000

# プロセスを終了
kill -9 <PID>

# または別のポートを使用
PORT=8080 node webServer.js
```

### 4. メモリ不足エラー

**症状:** `JavaScript heap out of memory`

**解決策:**

```bash
# Node.jsのメモリ制限を増やす
NODE_OPTIONS="--max-old-space-size=4096" node index.js

# またはpackage.jsonに追加
"scripts": {
  "start": "NODE_OPTIONS='--max-old-space-size=4096' node index.js"
}
```

### 5. 画像ダウンロードエラー

**症状:** 画像ダウンロードが失敗する

**解決策:**

```bash
# ディレクトリの権限を確認
ls -ld images/

# 権限を修正
chmod 755 images/

# キャッシュをクリア
rm image_cache.json

# ネットワーク接続を確認
ping sakurazaka46.com
```

### 6. スクレイピングで 0 件取得される

**チェックリスト:**

- [ ] インターネット接続が正常か
- [ ] 対象サイトがアクセス可能か（ブラウザで確認）
- [ ] メンバー ID が正しいか
- [ ] レート制限に引っかかっていないか

**デバッグモード:**

```bash
# ヘッドレスモードを無効化して動作確認
# blogScraper.js または keyakiBlogScraper.js内
const browser = await chromium.launch({ headless: false });
```

---

## バックアップとメンテナンス

### 定期バックアップ

**重要なファイル:**

- `sakurazaka_blog.db` - データベース
- `images/` - ダウンロードした画像
- `image_cache.json` - 画像キャッシュ情報

**バックアップスクリプト例:**

```bash
#!/bin/bash
# backup.sh

BACKUP_DIR="/path/to/backup"
DATE=$(date +%Y%m%d_%H%M%S)
PROJECT_DIR="/path/to/sakurazaka-blog-archive"

mkdir -p $BACKUP_DIR

# データベースをバックアップ
cp $PROJECT_DIR/sakurazaka_blog.db $BACKUP_DIR/blogs_$DATE.db

# 画像をバックアップ（大容量の場合は注意）
tar -czf $BACKUP_DIR/images_$DATE.tar.gz -C $PROJECT_DIR images/

# キャッシュをバックアップ
cp $PROJECT_DIR/image_cache.json $BACKUP_DIR/image_cache_$DATE.json

# 古いバックアップを削除（30日以上）
find $BACKUP_DIR -name "*.db" -mtime +30 -delete
find $BACKUP_DIR -name "*.tar.gz" -mtime +30 -delete

echo "Backup completed: $DATE"
```

**cron で自動化:**

```bash
# crontabを編集
crontab -e

# 毎日午前3時にバックアップ
0 3 * * * /path/to/backup.sh >> /var/log/sakurazaka-backup.log 2>&1
```

### データベースメンテナンス

```bash
# データベースの最適化
sqlite3 sakurazaka_blog.db "VACUUM;"

# データベースの整合性チェック
sqlite3 sakurazaka_blog.db "PRAGMA integrity_check;"

# データベースサイズの確認
du -h sakurazaka_blog.db
```

### ログローテーション

```bash
# /etc/logrotate.d/sakurazaka-blog
/var/log/sakurazaka-blog.log {
    daily
    rotate 7
    compress
    delaycompress
    missingok
    notifempty
}
```

---

## セキュリティ考慮事項

### 1. ファイアウォール設定

```bash
# UFW (Ubuntu)
sudo ufw allow 22/tcp   # SSH
sudo ufw allow 80/tcp   # HTTP（必要な場合のみ）
sudo ufw enable

# firewalld (CentOS)
sudo firewall-cmd --permanent --add-service=ssh
sudo firewall-cmd --permanent --add-service=http
sudo firewall-cmd --reload
```

### 2. 非 root ユーザーで実行

```bash
# 専用ユーザーを作成
sudo useradd -m -s /bin/bash sakurazaka
sudo su - sakurazaka

# ファイルの所有権を変更
sudo chown -R sakurazaka:sakurazaka /path/to/sakurazaka-blog-archive
```

### 3. アクセス制限（Nginx Basic Auth 例）

```nginx
location / {
    auth_basic "Restricted Access";
    auth_basic_user_file /etc/nginx/.htpasswd;
    proxy_pass http://localhost:3000;
}
```

```bash
# パスワードファイルを作成
sudo htpasswd -c /etc/nginx/.htpasswd username
```

### 4. HTTPS 化（Let's Encrypt）

```bash
# Certbotをインストール
sudo apt install certbot python3-certbot-nginx

# 証明書を取得
sudo certbot --nginx -d your-domain.com

# 自動更新テスト
sudo certbot renew --dry-run
```

---

## パフォーマンス最適化

### 1. 画像圧縮

大量の画像をダウンロードする場合、ストレージ削減のために圧縮を検討：

```bash
# ImageMagickを使用
sudo apt install imagemagick

# 一括圧縮スクリプト
find images/ -name "*.jpg" -exec mogrify -quality 85 {} \;
```

### 2. データベースインデックス

頻繁に検索する場合、インデックスを追加：

```sql
-- database.jsに追加
CREATE INDEX IF NOT EXISTS idx_member_id ON blog_posts(member_id);
CREATE INDEX IF NOT EXISTS idx_date ON blog_posts(date);
CREATE INDEX IF NOT EXISTS idx_site ON blog_posts(site);
```

### 3. キャッシュ戦略

Web サーバーでキャッシュを有効化：

```javascript
// webServer.js
app.use(
  express.static("public", {
    maxAge: "1d", // 静的ファイルを1日キャッシュ
    etag: true,
  })
);
```

---

## 環境変数の使用

**`.env` ファイル作成（オプション）:**

```env
# サーバー設定
NODE_ENV=production
PORT=3000
HOST=0.0.0.0

# ストレージ設定
STORAGE_TYPE=local              # 'local' または 's3'
S3_BUCKET=your-bucket-name      # S3使用時のみ
S3_REGION=ap-northeast-1        # S3使用時のみ
S3_BASE_URL=https://cdn.example.com  # S3使用時のみ

# その他（将来の拡張用）
MAX_CONCURRENT_DOWNLOADS=3
RATE_LIMIT_PER_MINUTE=15
```

**使用方法:**

```bash
# dotenvパッケージをインストール
npm install dotenv

# コード内で読み込み（config.jsで既に実装済み）
require('dotenv').config();

const PORT = process.env.PORT || 3000;
```

**重要な注意事項:**

- **ローカル・EC2・Docker 環境**: `.env`ファイルは不要（デフォルト設定で動作）
- **S3 使用時のみ**: ストレージ関連の環境変数を設定
- `config.js`が自動的に環境変数を読み込み、適切な設定を適用

---

## まとめ

本ドキュメントに従うことで、以下の環境にプロジェクトをデプロイできます：

✅ ローカル PC（macOS/Windows/Linux）
✅ AWS EC2（ローカルディスクまたは S3）
✅ Google Cloud Platform
✅ Azure VM
✅ Docker コンテナ

**環境別の画像ストレージ:**

| 環境          | 画像保存先         | 設定               |
| ------------- | ------------------ | ------------------ |
| ローカル開発  | ローカルディスク   | 不要（デフォルト） |
| EC2/GCP/Azure | ローカルディスク   | 不要（デフォルト） |
| EC2 + S3      | S3 + CloudFront    | 環境変数で設定     |
| Docker        | ボリュームマウント | docker-compose.yml |

**重要なポイント:**

🔹 **デフォルト動作**: ローカル・EC2・GCP・Azure すべてで追加設定なしで動作
🔹 **環境移行**: `config.js`により、コード変更なしで環境切り替え可能
🔹 **柔軟性**: ストレージタイプを環境変数で簡単に切り替え

**次のステップ:**

1. 要件に合った環境を選択
2. 初回セットアップを実行
3. 必要に応じてストレージ設定をカスタマイズ（S3 使用時のみ）
4. バックアップ体制を構築
5. 本番運用開始

**サポート:**
問題が発生した場合は、トラブルシューティングセクションを参照するか、GitHub の Issue で報告してください。

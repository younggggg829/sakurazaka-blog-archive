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
RUN npm ci --only=production

# Playwrightブラウザをインストール
RUN npx playwright install chromium

# アプリケーションファイルをコピー
COPY . .

# データ永続化用のボリューム
VOLUME ["/app/images", "/app/sakurazaka_blog.db", "/app/image_cache.json"]

# ポート公開（Webビューアー用）
EXPOSE 3000

# ヘルスチェック
HEALTHCHECK --interval=30s --timeout=10s --start-period=40s --retries=3 \
  CMD node -e "require('http').get('http://localhost:3000', (r) => process.exit(r.statusCode === 200 ? 0 : 1))" || exit 1

CMD ["npm", "start"]

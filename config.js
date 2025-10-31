const path = require('path');

/**
 * アプリケーション設定
 */
const config = {
  // ストレージ設定
  storage: {
    // 'local' または 's3'
    type: process.env.STORAGE_TYPE || 'local',

    // ローカルストレージ設定
    local: {
      baseDir: path.join(__dirname),  // プロジェクトルート
      imagesDir: 'images'              // 画像ディレクトリ（相対パス）
    },

    // S3ストレージ設定（将来使用）
    s3: {
      bucket: process.env.S3_BUCKET || '',
      region: process.env.S3_REGION || 'ap-northeast-1',
      baseUrl: process.env.S3_BASE_URL || null  // CloudFront URLなど
    }
  },

  // データベース設定
  database: {
    path: path.join(__dirname, 'sakurazaka_blog.db')
  },

  // Webサーバー設定
  server: {
    port: process.env.PORT || 3000,
    host: process.env.HOST || '0.0.0.0'
  }
};

module.exports = config;

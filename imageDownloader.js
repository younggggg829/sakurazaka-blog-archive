const fs = require('fs');
const path = require('path');
const https = require('https');
const http = require('http');
const crypto = require('crypto');
const { StorageAdapterFactory } = require('./storageAdapter');
const config = require('./config');

// Storage Adapterの初期化
const storageConfig = {
  type: config.storage.type,
  baseDir: config.storage.local.baseDir
};

const storage = StorageAdapterFactory.create(storageConfig);

// 画像保存ディレクトリ（相対パス）
const IMAGES_DIR_RELATIVE = config.storage.local.imagesDir;
const IMAGE_DIR = path.join(config.storage.local.baseDir, IMAGES_DIR_RELATIVE);
const CACHE_FILE = path.join(__dirname, 'image_cache.json');

// ディレクトリが存在しない場合は作成
if (!fs.existsSync(IMAGE_DIR)) {
  fs.mkdirSync(IMAGE_DIR, { recursive: true });
}

/**
 * 画像キャッシュ管理クラス
 * 重複ダウンロードを防止し、パフォーマンスを向上
 */
class ImageCache {
  constructor() {
    this.cache = this.loadCache();
    this.downloadQueue = new Map(); // 並列ダウンロードの管理
  }

  loadCache() {
    try {
      if (fs.existsSync(CACHE_FILE)) {
        return JSON.parse(fs.readFileSync(CACHE_FILE, 'utf8'));
      }
    } catch (error) {
      console.error('キャッシュ読み込みエラー:', error);
    }
    return {};
  }

  saveCache() {
    try {
      fs.writeFileSync(CACHE_FILE, JSON.stringify(this.cache, null, 2));
    } catch (error) {
      console.error('キャッシュ保存エラー:', error);
    }
  }

  getUrlHash(url) {
    return crypto.createHash('md5').update(url).digest('hex');
  }

  // メンバー固有のキャッシュキーを生成
  getCacheKey(url, memberId, postId) {
    return crypto.createHash('md5').update(`${url}_${memberId}_${postId}`).digest('hex');
  }

  exists(url, memberId = null, postId = null) {
    const cacheKey = memberId && postId ? this.getCacheKey(url, memberId, postId) : this.getUrlHash(url);
    return this.cache[cacheKey] && fs.existsSync(this.cache[cacheKey].localPath);
  }

  get(url, memberId = null, postId = null) {
    const cacheKey = memberId && postId ? this.getCacheKey(url, memberId, postId) : this.getUrlHash(url);
    return this.cache[cacheKey];
  }

  set(url, localPath, metadata = {}, memberId = null, postId = null) {
    const cacheKey = memberId && postId ? this.getCacheKey(url, memberId, postId) : this.getUrlHash(url);
    this.cache[cacheKey] = {
      url,
      localPath,
      memberId,
      postId,
      downloadedAt: new Date().toISOString(),
      size: metadata.size || 0,
      ...metadata
    };
    this.saveCache();
  }
}

const imageCache = new ImageCache();

/**
 * 最適化された画像ダウンロード関数
 * - キャッシュチェック
 * - 並列ダウンロード制御
 * - リトライ機能
 */
async function downloadImageOptimized(imageUrl, memberId, postId, memberName = null, site = 'sakurazaka46', retryCount = 3) {
  // キャッシュチェック
  if (imageCache.exists(imageUrl, memberId, postId)) {
    const cached = imageCache.get(imageUrl, memberId, postId);
    console.log(`  📦 キャッシュ使用: ${path.basename(cached.localPath)}`);
    return cached.localPath;
  }

  // 同じURLが既にダウンロード中の場合は待機
  if (imageCache.downloadQueue.has(imageUrl)) {
    console.log(`  ⏳ ダウンロード待機中: ${imageUrl}`);
    return await imageCache.downloadQueue.get(imageUrl);
  }

  // ダウンロード処理をPromiseでラップ
  const downloadPromise = new Promise(async (resolve, reject) => {
    let attempts = 0;

    const attemptDownload = async () => {
      try {
        attempts++;

        // メンバーごとのディレクトリを作成（メンバー名_サイト名）
        const sanitizedName = memberName ? memberName.replace(/[<>:"/\\|?*]/g, '') : `member_${memberId}`;
        const folderName = `${sanitizedName}_${site}`;
        const memberDir = path.join(IMAGE_DIR, folderName);
        if (!fs.existsSync(memberDir)) {
          fs.mkdirSync(memberDir, { recursive: true });
        }

        // ファイル名を生成（クエリパラメータを除去）
        const urlHash = imageCache.getUrlHash(imageUrl);
        const urlObj = new URL(imageUrl);
        const extension = path.extname(urlObj.pathname) || '.jpg';
        // postIdからクエリパラメータを除去
        const cleanPostId = String(postId).split('?')[0].split('&')[0];
        const filename = `post_${cleanPostId}_${urlHash.substring(0, 8)}${extension}`;
        const filepath = path.join(memberDir, filename);

        // 相対パスを計算（データベース保存用）
        const relativePath = path.join(IMAGES_DIR_RELATIVE, folderName, filename);

        // すでに存在する場合（レースコンディション対策）
        if (fs.existsSync(filepath)) {
          const stats = fs.statSync(filepath);
          imageCache.set(imageUrl, relativePath, { size: stats.size }, memberId, postId);
          resolve(relativePath);
          return;
        }

        const file = fs.createWriteStream(filepath);
        const protocol = imageUrl.startsWith('https') ? https : http;

        console.log(`  📥 ダウンロード開始 [${attempts}/${retryCount}]: ${path.basename(imageUrl)}`);

        const request = protocol.get(imageUrl, { timeout: 10000 }, (response) => {
          // リダイレクトの処理
          if (response.statusCode === 301 || response.statusCode === 302) {
            file.close();
            if (fs.existsSync(filepath)) fs.unlinkSync(filepath);
            downloadImageOptimized(response.headers.location, memberId, postId, memberName, retryCount)
              .then(resolve)
              .catch(reject);
            return;
          }

          if (response.statusCode !== 200) {
            file.close();
            if (fs.existsSync(filepath)) fs.unlinkSync(filepath);

            if (attempts < retryCount) {
              console.log(`  🔄 リトライ中...`);
              setTimeout(attemptDownload, 1000 * attempts); // 指数バックオフ
            } else {
              reject(new Error(`ダウンロード失敗: ステータス ${response.statusCode}`));
            }
            return;
          }

          let downloadedSize = 0;
          response.on('data', (chunk) => {
            downloadedSize += chunk.length;
          });

          response.pipe(file);

          file.on('finish', () => {
            file.close();
            const stats = fs.statSync(filepath);
            imageCache.set(imageUrl, relativePath, {
              size: stats.size
            }, memberId, postId);
            console.log(`  ✅ 保存完了: ${filename} (${(stats.size / 1024).toFixed(1)}KB)`);
            resolve(relativePath);
          });
        });

        request.on('timeout', () => {
          request.destroy();
          file.close();
          if (fs.existsSync(filepath)) fs.unlinkSync(filepath);

          if (attempts < retryCount) {
            console.log(`  🔄 タイムアウト - リトライ中...`);
            setTimeout(attemptDownload, 1000 * attempts);
          } else {
            reject(new Error('ダウンロードタイムアウト'));
          }
        });

        request.on('error', (err) => {
          file.close();
          if (fs.existsSync(filepath)) fs.unlinkSync(filepath);

          if (attempts < retryCount && err.code !== 'ENOTFOUND') {
            console.log(`  🔄 エラー - リトライ中: ${err.message}`);
            setTimeout(attemptDownload, 1000 * attempts);
          } else {
            reject(err);
          }
        });

        file.on('error', (err) => {
          file.close();
          if (fs.existsSync(filepath)) fs.unlinkSync(filepath);
          reject(err);
        });

      } catch (error) {
        if (attempts < retryCount) {
          console.log(`  🔄 エラー - リトライ中: ${error.message}`);
          setTimeout(attemptDownload, 1000 * attempts);
        } else {
          reject(error);
        }
      }
    };

    attemptDownload();
  });

  // ダウンロードキューに追加
  imageCache.downloadQueue.set(imageUrl, downloadPromise);

  try {
    const result = await downloadPromise;
    return result;
  } finally {
    // キューから削除
    imageCache.downloadQueue.delete(imageUrl);
  }
}

/**
 * 複数画像の並列ダウンロード（最適化版）
 * - 並列数制限
 * - プログレス表示
 */
async function downloadImagesOptimized(imageUrls, memberId, postId, memberName = null, site = 'sakurazaka46', maxConcurrent = 3) {
  const results = [];
  const total = imageUrls.length;

  console.log(`\n📷 画像ダウンロード: ${total}枚`);

  // バッチ処理で並列数を制限
  for (let i = 0; i < total; i += maxConcurrent) {
    const batch = imageUrls.slice(i, Math.min(i + maxConcurrent, total));
    const batchPromises = batch.map(async (imageUrl, index) => {
      try {
        const localPath = await downloadImageOptimized(imageUrl, memberId, postId, memberName, site);
        return {
          url: imageUrl,
          localPath: localPath,
          success: true
        };
      } catch (error) {
        console.error(`  ❌ 失敗: ${imageUrl.substring(0, 50)}... - ${error.message}`);
        return {
          url: imageUrl,
          localPath: null,
          success: false,
          error: error.message
        };
      }
    });

    const batchResults = await Promise.all(batchPromises);
    results.push(...batchResults);

    // プログレス表示
    console.log(`  進捗: ${Math.min(i + maxConcurrent, total)}/${total} 完了`);
  }

  const successCount = results.filter(r => r.success).length;
  console.log(`✨ ダウンロード完了: ${successCount}/${total} 成功\n`);

  return results;
}

/**
 * 画像統計情報（最適化版）
 * - キャッシュ情報も含む
 */
function getImageStatsOptimized() {
  const stats = {
    totalSize: 0,
    totalFiles: 0,
    cachedFiles: Object.keys(imageCache.cache).length,
    memberStats: {}
  };

  if (!fs.existsSync(IMAGE_DIR)) {
    return stats;
  }

  const members = fs.readdirSync(IMAGE_DIR);

  members.forEach(memberDir => {
    const memberPath = path.join(IMAGE_DIR, memberDir);
    if (fs.statSync(memberPath).isDirectory()) {
      const files = fs.readdirSync(memberPath);
      let memberSize = 0;

      files.forEach(file => {
        const filePath = path.join(memberPath, file);
        try {
          const fileStats = fs.statSync(filePath);
          if (fileStats.isFile()) {
            memberSize += fileStats.size;
            stats.totalFiles++;
          }
        } catch (error) {
          // ファイルアクセスエラーは無視
        }
      });

      // フォルダ名から表示名を生成（member_47_森田ひかる → 森田ひかる）
      const displayName = memberDir.includes('_') ?
        memberDir.split('_').slice(2).join('_') || memberDir : memberDir;

      stats.memberStats[displayName] = {
        folder: memberDir,
        files: files.length,
        size: memberSize,
        sizeMB: (memberSize / 1024 / 1024).toFixed(2)
      };
      stats.totalSize += memberSize;
    }
  });

  stats.totalSizeMB = (stats.totalSize / 1024 / 1024).toFixed(2);
  return stats;
}

/**
 * キャッシュクリーンアップ
 * 存在しないファイルのキャッシュエントリを削除
 */
function cleanupCache() {
  let cleaned = 0;
  const cache = imageCache.cache;

  Object.keys(cache).forEach(hash => {
    if (!fs.existsSync(cache[hash].localPath)) {
      delete cache[hash];
      cleaned++;
    }
  });

  if (cleaned > 0) {
    imageCache.saveCache();
    console.log(`🧹 キャッシュクリーンアップ: ${cleaned}件削除`);
  }

  return cleaned;
}

// 後方互換性のため、古い関数名もエクスポート
module.exports = {
  downloadImage: downloadImageOptimized,
  downloadImages: downloadImagesOptimized,
  getImageStats: getImageStatsOptimized,
  downloadImageOptimized,
  downloadImagesOptimized,
  getImageStatsOptimized,
  cleanupCache,
  IMAGE_DIR,
  storage,  // Storage Adapterをエクスポート
  IMAGES_DIR_RELATIVE
};
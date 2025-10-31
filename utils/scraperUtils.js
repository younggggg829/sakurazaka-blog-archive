/**
 * スクレイピングユーティリティ
 * レート制限、遅延処理、共通スクレイピング関数
 */

const { RATE_LIMIT } = require('./constants');

// グローバルなレート制限状態
let requestCount = 0;
let lastRequestTime = 0;
let startTime = Date.now();

/**
 * レート制限状態をリセット
 */
function resetRateLimitState() {
  requestCount = 0;
  lastRequestTime = 0;
  startTime = Date.now();
}

/**
 * スマート遅延（レート制限を考慮した待機）
 * @param {number} requestNumber - リクエスト番号（0から始まる）
 * @returns {Promise<void>}
 */
async function smartDelay(requestNumber) {
  const now = Date.now();
  const timeSinceLastRequest = now - lastRequestTime;

  // 連続リクエスト制限（軽い休憩のみ）
  if (requestNumber > 0 && requestNumber % RATE_LIMIT.BURST_LIMIT === 0) {
    console.log(
      `  ⏸️  ${RATE_LIMIT.BURST_LIMIT}件処理完了 - ${
        RATE_LIMIT.LONG_BREAK / 1000
      }秒休憩中...`
    );
    await new Promise((resolve) => setTimeout(resolve, RATE_LIMIT.LONG_BREAK));
    lastRequestTime = Date.now();
    return;
  }

  // ランダム遅延を最小間隔と統合（前回のリクエストから最低MIN_DELAY経過を保証）
  const randomDelay =
    RATE_LIMIT.MIN_DELAY +
    Math.random() * (RATE_LIMIT.MAX_DELAY - RATE_LIMIT.MIN_DELAY);
  const requiredWait = Math.max(0, randomDelay - timeSinceLastRequest);

  if (requiredWait > 0) {
    await new Promise((resolve) => setTimeout(resolve, requiredWait));
  }

  lastRequestTime = Date.now();
}

/**
 * スクレイピングの統計情報を出力
 * @param {number} itemCount - 処理したアイテム数
 * @param {number} startTime - 開始時刻
 */
function logScrapingStats(itemCount, startTime) {
  const totalTime = (Date.now() - startTime) / 1000;
  console.log(
    `✨ スクレイピング完了: ${itemCount}件 (${totalTime.toFixed(1)}秒)`
  );
  console.log(
    `📊 平均処理時間: ${(totalTime / Math.max(itemCount, 1)).toFixed(1)}秒/件`
  );
}

/**
 * ページから要素のテキストを安全に取得
 * @param {object} page - Playwrightページオブジェクト
 * @param {string[]} selectors - 試すセレクターのリスト
 * @param {function} filter - テキストをフィルタする関数（オプション）
 * @returns {Promise<string>} 取得されたテキスト
 */
async function getElementText(page, selectors, filter = null) {
  return await page.evaluate((selectorList, filterFn) => {
    for (const selector of selectorList) {
      const element = document.querySelector(selector);
      if (element && element.textContent.trim()) {
        const text = element.textContent.trim();
        if (!filterFn || eval(`(${filterFn})(text)`)) {
          return text;
        }
      }
    }
    return '';
  }, selectors, filter ? filter.toString() : null);
}

/**
 * 画像URLが除外パターンに一致するかチェック
 * @param {string} imageUrl - チェックする画像URL
 * @param {string[]} excludePatterns - 除外パターンのリスト
 * @returns {boolean} 除外すべき場合true
 */
function shouldExcludeImage(imageUrl, excludePatterns) {
  if (!imageUrl) return true;

  const lowerUrl = imageUrl.toLowerCase();
  return excludePatterns.some(pattern => lowerUrl.includes(pattern));
}

/**
 * 相対URLを絶対URLに変換
 * @param {string} url - 変換するURL
 * @param {string} baseUrl - ベースURL
 * @returns {string} 絶対URL
 */
function toAbsoluteUrl(url, baseUrl) {
  if (!url) return '';
  return url.startsWith('http') ? url : `${baseUrl}${url}`;
}

module.exports = {
  resetRateLimitState,
  smartDelay,
  logScrapingStats,
  getElementText,
  shouldExcludeImage,
  toAbsoluteUrl,
  // レート制限状態を外部から参照できるようにする
  getRateLimitState: () => ({ requestCount, lastRequestTime, startTime }),
  incrementRequestCount: () => requestCount++,
};

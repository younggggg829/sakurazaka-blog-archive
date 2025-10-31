/**
 * 日付処理ユーティリティ
 * ブログの日付を解析・フォーマット・比較する関数群
 */

/**
 * 日付文字列をDateオブジェクトに変換
 * @param {string} dateStr - "2024.12.25", "2024/12/25", "2024-12-25" などの形式
 * @returns {Date|null} 解析されたDateオブジェクト、または解析失敗時はnull
 */
function parseBlogDate(dateStr) {
  if (!dateStr) return null;

  // "2024.12.25", "2024/12/25", "2024-12-25" を統一的に処理
  const normalized = dateStr.replace(/[\.\/ ]/g, '-');
  const date = new Date(normalized);

  return isNaN(date.getTime()) ? null : date;
}

/**
 * 日付が範囲内にあるかチェック
 * @param {string} dateStr - ブログの日付文字列
 * @param {string|null} dateFrom - 開始日 "YYYY-MM-DD"
 * @param {string|null} dateTo - 終了日 "YYYY-MM-DD"
 * @returns {boolean} 範囲内ならtrue
 */
function isDateInRange(dateStr, dateFrom, dateTo) {
  const postDate = parseBlogDate(dateStr);
  if (!postDate) return true; // 日付が不明な場合は含める

  if (dateFrom) {
    const fromDate = new Date(dateFrom);
    if (postDate < fromDate) return false;
  }

  if (dateTo) {
    const toDate = new Date(dateTo);
    toDate.setHours(23, 59, 59, 999); // 終了日の23:59:59まで含める
    if (postDate > toDate) return false;
  }

  return true;
}

/**
 * 投稿用の日付を解析（WebServerで使用）
 * @param {string} dateStr - 日付文字列
 * @returns {Date} 解析されたDateオブジェクト、失敗時は1970-01-01
 */
function parsePostDate(dateStr) {
  if (!dateStr) return new Date('1970-01-01');

  // スラッシュ区切りの日付形式 (YYYY/MM/DD)
  if (dateStr.includes('/')) {
    const parts = dateStr.split('/');
    if (parts.length === 3) {
      const year = parseInt(parts[0]);
      const month = parseInt(parts[1]) - 1; // 月は0ベース
      const day = parseInt(parts[2]);
      return new Date(year, month, day);
    }
  }

  // ハイフン区切りの日付形式 (YYYY-MM-DD)
  if (dateStr.includes('-')) {
    const parts = dateStr.split('-');
    if (parts.length === 3) {
      const year = parseInt(parts[0]);
      const month = parseInt(parts[1]) - 1; // 月は0ベース
      const day = parseInt(parts[2]);
      return new Date(year, month, day);
    }
  }

  // 数字のみの場合（日付のみ）、現在の年月として解釈
  if (/^\d+$/.test(dateStr)) {
    const day = parseInt(dateStr);
    if (day >= 1 && day <= 31) {
      const now = new Date();
      return new Date(now.getFullYear(), now.getMonth(), day);
    }
  }

  // その他の形式の場合、Date.parseで試みる
  const parsed = new Date(dateStr);
  return isNaN(parsed.getTime()) ? new Date('1970-01-01') : parsed;
}

/**
 * 日付を表示用にフォーマット
 * @param {string} dateStr - 日付文字列
 * @returns {string} YYYY/MM/DD形式の日付文字列
 */
function formatDate(dateStr) {
  if (!dateStr) return '';

  // 既に正しい形式の場合はそのまま返す
  if (dateStr.match(/\d{4}\/\d{1,2}\/\d{1,2}/)) {
    return dateStr;
  }

  // 数字のみの場合の処理
  if (dateStr.match(/^\d+$/)) {
    const num = parseInt(dateStr);
    if (num >= 1 && num <= 31) {
      const now = new Date();
      return `${now.getFullYear()}/${String(now.getMonth() + 1).padStart(2, '0')}/${String(num).padStart(2, '0')}`;
    }
  }

  // 年月日パターンをYYYY/MM/DD形式に統一
  return dateStr.replace(/(\d{4})[年\-\.](\d{1,2})[月\-\.](\d{1,2})[日]?/, '$1/$2/$3');
}

module.exports = {
  parseBlogDate,
  isDateInRange,
  parsePostDate,
  formatDate
};

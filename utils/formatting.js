/**
 * テキストフォーマッティングユーティリティ
 * HTMLのクリーニング、エンティティデコード、テキスト整形
 */

/**
 * HTMLエンティティをデコードする
 * @param {string} text - デコードするテキスト
 * @returns {string} デコードされたテキスト
 */
function decodeHTMLEntities(text) {
  if (!text) return '';

  const entities = {
    '&nbsp;': ' ',
    '&amp;': '&',
    '&lt;': '<',
    '&gt;': '>',
    '&quot;': '"',
    '&#39;': "'",
    '&apos;': "'"
  };

  return text.replace(/&[^;]+;/g, function(entity) {
    return entities[entity] || entity;
  });
}

/**
 * HTMLタグを削除してプレーンテキストに変換
 * @param {string} html - HTMLテキスト
 * @returns {string} プレーンテキスト
 */
function stripHTMLTags(html) {
  if (!html) return '';
  return html.replace(/<[^>]*>/g, '');
}

/**
 * テキストをクリーンにする（HTMLタグ削除 + エンティティデコード + 空白整理）
 * @param {string} html - クリーンにするHTML
 * @param {number} maxLength - 最大文字数（デフォルト: 150）
 * @returns {string} クリーンなテキスト
 */
function cleanTextPreview(html, maxLength = 150) {
  if (!html) return '';

  // HTMLタグを削除
  let text = stripHTMLTags(html);

  // HTMLエンティティをデコード
  text = decodeHTMLEntities(text);

  // 空白を整理
  text = text.replace(/\s+/g, ' ').trim();

  // 長さ制限
  if (text.length > maxLength) {
    return text.substring(0, maxLength) + '...';
  }

  return text;
}

/**
 * HTMLコンテンツから不要なタグを削除
 * @param {string} html - HTMLコンテンツ
 * @returns {string} クリーンなHTML
 */
function cleanHTMLContent(html) {
  if (!html) return '';

  return html
    .replace(/<script[^>]*>.*?<\/script>/gi, '')
    .replace(/<style[^>]*>.*?<\/style>/gi, '')
    .trim();
}

/**
 * ファイルサイズを人間が読める形式に変換
 * @param {number} bytes - バイト数
 * @returns {string} フォーマットされたサイズ (例: "1.5 MB")
 */
function formatFileSize(bytes) {
  if (bytes === 0) return '0 B';

  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  const k = 1024;
  const i = Math.floor(Math.log(bytes) / Math.log(k));

  return `${(bytes / Math.pow(k, i)).toFixed(2)} ${units[i]}`;
}

/**
 * 数値を3桁区切りでフォーマット
 * @param {number} num - 数値
 * @returns {string} フォーマットされた数値 (例: "1,234,567")
 */
function formatNumber(num) {
  return num.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ',');
}

module.exports = {
  decodeHTMLEntities,
  stripHTMLTags,
  cleanTextPreview,
  cleanHTMLContent,
  formatFileSize,
  formatNumber
};

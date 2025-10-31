/**
 * アプリケーション全体で使用する定数
 */

/**
 * レート制限設定
 * スクレイピング時のリクエスト間隔を制御
 */
const RATE_LIMIT = {
  REQUESTS_PER_MINUTE: 30,    // 1分間に30リクエストまで
  MIN_DELAY: 1000,             // 最小1秒間隔
  MAX_DELAY: 2000,             // 最大2秒間隔
  BURST_LIMIT: 20,             // 連続20リクエスト後に休憩
  LONG_BREAK: 3000,            // 3秒の休憩
};

/**
 * ページネーション設定
 */
const PAGINATION = {
  MAX_PAGES_SCRAPING: 100,     // スクレイピング時の最大ページ数
  POSTS_PER_PAGE: 20,          // リストページあたりの投稿数（推定）
  MAX_POSTS_FETCH: 10000,      // データベースから取得する最大投稿数
};

/**
 * 画像除外パターン
 * これらのパターンを含む画像URLは除外される
 */
const IMAGE_EXCLUDE_PATTERNS = [
  'icon',
  'logo',
  'header',
  'footer',
  'nav',
  'menu',
  'app_',
  'jasrac',
  'twemoji', // 絵文字画像
];

/**
 * CSS セレクター（櫻坂46サイト）
 */
const SAKURAZAKA_SELECTORS = {
  BLOG_LIST_CONTAINER: '.com-blog-part',
  POST_ITEM: 'li.box',
  POST_LINK: 'a',
  POST_DATE: '.date, .time',
  POST_TITLE: '.title, h3, h4',
  PAGINATION: '.com-pager a, .pager a, [class*="pager"] a',

  // 詳細ページ
  DETAIL_TITLE: ['.box-ttl h1', '.box-ttl', 'h1.title', 'h1', '.blog-title', '.entry-title'],
  DETAIL_CONTENT: ['.box-article', '.blog-body', '.entry-content', '.blog-content', '.article-body'],
  DETAIL_DATE_YEAR: '.year',
  DETAIL_DATE_MONTH: '.month',
  DETAIL_DATE_DAY: '.day',
};

/**
 * CSS セレクター（欅坂46サイト）
 */
const KEYAKIZAKA_SELECTORS = {
  POST_LINK: 'a[href*="/diary/detail/"]',
  POST_DATE_CONTAINER: '.box-bottom',

  // 詳細ページ
  DETAIL_TITLE: ['.box-ttl', 'h1.title', 'h1', '.blog-title'],
  DETAIL_CONTENT: ['.box-article', '.box--body', '.blog-body', '.blog-content'],
  DETAIL_DATE_YEAR: '.year',
  DETAIL_DATE_MONTH: '.month',
  DETAIL_DATE_DAY: '.day',
  BLOG_CONTAINER: '.box-article, .box--body',
};

/**
 * サイトURL
 */
const SITE_URLS = {
  SAKURAZAKA46_BASE: 'https://sakurazaka46.com',
  SAKURAZAKA46_BLOG_LIST: (memberId, page) =>
    `https://sakurazaka46.com/s/s46/diary/blog/list?ima=0000&page=${page}&ct=${memberId}&cd=blog`,

  KEYAKIZAKA46_BASE: 'https://www.keyakizaka46.com',
  KEYAKIZAKA46_BLOG_LIST: (memberId, page) =>
    `https://www.keyakizaka46.com/s/k46o/diary/member/list?ima=0000&page=${page}&ct=${memberId}`,
};

/**
 * 欅坂46メンバーIDマッピング
 * 櫻坂46メンバーの欅坂時代のID
 */
const KEYAKI_MEMBER_MAP = {
  "上村 莉菜": "03",
  "尾関 梨香": "04",
  "小池 美波": "06",
  "小林 由依": "07",
  "齋藤 冬優花": "08",
  "菅井 友香": "11",
  "土生 瑞穂": "14",
  "原田 葵": "15",
  "守屋 茜": "18",
  "渡辺 梨加": "20",
  "渡邉 理佐": "21",
  "井上 梨名": "43",
  "関 有美子": "44",
  "武元 唯衣": "45",
  "田村 保乃": "46",
  "藤吉 夏鈴": "47",
  "松田 里奈": "48",
  "松平 璃子": "49",
  "森田 ひかる": "50",
  "山﨑 天": "51",
  "遠藤 光莉": "53",
  "大園 玲": "54",
  "大沼 晶保": "55",
  "幸阪 茉里乃": "56",
  "増本 綺良": "57",
  "守屋 麗奈": "58",
};

/**
 * タイムアウト設定
 */
const TIMEOUTS = {
  PAGE_LOAD: 30000,              // ページ読み込みタイムアウト (30秒)
  PAGE_WAIT: 2000,               // ページ待機時間 (2秒)
  PAGE_WAIT_SHORT: 1000,         // 短い待機時間 (1秒)
  PAGE_WAIT_MEDIUM: 1500,        // 中程度の待機時間 (1.5秒)
};

module.exports = {
  RATE_LIMIT,
  PAGINATION,
  IMAGE_EXCLUDE_PATTERNS,
  SAKURAZAKA_SELECTORS,
  KEYAKIZAKA_SELECTORS,
  SITE_URLS,
  KEYAKI_MEMBER_MAP,
  TIMEOUTS,
};

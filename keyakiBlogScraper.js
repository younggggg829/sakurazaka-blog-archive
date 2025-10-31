const { chromium } = require("playwright");
const { parseBlogDate, isDateInRange } = require('./utils/dateUtils');
const { smartDelay, logScrapingStats, resetRateLimitState, incrementRequestCount } = require('./utils/scraperUtils');
const { IMAGE_EXCLUDE_PATTERNS, KEYAKIZAKA_SELECTORS, SITE_URLS, TIMEOUTS, PAGINATION, KEYAKI_MEMBER_MAP } = require('./utils/constants');
const { cleanHTMLContent } = require('./utils/formatting');

/**
 * リストページから全投稿URLを収集（ページネーション対応）
 * @param {object} page - Playwrightページオブジェクト
 * @param {string} memberId - メンバーID
 * @param {string} memberName - メンバー名
 * @param {number|null} limit - 取得件数制限（nullの場合は全件取得）
 * @param {string|null} dateFrom - 開始日 "YYYY-MM-DD"
 * @param {string|null} dateTo - 終了日 "YYYY-MM-DD"
 * @returns {Promise<Array>} 投稿情報の配列
 */
async function collectAllPostUrls(page, memberId, memberName, limit = null, dateFrom = null, dateTo = null) {
  const allPostUrls = [];
  let currentPage = 0;
  const maxPages = PAGINATION.MAX_PAGES_SCRAPING;
  const needAll = limit === null;

  console.log(`  📅 日付範囲: ${dateFrom || '指定なし'} 〜 ${dateTo || '指定なし'}`);

  while (currentPage < maxPages) {
    const listUrl = SITE_URLS.KEYAKIZAKA46_BLOG_LIST(memberId, currentPage);

    if (currentPage > 0) {
      await smartDelay(currentPage - 1);
    }

    await page.goto(listUrl, { waitUntil: "domcontentloaded", timeout: TIMEOUTS.PAGE_LOAD });
    await page.waitForTimeout(TIMEOUTS.PAGE_WAIT_MEDIUM);
    incrementRequestCount();

    const pageUrls = await page.evaluate((selectors) => {
      const urls = [];
      const uniqueUrls = new Set();
      const allLinks = document.querySelectorAll(selectors.POST_LINK);

      // サイドバーを除外してURLを収集
      for (const link of allLinks) {
        let parent = link.parentElement;
        let isInSidebar = false;

        for (let i = 0; i < 5; i++) {
          if (!parent) break;
          const text = parent.textContent || "";
          if (text.includes("NEW ENTRY") || text.includes("最新記事")) {
            isInSidebar = true;
            break;
          }
          parent = parent.parentElement;
        }

        if (!isInSidebar) {
          const href = link.getAttribute("href");
          if (href && !uniqueUrls.has(href)) {
            uniqueUrls.add(href);
            const fullUrl = href.startsWith("http")
              ? href
              : `https://www.keyakizaka46.com${href}`;

            // 日付を.box-bottomから取得
            let date = "";
            let postContainer = link;
            for (let i = 0; i < 5; i++) {
              postContainer = postContainer.parentElement;
              if (!postContainer) break;

              const boxBottom = postContainer.querySelector(selectors.POST_DATE_CONTAINER);
              if (boxBottom) {
                const dateMatch = boxBottom.textContent.match(/(\d{4})\/(\d{2})\/(\d{2})/);
                if (dateMatch) {
                  date = `${dateMatch[1]}/${dateMatch[2]}/${dateMatch[3]}`;
                  break;
                }
              }
            }

            urls.push({ url: fullUrl, date: date });
          }
        }
      }

      return urls;
    }, KEYAKIZAKA_SELECTORS);

    if (pageUrls.length === 0) {
      break;
    }

    // 日付範囲でフィルタリング
    const filteredUrls = pageUrls.filter(item =>
      isDateInRange(item.date, dateFrom, dateTo)
    );

    allPostUrls.push(...filteredUrls);

    // 日付範囲指定がある場合の終了条件チェック
    if (dateFrom || dateTo) {
      // 範囲より古い記事に達したかチェック
      if (dateFrom) {
        const oldestPostOnPage = pageUrls[pageUrls.length - 1];
        const oldestDate = parseBlogDate(oldestPostOnPage?.date);
        const fromDate = new Date(dateFrom);

        // ページの最も古い記事が開始日より前なら、これ以降のページは不要
        if (oldestDate && oldestDate < fromDate) {
          console.log(`  ℹ️  指定期間より古い記事に到達しました（最古: ${oldestPostOnPage.date}）`);
          break;
        }
      }

      // limit指定時、必要件数に達したら終了
      if (!needAll && allPostUrls.length >= limit) {
        break;
      }
    } else {
      // 日付範囲指定なしの場合、limit指定時に必要件数に達したら即座に終了
      if (!needAll && allPostUrls.length >= limit) {
        break;
      }
    }

    // 次のページがあるかチェック（簡易版：URLが20件未満なら最終ページ）
    if (pageUrls.length < 20) {
      break;
    }

    currentPage++;
  }

  console.log(`  ✓ 合計 ${allPostUrls.length} 件の記事を収集しました`);
  return allPostUrls;
}

/**
 * 個別ページから投稿内容を取得
 * @param {object} page - Playwrightページオブジェクト
 * @param {string} url - 投稿URL
 * @returns {Promise<object>} 投稿データ {title, date, content, images}
 */
async function scrapePostDetail(page, url) {
  await page.goto(url, {
    waitUntil: "domcontentloaded",
    timeout: TIMEOUTS.PAGE_LOAD,
  });
  await page.waitForTimeout(TIMEOUTS.PAGE_WAIT_SHORT);

  const postData = await page.evaluate(({ selectors, excludePatterns }) => {
    // タイトルを取得
    let title = "";
    for (const selector of selectors.DETAIL_TITLE) {
      const elem = document.querySelector(selector);
      if (elem && elem.textContent.trim()) {
        title = elem.textContent.trim();
        // メンバー名が含まれている場合は最初の行だけ取る
        const lines = title.split("\n").filter((line) => line.trim());
        if (lines.length > 0) {
          title = lines[0].trim();
        }
        break;
      }
    }

    // 日付を取得
    let date = "";
    const yearEl = document.querySelector(selectors.DETAIL_DATE_YEAR);
    const monthEl = document.querySelector(selectors.DETAIL_DATE_MONTH);
    const dayEl = document.querySelector(selectors.DETAIL_DATE_DAY);

    if (yearEl && monthEl && dayEl) {
      const year = yearEl.textContent.trim();
      const month = monthEl.textContent.trim().replace("月", "");
      const day = dayEl.textContent.trim().replace("日", "");
      date = `${year}/${month.padStart(2, "0")}/${day.padStart(2, "0")}`;
    } else {
      const dateElements = document.querySelectorAll(".date, time");
      for (const element of dateElements) {
        const text = element.textContent?.trim();
        if (text && /\d{4}[\/\.\-]?\d{1,2}[\/\.\-]?\d{1,2}/.test(text)) {
          date = text;
          break;
        }
      }
    }

    // 本文を取得
    let content = "";
    for (const selector of selectors.DETAIL_CONTENT) {
      const element = document.querySelector(selector);
      if (element && element.textContent.trim().length > 20) {
        content = element.innerHTML
          .replace(/<script[^>]*>.*?<\/script>/gi, "")
          .replace(/<style[^>]*>.*?<\/style>/gi, "")
          .trim();
        if (content) break;
      }
    }

    // 画像URLを取得（ブログ本文内のみ）
    const images = [];
    const imageSet = new Set();
    const blogContainer =
      document.querySelector(selectors.BLOG_CONTAINER.split(',')[0]) ||
      document.querySelector(selectors.BLOG_CONTAINER.split(',')[1]) ||
      document.body;
    const imgElements = blogContainer.querySelectorAll("img");

    imgElements.forEach((img) => {
      const src = img.getAttribute("src");
      if (src && !imageSet.has(src)) {
        const isExcluded = excludePatterns.some((pattern) =>
          src.toLowerCase().includes(pattern)
        );

        if (!isExcluded) {
          const fullSrc = src.startsWith("http")
            ? src
            : `https://www.keyakizaka46.com${src}`;
          imageSet.add(src);
          images.push(fullSrc);
        }
      }
    });

    return {
      title,
      date,
      content,
      images,
    };
  }, { selectors: KEYAKIZAKA_SELECTORS, excludePatterns: IMAGE_EXCLUDE_PATTERNS });

  return postData;
}

/**
 * 欅坂46のブログ投稿をスクレイピング
 * @param {string} memberName - メンバー名
 * @param {number|string} limit - 取得件数制限（'all'の場合は全件取得）
 * @param {object} options - オプション {dateFrom, dateTo}
 * @returns {Promise<Array>} スクレイピングされたブログ投稿の配列
 */
async function scrapeKeyakiBlogPosts(memberName, limit = 10, options = {}) {
  const { dateFrom = null, dateTo = null } = options;
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();
  const blogPosts = [];

  try {
    // レート制限変数をリセット
    resetRateLimitState();
    const startTime = Date.now();

    // メンバーIDを取得
    const memberId = KEYAKI_MEMBER_MAP[memberName];
    if (!memberId) {
      console.log(`⚠️ ${memberName}さんの欅坂46メンバーIDが見つかりません`);
      await browser.close();
      return [];
    }

    console.log(
      `🌳 ${memberName}さんの欅坂46ブログをスクレイピング中 (ID: ${memberId})...`
    );
    console.log(`  🚀 スクレイピング開始 - 適切な間隔で処理します`);

    // limit = 'all' の場合、全件取得
    const isAll = limit === "all";
    const targetLimit = isAll ? null : limit;

    // ステップ1: 全投稿URLを収集
    const allPostUrls = await collectAllPostUrls(page, memberId, memberName, targetLimit, dateFrom, dateTo);

    if (allPostUrls.length === 0) {
      console.log("  ⚠️ 投稿が見つかりませんでした");
      await browser.close();
      return [];
    }

    // ステップ2: 指定件数分の投稿を取得
    const postsToProcess = isAll ? allPostUrls : allPostUrls.slice(0, limit);

    console.log(`  📊 ${postsToProcess.length}件の投稿を処理します`);

    for (let index = 0; index < postsToProcess.length; index++) {
      const post = postsToProcess[index];
      const postUrl = post.url;
      const listDate = post.date; // リストページから取得した日付

      await smartDelay(index);
      incrementRequestCount();

      console.log(
        `  📄 [${index + 1}/${postsToProcess.length}] スクレイピング中...`
      );

      const postData = await scrapePostDetail(page, postUrl);

      if (postData.title || postData.content) {
        blogPosts.push({
          memberId: memberId,
          memberName: memberName,
          url: postUrl,
          title: postData.title,
          date: listDate || postData.date, // リストページの日付を優先
          content: postData.content,
          images: postData.images,
          site: "keyakizaka46",
        });

        console.log(`    ✓ ${postData.title || "Untitled"} (${listDate || postData.date}) - 画像:${postData.images.length}枚`);
      }
    }

    logScrapingStats(blogPosts.length, startTime);

    await browser.close();
    return blogPosts;
  } catch (error) {
    console.error("Error scraping Keyaki blog:", error);
    await browser.close();
    return blogPosts;
  }
}

module.exports = {
  scrapeKeyakiBlogPosts,
  KEYAKI_MEMBER_MAP,
};

// テスト実行
if (require.main === module) {
  scrapeKeyakiBlogPosts("藤吉 夏鈴", 5).then((posts) => {
    console.log("\n=== 取得した投稿 ===");
    posts.forEach((post, i) => {
      console.log(`\n${i + 1}. ${post.title}`);
      console.log(`   日付: ${post.date}`);
      console.log(`   URL: ${post.url}`);
      console.log(`   画像数: ${post.images.length}`);
      console.log(`   本文: ${post.content.substring(0, 100)}...`);
    });
  });
}

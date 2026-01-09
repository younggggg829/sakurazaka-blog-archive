const { chromium } = require('playwright');
const { parseBlogDate, isDateInRange } = require('./utils/dateUtils');
const { smartDelay, logScrapingStats, resetRateLimitState, incrementRequestCount } = require('./utils/scraperUtils');
const { RATE_LIMIT, IMAGE_EXCLUDE_PATTERNS, SAKURAZAKA_SELECTORS, SITE_URLS, TIMEOUTS, PAGINATION } = require('./utils/constants');
const { cleanHTMLContent } = require('./utils/formatting');

/**
 * ページネーション対応で全投稿URLを収集
 * @param {object} page - Playwrightページオブジェクト
 * @param {string} memberId - メンバーID
 * @param {string} memberName - メンバー名
 * @param {number|null} limit - 取得件数制限（nullの場合は全件取得）
 * @param {string|null} dateFrom - 開始日 "YYYY-MM-DD"
 * @param {string|null} dateTo - 終了日 "YYYY-MM-DD"
 * @returns {Promise<Array>} 投稿情報の配列
 */
async function collectAllPostUrls(page, memberId, memberName, limit = null, dateFrom = null, dateTo = null) {
  const allPosts = [];
  let currentPage = 0;
  const maxPages = PAGINATION.MAX_PAGES_SCRAPING;
  const needAll = limit === null;

  console.log(`  📅 日付範囲: ${dateFrom || '指定なし'} 〜 ${dateTo || '指定なし'}`);

  while (currentPage < maxPages) {
    const blogUrl = SITE_URLS.SAKURAZAKA46_BLOG_LIST(memberId, currentPage);

    await smartDelay(currentPage);
    await page.goto(blogUrl, { waitUntil: 'domcontentloaded', timeout: TIMEOUTS.PAGE_LOAD });
    await page.waitForTimeout(TIMEOUTS.PAGE_WAIT);
    incrementRequestCount();

    const pageResult = await page.evaluate(({ currentPageNum, selectors }) => {
      // メインブログリストエリアのみを選択
      const mainBlogList = document.querySelector(selectors.BLOG_LIST_CONTAINER);
      if (!mainBlogList) {
        return { posts: [], hasNext: false };
      }

      // com-blog-part内のli.boxのみから投稿を取得
      const postItems = mainBlogList.querySelectorAll(selectors.POST_ITEM);
      const postData = [];
      const uniqueUrls = new Set();

      postItems.forEach(item => {
        const link = item.querySelector(selectors.POST_LINK);
        if (!link) return;

        const href = link.getAttribute('href');
        if (href && href.includes('/diary/detail/') && !uniqueUrls.has(href)) {
          uniqueUrls.add(href);
          const fullUrl = href.startsWith('http') ? href : `https://sakurazaka46.com${href}`;

          // タイトルと日付を取得
          const dateElement = item.querySelector(selectors.POST_DATE);
          const titleElement = item.querySelector(selectors.POST_TITLE);

          postData.push({
            url: fullUrl,
            date: dateElement ? dateElement.textContent.trim() : '',
            title: titleElement ? titleElement.textContent.trim() : ''
          });
        }
      });

      // 次のページが存在するかチェック
      const paginationLinks = document.querySelectorAll(selectors.PAGINATION);
      let hasNextPage = false;
      paginationLinks.forEach(link => {
        const href = link.getAttribute('href') || '';
        if (href.includes(`page=${currentPageNum + 1}`)) {
          hasNextPage = true;
        }
      });

      return {
        posts: postData,
        hasNext: hasNextPage
      };
    }, { currentPageNum: currentPage, selectors: SAKURAZAKA_SELECTORS });

    if (pageResult.posts.length === 0) {
      break;
    }

    // 日付範囲でフィルタリング
    const filteredPosts = pageResult.posts.filter(post =>
      isDateInRange(post.date, dateFrom, dateTo)
    );

    allPosts.push(...filteredPosts);

    // 終了条件チェック
    if (dateFrom) {
      // 日付範囲の開始日が指定されている場合：
      // 指定期間より古い記事に達するまで全ページを収集し続ける
      const oldestPostOnPage = pageResult.posts[pageResult.posts.length - 1];
      const oldestDate = parseBlogDate(oldestPostOnPage?.date);
      const fromDate = new Date(dateFrom);

      // ページの最も古い記事が開始日より前なら、これ以降のページは不要
      if (oldestDate && oldestDate < fromDate) {
        console.log(`  ℹ️  指定期間より古い記事に到達しました（最古: ${oldestPostOnPage.date}）`);
        break;
      }
      // dateFromが指定されている場合はlimitに関係なく指定範囲の記事をすべて収集
    } else {
      // 日付範囲指定なしの場合、limit指定時に必要件数に達したら終了
      if (!needAll && allPosts.length >= limit) {
        break;
      }
    }

    // 次ページがない場合は終了
    if (!pageResult.hasNext) {
      break;
    }

    currentPage++;
  }

  console.log(`  ✓ 合計 ${allPosts.length} 件の記事を収集しました`);
  return allPosts;
}

/**
 * 櫻坂46のブログ投稿をスクレイピング
 * @param {string} memberId - メンバーID
 * @param {string} memberName - メンバー名
 * @param {number|string} limit - 取得件数制限（'all'の場合は全件取得）
 * @param {object} options - オプション {dateFrom, dateTo}
 * @returns {Promise<Array>} スクレイピングされたブログ投稿の配列
 */
async function scrapeBlogPosts(memberId, memberName, limit = 10, options = {}) {
  const { dateFrom = null, dateTo = null } = options;
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();
  const blogPosts = [];

  try {
    resetRateLimitState();
    const startTime = Date.now();

    console.log(`${memberName}さんのブログをスクレイピング中 (ID: ${memberId})...`);
    console.log(`  🚀 スクレイピング開始 - 適切な間隔で処理します`);

    // limit = 'all' の場合、全件取得
    const isAll = limit === 'all';
    const targetLimit = isAll ? null : limit;

    // 全投稿URLを収集（ページネーション対応）
    const allPosts = await collectAllPostUrls(page, memberId, memberName, targetLimit, dateFrom, dateTo);

    // 日付範囲が指定されている場合は収集した全記事を処理
    // そうでなければlimit件数で制限
    const hasDateRange = dateFrom || dateTo;
    const postsToProcess = (isAll || hasDateRange) ? allPosts : allPosts.slice(0, limit);

    console.log(`  📊 ${postsToProcess.length}件の投稿を処理します`);

    for (let index = 0; index < postsToProcess.length; index++) {
      const post = postsToProcess[index];
      console.log(`  📄 [${index + 1}/${postsToProcess.length}] ${post.title || 'Untitled'}`);

      // レート制限の適用
      await smartDelay(index);
      incrementRequestCount();

      await page.goto(post.url, {
        waitUntil: 'domcontentloaded',
        timeout: TIMEOUTS.PAGE_LOAD
      });

      const details = await page.evaluate(({ selectors, excludePatterns }) => {
        // タイトルを取得（複数のセレクタを試す）
        let title = '';
        for (const selector of selectors.DETAIL_TITLE) {
          const element = document.querySelector(selector);
          if (element && element.textContent.trim() && !element.textContent.includes('OFFICIAL BLOG')) {
            title = element.textContent.trim();
            break;
          }
        }

        // 本文を取得（より具体的なセレクタを使用）
        let content = '';
        for (const selector of selectors.DETAIL_CONTENT) {
          const element = document.querySelector(selector);
          if (element && element.textContent.trim().length > 20) {
            // HTMLタグを保持したまま取得
            content = element.innerHTML.replace(/<script[^>]*>.*?<\/script>/gi, '')
                                    .replace(/<style[^>]*>.*?<\/style>/gi, '')
                                    .trim();
            if (content) break;
          }
        }

        // フォールバック: テキストのみ抽出
        if (!content) {
          const textElements = document.querySelectorAll('.blog-detail, .contents, article, main p');
          textElements.forEach(el => {
            const text = el.textContent.trim();
            if (text && text.length > 50 && !text.includes('NEW ENTRY') && !text.includes('OFFICIAL BLOG')) {
              content += text + '\n\n';
            }
          });
        }

        // 日付を取得
        let date = '';

        // 方法1: 年月日が別々の要素に入っている場合
        const yearEl = document.querySelector(selectors.DETAIL_DATE_YEAR);
        const monthEl = document.querySelector(selectors.DETAIL_DATE_MONTH);
        const dayEl = document.querySelector(selectors.DETAIL_DATE_DAY);

        if (yearEl && monthEl && dayEl) {
          const year = yearEl.textContent.trim();
          const month = monthEl.textContent.trim().replace('月', '');
          const day = dayEl.textContent.trim().replace('日', '');
          date = `${year}/${month.padStart(2, '0')}/${day.padStart(2, '0')}`;
        }

        // 方法2: 完全な日付形式を含む要素を探す
        if (!date) {
          const dateElements = document.querySelectorAll('.date, .time, [class*="date"]');
          for (const element of dateElements) {
            const text = element.textContent?.trim();
            if (text && /\d{4}[\/\-\.]\d{1,2}[\/\-\.]\d{1,2}/.test(text)) {
              date = text.match(/\d{4}[\/\-\.]\d{1,2}[\/\-\.]\d{1,2}/)[0];
              date = date.replace(/-/g, '/').replace(/\./g, '/');
              break;
            }
          }
        }

        // 方法3: メタデータから
        if (!date) {
          const metaDate = document.querySelector('meta[property="article:published_time"]');
          if (metaDate) {
            const content = metaDate.getAttribute('content');
            if (content) {
              const d = new Date(content);
              date = `${d.getFullYear()}/${String(d.getMonth() + 1).padStart(2, '0')}/${String(d.getDate()).padStart(2, '0')}`;
            }
          }
        }

        // 画像URLを取得（ブログ記事の画像のみ）
        const images = [];
        const imageSet = new Set();

        // ブログ記事エリア内の画像を取得
        const blogContainer = document.querySelector('.box-article') || document.querySelector('.blog-body');
        if (blogContainer) {
          const imgElements = blogContainer.querySelectorAll('img');
          imgElements.forEach(img => {
            const src = img.getAttribute('src');
            if (src && !imageSet.has(src)) {
              // 除外パターン
              const isExcluded = excludePatterns.some(pattern => src.toLowerCase().includes(pattern));

              if (!isExcluded) {
                const fullSrc = src.startsWith('http') ? src : `https://sakurazaka46.com${src}`;
                imageSet.add(src);
                images.push(fullSrc);
              }
            }
          });
        }

        // コンテンツHTMLからも画像を抽出
        if (content) {
          const imgRegex = /<img[^>]+src=["']([^"']+)["'][^>]*>/gi;
          let match;
          while ((match = imgRegex.exec(content)) !== null) {
            const src = match[1];
            if (src && !imageSet.has(src)) {
              const isExcluded = excludePatterns.some(pattern => src.toLowerCase().includes(pattern));

              if (!isExcluded) {
                const fullSrc = src.startsWith('http') ? src : `https://sakurazaka46.com${src}`;
                imageSet.add(src);
                images.push(fullSrc);
              }
            }
          }
        }

        return {
          title: title,
          date: date,
          content: content.trim(),
          images: images
        };
      }, { selectors: SAKURAZAKA_SELECTORS, excludePatterns: IMAGE_EXCLUDE_PATTERNS });

      blogPosts.push({
        memberId: memberId,
        memberName: memberName,
        url: post.url,
        title: details.title || post.title,
        date: details.date || post.date,
        content: details.content,
        images: details.images
      });
    }

    logScrapingStats(blogPosts.length, startTime);

    await browser.close();
    return blogPosts;
  } catch (error) {
    console.error('Error scraping blog:', error);
    await browser.close();
    return blogPosts;
  }
}

module.exports = { scrapeBlogPosts };

if (require.main === module) {
  scrapeBlogPosts('47', 'Test Member', 3).then(posts => {
    console.log('Scraped posts:', JSON.stringify(posts, null, 2));
  });
}

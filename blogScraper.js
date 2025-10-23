const { chromium } = require('playwright');

// レート制限設定
const RATE_LIMIT = {
  REQUESTS_PER_MINUTE: 15,    // 1分間に最大15リクエスト
  MIN_DELAY: 2000,            // 最小2秒間隔
  MAX_DELAY: 4000,            // 最大4秒間隔
  BURST_LIMIT: 10,            // 連続10リクエスト後に短い休憩
  LONG_BREAK: 5000           // 5秒の短い休憩
};

let requestCount = 0;
let lastRequestTime = 0;
let startTime = Date.now();

async function smartDelay(requestNumber) {
  const now = Date.now();
  const timeSinceStart = now - startTime;
  const timeSinceLastRequest = now - lastRequestTime;

  // 連続リクエスト制限
  if (requestNumber > 0 && requestNumber % RATE_LIMIT.BURST_LIMIT === 0) {
    console.log(`  ⏸️  ${RATE_LIMIT.BURST_LIMIT}件処理完了 - ${RATE_LIMIT.LONG_BREAK / 1000}秒休憩中...`);
    await new Promise(resolve => setTimeout(resolve, RATE_LIMIT.LONG_BREAK));
    lastRequestTime = Date.now();
    return;
  }

  // 1分間のリクエスト数制限
  const requestsPerMinute = (requestCount / (timeSinceStart / 60000));
  if (requestsPerMinute > RATE_LIMIT.REQUESTS_PER_MINUTE) {
    const waitTime = 60000 - (timeSinceStart % 60000);
    console.log(`  ⏳ レート制限: ${Math.ceil(waitTime / 1000)}秒待機中...`);
    await new Promise(resolve => setTimeout(resolve, waitTime));
  }

  // 最小間隔の確保
  const minWaitTime = RATE_LIMIT.MIN_DELAY - timeSinceLastRequest;
  if (minWaitTime > 0) {
    await new Promise(resolve => setTimeout(resolve, minWaitTime));
  }

  // ランダム遅延（2-5秒）
  const randomDelay = RATE_LIMIT.MIN_DELAY + Math.random() * (RATE_LIMIT.MAX_DELAY - RATE_LIMIT.MIN_DELAY);
  await new Promise(resolve => setTimeout(resolve, randomDelay));

  lastRequestTime = Date.now();
}

// ページネーション対応で全投稿URLを収集
async function collectAllPostUrls(page, memberId, memberName, limit = null) {
  const allPosts = [];
  let currentPage = 0;
  const maxPages = 20; // 安全装置（最大20ページ）
  const needAll = limit === null; // limitがnullなら全件取得

  while (currentPage < maxPages) {
    const blogUrl = `https://sakurazaka46.com/s/s46/diary/blog/list?ima=0000&page=${currentPage}&ct=${memberId}&cd=blog`;

    await smartDelay(currentPage);
    await page.goto(blogUrl, { waitUntil: 'domcontentloaded', timeout: 30000 });
    await page.waitForTimeout(2000);
    requestCount++;

    const pageResult = await page.evaluate((currentPageNum) => {
      // メインブログリストエリアのみを選択（com-blog-partクラス）
      const mainBlogList = document.querySelector('.com-blog-part');
      if (!mainBlogList) {
        return { posts: [], hasNext: false };
      }

      // com-blog-part内のli.boxのみから投稿を取得
      const postItems = mainBlogList.querySelectorAll('li.box');
      const postData = [];
      const uniqueUrls = new Set();

      postItems.forEach(item => {
        const link = item.querySelector('a');
        if (!link) return;

        const href = link.getAttribute('href');
        if (href && href.includes('/diary/detail/') && !uniqueUrls.has(href)) {
          uniqueUrls.add(href);
          const fullUrl = href.startsWith('http') ? href : `https://sakurazaka46.com${href}`;

          // タイトルと日付を取得
          const dateElement = item.querySelector('.date, .time');
          const titleElement = item.querySelector('.title, h3, h4');

          postData.push({
            url: fullUrl,
            date: dateElement ? dateElement.textContent.trim() : '',
            title: titleElement ? titleElement.textContent.trim() : ''
          });
        }
      });

      // 次のページが存在するかチェック
      const paginationLinks = document.querySelectorAll('.com-pager a, .pager a, [class*="pager"] a');
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
    }, currentPage);

    if (pageResult.posts.length === 0) {
      break;
    }

    allPosts.push(...pageResult.posts);

    // limit指定時、必要件数に達したら即座に終了
    if (!needAll && allPosts.length >= limit) {
      break;
    }

    // 次ページがない場合は終了
    if (!pageResult.hasNext) {
      break;
    }

    currentPage++;
  }

  return allPosts;
}

async function scrapeBlogPosts(memberId, memberName, limit = 10) {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();
  const blogPosts = [];

  try {
    console.log(`${memberName}さんのブログをスクレイピング中 (ID: ${memberId})...`);
    console.log(`  🚀 スクレイピング開始 - 適切な間隔で処理します`);

    // limit = 'all' の場合、全件取得
    const isAll = limit === 'all';
    const targetLimit = isAll ? null : limit;

    // 全投稿URLを収集（ページネーション対応）
    // limitを渡して必要件数だけ収集
    const allPosts = await collectAllPostUrls(page, memberId, memberName, targetLimit);
    const postsToProcess = isAll ? allPosts : allPosts.slice(0, limit);

    console.log(`  📊 ${postsToProcess.length}件の投稿を処理します`);

    for (let index = 0; index < postsToProcess.length; index++) {
      const post = postsToProcess[index];
      console.log(`  📄 [${index + 1}/${postsToProcess.length}] ${post.title || 'Untitled'}`);

      // レート制限の適用
      await smartDelay(index);
      requestCount++;

      await page.goto(post.url, {
        waitUntil: 'domcontentloaded',
        timeout: 30000
      });

      const details = await page.evaluate(() => {
        // タイトルを取得（複数のセレクタを試す）
        let title = '';
        const titleSelectors = [
          '.box-ttl h1',
          '.box-ttl',
          'h1.title',
          'h1',
          '.blog-title',
          '.entry-title'
        ];

        for (const selector of titleSelectors) {
          const element = document.querySelector(selector);
          if (element && element.textContent.trim() && !element.textContent.includes('OFFICIAL BLOG')) {
            title = element.textContent.trim();
            break;
          }
        }

        // 本文を取得（より具体的なセレクタを使用）
        let content = '';
        const contentSelectors = [
          '.box-article',
          '.blog-body',
          '.entry-content',
          '.blog-content',
          '.article-body'
        ];

        for (const selector of contentSelectors) {
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

        // 日付を取得（シンプルな方法）
        let date = '';

        // 方法1: 年月日が別々の要素に入っている場合
        const yearEl = document.querySelector('.year');
        const monthEl = document.querySelector('.month');
        const dayEl = document.querySelector('.day');

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
              // 除外パターン（アイコンやロゴなど）
              const excludePatterns = ['icon', 'logo', 'header', 'footer', 'nav', 'menu', 'app_', 'jasrac'];
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
              const excludePatterns = ['icon', 'logo', 'header', 'footer', 'nav', 'menu', 'app_', 'jasrac'];
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
      });

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

    const totalTime = (Date.now() - startTime) / 1000;
    console.log(`✨ スクレイピング完了: ${blogPosts.length}件 (${totalTime.toFixed(1)}秒)`);
    console.log(`📊 平均処理時間: ${(totalTime / Math.max(blogPosts.length, 1)).toFixed(1)}秒/件`);

    // 統計をリセット
    requestCount = 0;
    startTime = Date.now();

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
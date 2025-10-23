const { chromium } = require("playwright");

// レート制限設定（櫻坂と同じ）
const RATE_LIMIT = {
  REQUESTS_PER_MINUTE: 15,
  MIN_DELAY: 2000,
  MAX_DELAY: 4000,
  BURST_LIMIT: 10,
  LONG_BREAK: 5000,
};

let requestCount = 0;
let lastRequestTime = 0;
let startTime = Date.now();

async function smartDelay(requestNumber) {
  const now = Date.now();
  const timeSinceStart = now - startTime;
  const timeSinceLastRequest = now - lastRequestTime;

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

  // 最低10秒経過してからレート制限チェック（初期の誤検知を防ぐ）
  if (timeSinceStart > 10000) {
    const requestsPerMinute = requestCount / (timeSinceStart / 60000);
    if (requestsPerMinute > RATE_LIMIT.REQUESTS_PER_MINUTE) {
      const waitTime = 60000 - (timeSinceStart % 60000);
      console.log(`  ⏳ レート制限: ${Math.ceil(waitTime / 1000)}秒待機中...`);
      await new Promise((resolve) => setTimeout(resolve, waitTime));
    }
  }

  const minWaitTime = RATE_LIMIT.MIN_DELAY - timeSinceLastRequest;
  if (minWaitTime > 0) {
    await new Promise((resolve) => setTimeout(resolve, minWaitTime));
  }

  const randomDelay =
    RATE_LIMIT.MIN_DELAY +
    Math.random() * (RATE_LIMIT.MAX_DELAY - RATE_LIMIT.MIN_DELAY);
  await new Promise((resolve) => setTimeout(resolve, randomDelay));

  lastRequestTime = Date.now();
}

// 欅坂46メンバーIDマッピング（櫻坂46メンバーの欅坂時代のID）
// 2025-10-23 更新: 欅坂46公式サイトから正しいIDを取得
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

// リストページから全投稿URLを収集（ページネーション対応）
async function collectAllPostUrls(page, memberId, memberName, limit = null) {
  const allPostUrls = [];
  let currentPage = 0;
  const maxPages = 100; // 最大100ページまで
  const needAll = limit === null; // limitがnullなら全件取得

  while (currentPage < maxPages) {
    const listUrl = `https://www.keyakizaka46.com/s/k46o/diary/member/list?ima=0000&page=${currentPage}&ct=${memberId}`;

    if (currentPage > 0) {
      await smartDelay(currentPage - 1);
    }

    await page.goto(listUrl, { waitUntil: "domcontentloaded", timeout: 30000 });
    await page.waitForTimeout(1500);
    requestCount++;

    const pageUrls = await page.evaluate(() => {
      const urls = [];
      const uniqueUrls = new Set();
      const allLinks = document.querySelectorAll("a[href*='/diary/detail/']");

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

              const boxBottom = postContainer.querySelector(".box-bottom");
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
    });

    if (pageUrls.length === 0) {
      break;
    }

    allPostUrls.push(...pageUrls);

    // limit指定時、必要件数に達したら即座に終了
    if (!needAll && allPostUrls.length >= limit) {
      break;
    }

    // 次のページがあるかチェック（簡易版：URLが20件未満なら最終ページ）
    if (pageUrls.length < 20) {
      break;
    }

    currentPage++;
  }

  return allPostUrls;
}

// 個別ページから投稿内容を取得
async function scrapePostDetail(page, url) {
  await page.goto(url, {
    waitUntil: "domcontentloaded",
    timeout: 30000,
  });
  await page.waitForTimeout(1000);

  const postData = await page.evaluate(() => {
    // タイトルを取得
    let title = "";
    const titleSelectors = [".box-ttl", "h1.title", "h1", ".blog-title"];
    for (const selector of titleSelectors) {
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
    const yearEl = document.querySelector(".year");
    const monthEl = document.querySelector(".month");
    const dayEl = document.querySelector(".day");

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
    const contentSelectors = [
      ".box-article",
      ".box--body",
      ".blog-body",
      ".blog-content",
    ];
    for (const selector of contentSelectors) {
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
      document.querySelector(".box-article, .box--body") || document.body;
    const imgElements = blogContainer.querySelectorAll("img");

    imgElements.forEach((img) => {
      const src = img.getAttribute("src");
      if (src && !imageSet.has(src)) {
        const excludePatterns = [
          "icon",
          "logo",
          "header",
          "footer",
          "nav",
          "menu",
          "app_",
          "jasrac",
          "twemoji", // 絵文字画像を除外
        ];
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
  });

  return postData;
}

async function scrapeKeyakiBlogPosts(memberName, limit = 10) {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();
  const blogPosts = [];

  try {
    // レート制限変数をリセット
    requestCount = 0;
    startTime = Date.now();
    lastRequestTime = 0;

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
    // limitを渡して必要件数だけ収集
    const allPostUrls = await collectAllPostUrls(page, memberId, memberName, targetLimit);

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
      requestCount++;

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

    const totalTime = (Date.now() - startTime) / 1000;
    console.log(
      `✨ スクレイピング完了: ${blogPosts.length}件 (${totalTime.toFixed(1)}秒)`
    );
    console.log(
      `📊 平均処理時間: ${(totalTime / Math.max(blogPosts.length, 1)).toFixed(
        1
      )}秒/件`
    );

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

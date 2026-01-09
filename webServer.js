const express = require("express");
const path = require("path");
const fs = require("fs");
const os = require("os");
const config = require("./config");
const { StorageAdapterFactory } = require("./storageAdapter");
const {
  parsePostDate,
  formatDate,
  isDateInRange,
} = require("./utils/dateUtils");
const {
  cleanTextPreview,
  decodeHTMLEntities,
  formatFileSize,
} = require("./utils/formatting");
const { PAGINATION } = require("./utils/constants");

// Storage Adapterの初期化
const storage = StorageAdapterFactory.create({
  type: config.storage.type,
  baseDir: config.storage.local.baseDir,
});

/**
 * 環境に応じた画像ベースURLを取得
 * @returns {string} 画像のベースURL
 */
function getImageBaseUrl() {
  if (config.storage.type === "s3" && config.storage.s3.baseUrl) {
    // S3モード：CloudFront URLまたはS3 URL
    return config.storage.s3.baseUrl;
  } else {
    // ローカルモード：相対URL
    return "/images";
  }
}

/**
 * ローカル/クラウド共通の画像URL生成ヘルパ
 * - 引数が 'images/...' や '/images/...' のいずれでも公開URLへ正規化
 * - 絶対URL(http/https)はそのまま返す
 * @param {string} p
 * @returns {string}
 */
function toImageUrl(p) {
  if (!p) return p;
  if (/^https?:\/\//.test(p)) return p;
  const base = getImageBaseUrl().replace(/\/+$/, "");
  let rel = String(p);
  // 絶対ファイルパスに '/images/' が含まれる場合は後ろを抽出
  const imagesIdx = rel.lastIndexOf("/images/");
  const imagesIdxWin = rel.toLowerCase().lastIndexOf("\\images\\");
  if (imagesIdx >= 0) {
    rel = rel.substring(imagesIdx + 1); // 先頭に 'images/...' が来る形へ
  } else if (imagesIdxWin >= 0) {
    rel = rel.substring(imagesIdxWin + 1).replace(/\\/g, "/");
  }
  // 先頭スラッシュを除去
  rel = rel.replace(/^\/+/, "");
  // 'images/' プレフィックスを剥がす（DBは 'images/...' を保持）
  rel = rel.replace(/^images\//, "");
  return `${base}/${rel}`;
}

// Google Services または SQLite の自動選択
let dataService;
let getImageStats;

if (fs.existsSync("config.json")) {
  const GoogleDataService = require("./googleDataService");
  dataService = new GoogleDataService();
  console.log("🔵 Google Drive/Sheets モードで起動します");
  getImageStats = () => ({ totalFiles: 0, totalSize: 0, memberStats: {} }); // Google用は別途実装
} else {
  const BlogDatabase = require("./database");
  const {
    IMAGE_DIR,
    getImageStats: localGetImageStats,
  } = require("./imageDownloader");
  dataService = new BlogDatabase();
  getImageStats = localGetImageStats;
  console.log("🟡 SQLite モードで起動します");
}

// 投稿の画像から総サイズを計算する関数
function calculateImageSize(posts) {
  let totalSize = 0;
  let imageCount = 0;
  let foundCount = 0;

  posts.forEach((post, idx) => {
    // local_imagesを優先的に使用（ローカルパスを格納）
    const imageSource = post.local_images || post.images;
    if (!imageSource) return;

    const images = Array.isArray(imageSource)
      ? imageSource
      : imageSource.split(",");

    images.forEach((imgPath) => {
      if (!imgPath) return;

      imageCount++;
      // 画像パスをトリム
      const cleanPath = imgPath.trim();

      // 絶対パスまたは相対パスとして処理
      // local_path例: "images/藤吉 夏鈴_sakurazaka46/post_59953_c5079658.jpg"
      const fullPath = cleanPath.startsWith("/")
        ? cleanPath
        : path.join(__dirname, cleanPath);

      try {
        if (fs.existsSync(fullPath)) {
          const stats = fs.statSync(fullPath);
          totalSize += stats.size;
          foundCount++;
        }
      } catch (error) {
        // ファイルアクセスエラーは無視
      }
    });
  });

  return totalSize;
}

const app = express();
const PORT = config.server.port;

// 静的ファイルの配信
if (fs.existsSync("config.json")) {
  // Google Drive モードでは静的ファイル配信は不要
} else {
  const { IMAGE_DIR } = require("./imageDownloader");
  // Storage Adapterを使った画像配信
  app.use("/images", express.static(IMAGE_DIR));
}
app.use(express.static("public"));
app.use(express.json()); // JSONパラメータのパース

// テンプレート共通ヘルパを登録
app.locals.toImageUrl = toImageUrl;
app.use((req, res, next) => {
  // 環境に応じたベースURLを各テンプレートから参照可能にする
  res.locals.imageBaseUrl = getImageBaseUrl();
  next();
});

// EJSテンプレートエンジンの設定
app.set("view engine", "ejs");
app.set("views", path.join(__dirname, "views"));

// parsePostDate, formatDate, isDateInRange は utils/dateUtils.js からインポート

// 高度な検索関数
async function performAdvancedSearch(options) {
  const {
    keyword,
    titleSearch,
    memberId,
    members,
    limit,
    dateFrom,
    dateTo,
    sortOrder,
    dataService,
  } = options;

  try {
    // 基本的な検索から開始
    let posts = [];

    if (keyword) {
      posts = await dataService.searchBlogPosts(keyword);
    } else {
      // キーワードがない場合は全ブログ取得
      posts = await dataService.getBlogPosts(null, 10000);
    }

    // タイトル検索でのフィルタリング
    if (titleSearch) {
      posts = posts.filter(
        (post) =>
          post.title &&
          post.title.toLowerCase().includes(titleSearch.toLowerCase())
      );
    }

    // メンバーフィルタリング
    if (memberId) {
      posts = posts.filter((post) => post.member_id == memberId);
    } else if (Array.isArray(members) && members.length > 0) {
      posts = posts.filter((post) =>
        members.includes(post.member_id.toString())
      );
    }

    // 日付範囲フィルタリング
    if (dateFrom || dateTo) {
      posts = posts.filter((post) => {
        if (!post.date) return false;

        const postDate = new Date(post.date);
        let isInRange = true;

        if (dateFrom) {
          const fromDate = new Date(dateFrom);
          if (postDate < fromDate) isInRange = false;
        }

        if (dateTo) {
          const toDate = new Date(dateTo);
          toDate.setHours(23, 59, 59, 999); // 終日まで含める
          if (postDate > toDate) isInRange = false;
        }

        return isInRange;
      });
    }

    // 日付によるソート
    if (sortOrder === "asc") {
      posts.sort((a, b) => {
        const dateA = parsePostDate(a.date);
        const dateB = parsePostDate(b.date);
        return dateA - dateB;
      });
    } else {
      posts.sort((a, b) => {
        const dateA = parsePostDate(a.date);
        const dateB = parsePostDate(b.date);
        return dateB - dateA;
      });
    }

    // リミット適用
    return posts.slice(0, limit);
  } catch (error) {
    console.error("高度な検索エラー:", error);
    return [];
  }
}

// cleanTextPreview, decodeHTMLEntities は utils/formatting.js からインポート

// EJSテンプレートでグローバルに使える関数を登録
app.locals.cleanTextPreview = cleanTextPreview;
app.locals.decodeHTMLEntities = decodeHTMLEntities;

/**
 * リクエストから検索パラメータを抽出
 * @param {object} req - Expressリクエストオブジェクト
 * @returns {object} 検索パラメータ
 */
function extractSearchParams(req) {
  let members = req.query.members || [];
  if (!Array.isArray(members)) {
    members = [members];
  }
  return {
    keyword: req.query.q || "",
    titleSearch: req.query.title_search || "",
    memberId: req.query.member || null,
    members,
    perPage: parseInt(req.query.per_page) || 20,
    page: parseInt(req.query.page) || 1,
    dateFrom: req.query.date_from || "",
    dateTo: req.query.date_to || "",
    sortOrder: req.query.sort || "desc",
  };
}

/**
 * フィルター適用後の統計情報を計算
 * @param {Array} posts - 投稿の配列
 * @returns {object} フィルター適用後の統計情報
 */
function calculateFilteredStats(posts) {
  return {
    totalPosts: posts.length,
    uniqueAuthors: new Set(posts.map((p) => p.member_id)).size,
    totalImages: posts.reduce((sum, post) => {
      const imgCount = post.images
        ? Array.isArray(post.images)
          ? post.images.length
          : post.images.split(",").length
        : 0;
      return sum + imgCount;
    }, 0),
    totalSize: calculateImageSize(posts),
  };
}

/**
 * 全体の統計情報を取得
 * @param {object} baseStats - 基本の統計情報
 * @returns {Promise<object>} 全体の統計情報
 */
async function getGlobalStats(baseStats) {
  const globalStats = { ...baseStats };
  if (!fs.existsSync("config.json")) {
    try {
      const authorsResult = await new Promise((resolve, reject) => {
        dataService.db.get(
          "SELECT COUNT(DISTINCT member_name) as count FROM blog_posts",
          (err, row) => (err ? reject(err) : resolve(row))
        );
      });
      globalStats.uniqueAuthors = authorsResult.count;

      const postsResult = await new Promise((resolve, reject) => {
        dataService.db.get(
          "SELECT COUNT(*) as count FROM blog_posts",
          (err, row) => (err ? reject(err) : resolve(row))
        );
      });
      globalStats.totalPosts = postsResult.count;
    } catch (err) {
      console.error("Error getting global stats:", err);
    }
  }
  return globalStats;
}

/**
 * ページネーション情報を計算
 * @param {number} totalPosts - 総投稿数
 * @param {number} page - 現在のページ
 * @param {number} perPage - 1ページあたりの件数
 * @returns {object} ページネーション情報
 */
function calculatePagination(totalPosts, page, perPage) {
  const totalPages = Math.ceil(totalPosts / perPage);
  return {
    page,
    perPage,
    totalPages,
    totalPosts,
    hasNext: page < totalPages,
    hasPrev: page > 1,
  };
}

/**
 * フィルターが適用されているかをチェック
 * @param {object} params - 検索パラメータ
 * @returns {boolean} フィルターが適用されているか
 */
function isFilterApplied(params) {
  return !!(
    params.keyword ||
    params.titleSearch ||
    params.memberId ||
    (params.members && params.members.length > 0) ||
    params.dateFrom ||
    params.dateTo
  );
}

// ホームページ - 検索画面
app.get("/", async (req, res) => {
  try {
    const params = extractSearchParams(req);

    const allPosts = await performAdvancedSearch({
      ...params,
      limit: 10000,
      dataService,
    });

    const offset = (params.page - 1) * params.perPage;
    const posts = allPosts.slice(offset, offset + params.perPage);
    const formattedPosts = posts.map((post) => ({
      ...post,
      date: formatDate(post.date),
    }));

    const allMembers = await dataService.getAllMembersFromPosts();
    const stats = fs.existsSync("config.json")
      ? await dataService.getStats()
      : getImageStats();

    const globalStats = await getGlobalStats(stats);

    res.render("index", {
      keyword: params.keyword,
      posts: formattedPosts,
      members: allMembers,
      stats: globalStats,
      filteredStats: calculateFilteredStats(allPosts),
      isFiltered: isFilterApplied(params),
      title: "櫻坂46 ブログアーカイブ",
      req,
      pagination: calculatePagination(allPosts.length, params.page, params.perPage),
    });
  } catch (error) {
    console.error(error);
    res.status(500).send("エラーが発生しました");
  }
});

// 画像デバッグ用API: 指定投稿の画像配線状況を確認
app.get("/api/post/:id/debug", async (req, res) => {
  try {
    const postId = req.params.id;
    const post = await dataService.getBlogPost(postId);
    if (!post) {
      res.status(404).json({ error: "post not found" });
      return;
    }
    const baseDir = config.storage.local.baseDir;
    const images = Array.isArray(post.images) ? post.images : [];
    const localImages = Array.isArray(post.local_images)
      ? post.local_images
      : [];
    const mapped = localImages.map((lp) => {
      const url = toImageUrl(lp);
      const abs = lp
        ? path.isAbsolute(lp)
          ? lp
          : path.join(baseDir, lp)
        : null;
      const exists = abs ? fs.existsSync(abs) : false;
      return { localPath: lp, resolvedUrl: url, absolutePath: abs, exists };
    });
    res.json({
      postId,
      imagesCount: images.length,
      localImagesCount: localImages.length,
      images,
      localImages,
      mapped,
      imageBaseUrl: getImageBaseUrl(),
      staticDir: fs.existsSync("config.json")
        ? null
        : require("./imageDownloader").IMAGE_DIR,
    });
  } catch (e) {
    console.error("debug endpoint error:", e);
    res
      .status(500)
      .json({ error: "debug failed", message: String(e?.message || e) });
  }
});

// メンバー一覧ページ
app.get("/members", async (req, res) => {
  try {
    const members = await dataService.getAllMembersFromPosts();
    const stats = fs.existsSync("config.json")
      ? await dataService.getStats()
      : getImageStats();

    res.render("members", {
      members,
      stats,
      title: "メンバー一覧",
    });
  } catch (error) {
    console.error(error);
    res.status(500).send("エラーが発生しました");
  }
});

// メンバー別ブログ一覧
app.get("/member/:id", async (req, res) => {
  try {
    const memberId = req.params.id;
    const members = await dataService.getAllMembersFromPosts();
    const member = members.find((m) => m.id == memberId);

    if (!member) {
      res.status(404).send("メンバーが見つかりません");
      return;
    }

    // ページネーション
    const page = parseInt(req.query.page) || 1;
    const perPage = parseInt(req.query.per_page) || 50;

    // すべての投稿を取得
    const allPosts = await dataService.getBlogPosts(memberId, 10000);

    // ページネーション計算
    const totalPosts = allPosts.length;
    const totalPages = Math.ceil(totalPosts / perPage);
    const offset = (page - 1) * perPage;
    const posts = allPosts.slice(offset, offset + perPage);

    // 日付をフォーマット
    const formattedPosts = posts.map((post) => ({
      ...post,
      date: formatDate(post.date),
    }));

    res.render("member", {
      member,
      posts: formattedPosts,
      title: `${member.name} - ブログ一覧`,
      req: req,
      pagination: {
        page,
        perPage,
        totalPages,
        totalPosts,
        hasNext: page < totalPages,
        hasPrev: page > 1,
      },
    });
  } catch (error) {
    console.error(error);
    res.status(500).send("エラーが発生しました");
  }
});

// ブログ詳細
app.get("/post/:id", async (req, res) => {
  try {
    const postId = req.params.id;

    // 画像込みで単一投稿を取得
    let post;
    if (fs.existsSync("config.json")) {
      // Google Sheets対応のブログ取得
      const allPosts = await dataService.getBlogPosts(null, 10000);
      post = allPosts.find((p) => p.id == postId);
    } else {
      // SQLiteから画像込みで取得
      post = await dataService.getBlogPost(postId);
    }

    if (!post) {
      res.status(404).send("ブログが見つかりません");
      return;
    }

    // 同じメンバーの全投稿を取得して前後のブログを探す
    let prevPost = null;
    let nextPost = null;

    try {
      let allMemberPosts;

      if (fs.existsSync("config.json")) {
        // Google Sheetsの場合は全投稿を取得してフィルタリング
        const allPosts = await dataService.getBlogPosts(null, 10000);
        allMemberPosts = allPosts.filter((p) => p.member_id == post.member_id);
      } else {
        // SQLiteの場合
        allMemberPosts = await dataService.getBlogPosts(post.member_id, 10000);
      }

      // 日付でソート（降順：新しい→古い）
      allMemberPosts.sort((a, b) => {
        const dateA = parsePostDate(a.date);
        const dateB = parsePostDate(b.date);
        return dateB - dateA;
      });

      // 現在のブログのインデックスを見つける
      const currentIndex = allMemberPosts.findIndex((p) => p.id == postId);

      // 前のブログ（より新しい）と次のブログ（より古い）を取得
      if (currentIndex > 0) {
        prevPost = {
          ...allMemberPosts[currentIndex - 1],
          date: formatDate(allMemberPosts[currentIndex - 1].date),
        };
      }

      if (currentIndex < allMemberPosts.length - 1 && currentIndex >= 0) {
        nextPost = {
          ...allMemberPosts[currentIndex + 1],
          date: formatDate(allMemberPosts[currentIndex + 1].date),
        };
      }
    } catch (navError) {
      console.error("ナビゲーション取得エラー:", navError);
      // エラーが発生してもページは表示する
    }

    // 日付をフォーマット
    post = {
      ...post,
      date: formatDate(post.date),
    };

    res.render("post", {
      post,
      prevPost,
      nextPost,
      title: post.title || "ブログ",
      imageBaseUrl: getImageBaseUrl(),
    });
  } catch (error) {
    console.error(error);
    res.status(500).send("エラーが発生しました");
  }
});

// 投稿削除
app.delete("/api/post/:id", async (req, res) => {
  try {
    const postId = req.params.id;
    const result = await dataService.deleteBlogPost(postId);

    if (result > 0) {
      res.json({ success: true, message: "投稿が削除されました" });
    } else {
      res.status(404).json({ success: false, message: "投稿が見つかりません" });
    }
  } catch (error) {
    console.error(error);
    res.status(500).json({ success: false, message: "エラーが発生しました" });
  }
});

// 一括投稿削除
app.delete("/api/posts/bulk-delete", async (req, res) => {
  try {
    const { postIds } = req.body;

    if (!postIds || !Array.isArray(postIds) || postIds.length === 0) {
      res.status(400).json({
        success: false,
        message: "削除する投稿IDが指定されていません",
      });
      return;
    }

    console.log(`一括削除開始: ${postIds.length}件の投稿`);

    let deletedCount = 0;
    const errors = [];

    for (const postId of postIds) {
      try {
        const result = await dataService.deleteBlogPost(postId);
        if (result > 0) {
          deletedCount++;
        }
      } catch (error) {
        errors.push(`Post ${postId}: ${error.message}`);
      }
    }

    if (deletedCount > 0) {
      console.log(`一括削除完了: ${deletedCount}件削除`);
      res.json({
        success: true,
        message: `${deletedCount}件の投稿が削除されました`,
        deletedCount,
        errors: errors.length > 0 ? errors : undefined,
      });
    } else {
      res.status(404).json({
        success: false,
        message: "削除できる投稿が見つかりませんでした",
      });
    }
  } catch (error) {
    console.error("一括削除エラー:", error);
    res.status(500).json({ success: false, message: "エラーが発生しました" });
  }
});

// 検索
app.get("/search", async (req, res) => {
  try {
    const params = extractSearchParams(req);

    const allPosts = await performAdvancedSearch({
      ...params,
      limit: 10000,
      dataService,
    });

    const offset = (params.page - 1) * params.perPage;
    const posts = allPosts.slice(offset, offset + params.perPage);
    const formattedPosts = posts.map((post) => ({
      ...post,
      date: formatDate(post.date),
    }));

    const allMembers = await dataService.getAllMembersFromPosts();

    res.render("search", {
      keyword: params.keyword,
      posts: formattedPosts,
      members: allMembers,
      filteredStats: calculateFilteredStats(allPosts),
      isFiltered: isFilterApplied(params),
      title: params.keyword ? `「${params.keyword}」の検索結果` : "検索",
      req,
      pagination: calculatePagination(allPosts.length, params.page, params.perPage),
    });
  } catch (error) {
    console.error(error);
    res.status(500).send("エラーが発生しました");
  }
});

// ローカルIPアドレスを取得
function getLocalIPAddress() {
  const interfaces = os.networkInterfaces();
  for (const name of Object.keys(interfaces)) {
    for (const iface of interfaces[name]) {
      // IPv4で、内部アドレスでないものを探す
      if (iface.family === "IPv4" && !iface.internal) {
        return iface.address;
      }
    }
  }
  return "localhost";
}

// サーバー起動
function startServer() {
  const localIP = getLocalIPAddress();
  const server = app.listen(PORT, "0.0.0.0", () => {
    console.log(`\n✨ Webサーバーが起動しました`);
    console.log(`🌐 PCで開く: http://localhost:${PORT}`);
    if (localIP !== "localhost") {
      console.log(`📱 スマホで開く: http://${localIP}:${PORT}`);
      console.log(`⚠️  同じWi-Fiネットワーク内からのみアクセスしてください`);
    }
    console.log(`📊 サーバーは自動的にバックグラウンドで実行されます\n`);
  });

  // プロセス終了時のクリーンアップ
  process.on("SIGINT", () => {
    console.log("\n🛑 Webサーバーを停止します...");
    server.close(() => {
      dataService.close();
      process.exit(0);
    });
  });

  return server;
}

// エクスポート
module.exports = { startServer };

// 直接実行された場合
if (require.main === module) {
  startServer();
}

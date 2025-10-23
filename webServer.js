const express = require('express');
const path = require('path');
const fs = require('fs');
const os = require('os');

// Google Services または SQLite の自動選択
let dataService;
let getImageStats;

if (fs.existsSync('config.json')) {
  const GoogleDataService = require('./googleDataService');
  dataService = new GoogleDataService();
  console.log('🔵 Google Drive/Sheets モードで起動します');
  getImageStats = () => ({ totalFiles: 0, totalSize: 0, memberStats: {} }); // Google用は別途実装
} else {
  const BlogDatabase = require('./database');
  const { IMAGE_DIR, getImageStats: localGetImageStats } = require('./imageDownloader');
  dataService = new BlogDatabase();
  getImageStats = localGetImageStats;
  console.log('🟡 SQLite モードで起動します');
}

const app = express();
const PORT = 3000;

// 静的ファイルの配信
if (fs.existsSync('config.json')) {
  // Google Drive モードでは静的ファイル配信は不要
} else {
  const { IMAGE_DIR } = require('./imageDownloader');
  app.use('/images', express.static(IMAGE_DIR));
}
app.use(express.static('public'));
app.use(express.json()); // JSONパラメータのパース

// EJSテンプレートエンジンの設定
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));

// 日付解析関数
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

// 高度な検索関数
async function performAdvancedSearch(options) {
  const { keyword, titleSearch, memberId, members, limit, dateFrom, dateTo, sortOrder, dataService } = options;

  try {
    // 基本的な検索から開始
    let posts = [];

    if (keyword) {
      posts = await dataService.searchBlogPosts(keyword);
    } else {
      // キーワードがない場合は全記事取得
      posts = await dataService.getBlogPosts(null, 10000);
    }

    // タイトル検索でのフィルタリング
    if (titleSearch) {
      posts = posts.filter(post =>
        post.title && post.title.toLowerCase().includes(titleSearch.toLowerCase())
      );
    }

    // メンバーフィルタリング
    if (memberId) {
      posts = posts.filter(post => post.member_id == memberId);
    } else if (Array.isArray(members) && members.length > 0) {
      posts = posts.filter(post => members.includes(post.member_id.toString()));
    }

    // 日付範囲フィルタリング
    if (dateFrom || dateTo) {
      posts = posts.filter(post => {
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
    if (sortOrder === 'asc') {
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
    console.error('高度な検索エラー:', error);
    return [];
  }
}

// 日付フォーマット関数
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

// ホームページ - 検索画面
app.get('/', async (req, res) => {
  try {
    const keyword = req.query.q || '';
    const titleSearch = req.query.title_search || '';
    const memberId = req.query.member || null;
    const members = req.query.members || [];
    const perPage = parseInt(req.query.per_page) || 20;
    const page = parseInt(req.query.page) || 1;
    const dateFrom = req.query.date_from || '';
    const dateTo = req.query.date_to || '';
    const sortOrder = req.query.sort || 'desc';

    // 全件取得してからページング処理
    let allPosts = await performAdvancedSearch({
      keyword,
      titleSearch,
      memberId,
      members,
      limit: 10000, // 全件取得
      dateFrom,
      dateTo,
      sortOrder,
      dataService
    });

    // ページネーション計算
    const totalPosts = allPosts.length;
    const totalPages = Math.ceil(totalPosts / perPage);
    const offset = (page - 1) * perPage;
    const posts = allPosts.slice(offset, offset + perPage);

    // 日付をフォーマット
    const formattedPosts = posts.map(post => ({
      ...post,
      date: formatDate(post.date)
    }));

    const allMembers = await dataService.getMembers();
    const stats = fs.existsSync('config.json') ?
      await dataService.getStats() : getImageStats();

    // Get unique author count from database
    let uniqueAuthors = 0;
    if (!fs.existsSync('config.json')) {
      try {
        const result = await new Promise((resolve, reject) => {
          dataService.db.get(
            'SELECT COUNT(DISTINCT member_name) as count FROM blog_posts',
            (err, row) => {
              if (err) reject(err);
              else resolve(row);
            }
          );
        });
        uniqueAuthors = result.count;
      } catch (err) {
        console.error('Error getting unique authors:', err);
      }
    }
    stats.uniqueAuthors = uniqueAuthors;

    res.render('index', {
      keyword,
      posts: formattedPosts,
      members: allMembers,
      stats,
      title: '櫻坂46 ブログアーカイブ',
      req: req,
      pagination: {
        page,
        perPage,
        totalPages,
        totalPosts,
        hasNext: page < totalPages,
        hasPrev: page > 1
      }
    });
  } catch (error) {
    console.error(error);
    res.status(500).send('エラーが発生しました');
  }
});

// メンバー一覧ページ
app.get('/members', async (req, res) => {
  try {
    const members = await dataService.getMembers();
    const stats = fs.existsSync('config.json') ?
      await dataService.getStats() : getImageStats();

    res.render('members', {
      members,
      stats,
      title: 'メンバー一覧'
    });
  } catch (error) {
    console.error(error);
    res.status(500).send('エラーが発生しました');
  }
});

// メンバー別ブログ一覧
app.get('/member/:id', async (req, res) => {
  try {
    const memberId = req.params.id;
    const members = await dataService.getMembers();
    const member = members.find(m => m.id == memberId);

    if (!member) {
      res.status(404).send('メンバーが見つかりません');
      return;
    }

    let posts = await dataService.getBlogPosts(memberId, 100);

    // 日付をフォーマット
    posts = posts.map(post => ({
      ...post,
      date: formatDate(post.date)
    }));

    res.render('member', {
      member,
      posts,
      title: `${member.name} - ブログ一覧`
    });
  } catch (error) {
    console.error(error);
    res.status(500).send('エラーが発生しました');
  }
});

// ブログ記事詳細
app.get('/post/:id', async (req, res) => {
  try {
    const postId = req.params.id;

    // 画像込みで単一投稿を取得
    let post;
    if (fs.existsSync('config.json')) {
      // Google Sheets対応の記事取得
      const allPosts = await dataService.getBlogPosts(null, 10000);
      post = allPosts.find(p => p.id == postId);
    } else {
      // SQLiteから画像込みで取得
      post = await dataService.getBlogPost(postId);
    }

    if (!post) {
      res.status(404).send('記事が見つかりません');
      return;
    }

    // 日付をフォーマット
    post = {
      ...post,
      date: formatDate(post.date)
    };

    res.render('post', {
      post,
      title: post.title || 'ブログ記事'
    });
  } catch (error) {
    console.error(error);
    res.status(500).send('エラーが発生しました');
  }
});

// 投稿削除
app.delete('/api/post/:id', async (req, res) => {
  try {
    const postId = req.params.id;
    const result = await dataService.deleteBlogPost(postId);

    if (result > 0) {
      res.json({ success: true, message: '投稿が削除されました' });
    } else {
      res.status(404).json({ success: false, message: '投稿が見つかりません' });
    }
  } catch (error) {
    console.error(error);
    res.status(500).json({ success: false, message: 'エラーが発生しました' });
  }
});

// 一括投稿削除
app.delete('/api/posts/bulk-delete', async (req, res) => {
  try {
    const { postIds } = req.body;

    if (!postIds || !Array.isArray(postIds) || postIds.length === 0) {
      res.status(400).json({ success: false, message: '削除する投稿IDが指定されていません' });
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
        errors: errors.length > 0 ? errors : undefined
      });
    } else {
      res.status(404).json({ success: false, message: '削除できる投稿が見つかりませんでした' });
    }
  } catch (error) {
    console.error('一括削除エラー:', error);
    res.status(500).json({ success: false, message: 'エラーが発生しました' });
  }
});

// 検索
app.get('/search', async (req, res) => {
  try {
    const keyword = req.query.q || '';

    if (keyword) {
      const posts = await dataService.searchBlogPosts(keyword);
      res.render('search', {
        keyword,
        posts,
        title: `「${keyword}」の検索結果`
      });
    } else {
      res.render('search', {
        keyword: '',
        posts: [],
        title: '検索'
      });
    }
  } catch (error) {
    console.error(error);
    res.status(500).send('エラーが発生しました');
  }
});

// ローカルIPアドレスを取得
function getLocalIPAddress() {
  const interfaces = os.networkInterfaces();
  for (const name of Object.keys(interfaces)) {
    for (const iface of interfaces[name]) {
      // IPv4で、内部アドレスでないものを探す
      if (iface.family === 'IPv4' && !iface.internal) {
        return iface.address;
      }
    }
  }
  return 'localhost';
}

// サーバー起動
function startServer() {
  const localIP = getLocalIPAddress();
  const server = app.listen(PORT, '0.0.0.0', () => {
    console.log(`\n✨ Webサーバーが起動しました`);
    console.log(`🌐 PCで開く: http://localhost:${PORT}`);
    if (localIP !== 'localhost') {
      console.log(`📱 スマホで開く: http://${localIP}:${PORT}`);
      console.log(`⚠️  同じWi-Fiネットワーク内からのみアクセスしてください`);
    }
    console.log(`📊 サーバーは自動的にバックグラウンドで実行されます\n`);
  });

  // プロセス終了時のクリーンアップ
  process.on('SIGINT', () => {
    console.log('\n🛑 Webサーバーを停止します...');
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
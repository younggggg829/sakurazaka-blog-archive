const sqlite3 = require('sqlite3').verbose();
const path = require('path');
const fs = require('fs');
const { promisify } = require('util');

/**
 * ブログデータベース管理クラス
 * SQLite3を使用してブログ投稿、メンバー、画像情報を管理
 */
class BlogDatabase {
  constructor() {
    const dbPath = path.join(__dirname, 'sakurazaka_blog.db');
    this.db = new sqlite3.Database(dbPath);

    // Promisifyでメソッドをasync/await対応に
    this.dbRun = promisify(this.db.run.bind(this.db));
    this.dbGet = promisify(this.db.get.bind(this.db));
    this.dbAll = promisify(this.db.all.bind(this.db));

    this.initDatabase();
  }

  /**
   * データベーステーブルを初期化
   */
  initDatabase() {
    this.db.serialize(() => {
      // メンバーテーブル
      this.db.run(`
        CREATE TABLE IF NOT EXISTS members (
          id INTEGER PRIMARY KEY,
          name TEXT NOT NULL,
          blog_url TEXT
        )
      `);

      // ブログ投稿テーブル
      this.db.run(`
        CREATE TABLE IF NOT EXISTS blog_posts (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          member_id INTEGER,
          member_name TEXT,
          url TEXT UNIQUE,
          title TEXT,
          date TEXT,
          content TEXT,
          site TEXT DEFAULT 'sakurazaka46',
          created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
          FOREIGN KEY (member_id) REFERENCES members (id)
        )
      `);

      // ブログ画像テーブル
      this.db.run(`
        CREATE TABLE IF NOT EXISTS blog_images (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          post_id INTEGER,
          image_url TEXT,
          local_path TEXT,
          FOREIGN KEY (post_id) REFERENCES blog_posts (id)
        )
      `);
    });
  }

  /**
   * メンバー情報を保存
   * @param {object} member - メンバーオブジェクト {id, name, blogUrl}
   */
  async saveMember(member) {
    const stmt = this.db.prepare(
      'INSERT OR REPLACE INTO members (id, name, blog_url) VALUES (?, ?, ?)'
    );

    return new Promise((resolve, reject) => {
      stmt.run(member.id, member.name, member.blogUrl, (err) => {
        if (err) reject(err);
        else resolve();
      });
      stmt.finalize();
    });
  }

  /**
   * 複数のメンバー情報を保存
   * @param {Array<object>} members - メンバーオブジェクトの配列
   */
  async saveMembers(members) {
    return Promise.all(members.map(member => this.saveMember(member)));
  }

  /**
   * 全メンバー情報を取得
   * @returns {Promise<Array>} メンバーの配列
   */
  async getMembers() {
    return this.dbAll('SELECT * FROM members ORDER BY name');
  }

  /**
   * ブログ投稿から全メンバーを取得（櫻坂46と欅坂46両方）
   * @returns {Promise<Array>} メンバーの配列（投稿数とサイト情報を含む）
   */
  async getAllMembersFromPosts() {
    const rows = await this.dbAll(`
      SELECT
        member_id as id,
        member_name as name,
        GROUP_CONCAT(DISTINCT site) as sites,
        SUM(post_count) as post_count
      FROM (
        SELECT
          member_id,
          member_name,
          site,
          COUNT(*) as post_count
        FROM blog_posts
        GROUP BY member_id, member_name, site
      )
      GROUP BY member_id, member_name
      ORDER BY name
    `);

    // sitesにkeyakizaka46が含まれているかチェック
    return rows.map(row => ({
      ...row,
      has_keyaki: row.sites && row.sites.includes('keyakizaka46')
    }));
  }

  /**
   * ブログ投稿を保存（画像情報も含む）
   * @param {object} post - 投稿オブジェクト {memberId, memberName, url, title, date, content, site, images}
   * @returns {Promise<number>} 保存された投稿のID
   */
  async saveBlogPost(post) {
    return new Promise((resolve, reject) => {
      const stmt = this.db.prepare(`
        INSERT OR REPLACE INTO blog_posts (member_id, member_name, url, title, date, content, site)
        VALUES (?, ?, ?, ?, ?, ?, ?)
      `);

      const self = this;
      stmt.run(
        post.memberId,
        post.memberName,
        post.url,
        post.title,
        post.date,
        post.content,
        post.site || 'sakurazaka46',
        function(err) {
          if (err) {
            reject(err);
          } else {
            const postId = this.lastID;

            // 画像情報を保存
            if (post.images && post.images.length > 0) {
              const imageStmt = self.db.prepare(
                'INSERT INTO blog_images (post_id, image_url) VALUES (?, ?)'
              );

              post.images.forEach(imageUrl => {
                imageStmt.run(postId, imageUrl);
              });

              imageStmt.finalize();
            }

            resolve(postId);
          }
        }
      );

      stmt.finalize();
    });
  }

  /**
   * 複数のブログ投稿を保存
   * @param {Array<object>} posts - 投稿オブジェクトの配列
   * @returns {Promise<Array>} 保存された投稿IDの配列
   */
  async saveBlogPosts(posts) {
    return Promise.all(posts.map(post => this.saveBlogPost(post)));
  }

  /**
   * ブログ投稿を取得（画像情報も含む）
   * @param {number|null} memberId - メンバーID（nullの場合は全メンバー）
   * @param {number} limit - 取得件数制限（使用されていない - webServerで制御）
   * @returns {Promise<Array>} 投稿の配列
   */
  async getBlogPosts(memberId = null, limit = 10) {
    let query = `
      SELECT bp.*,
             GROUP_CONCAT(bi.image_url) as images,
             GROUP_CONCAT(bi.local_path) as local_images
      FROM blog_posts bp
      LEFT JOIN blog_images bi ON bp.id = bi.post_id
    `;

    const params = [];

    if (memberId) {
      query += ' WHERE bp.member_id = ?';
      params.push(memberId);
    }

    query += ' GROUP BY bp.id';

    const rows = await this.dbAll(query, params);

    return rows.map(row => ({
      ...row,
      images: row.images ? row.images.split(',') : [],
      local_images: row.local_images ? row.local_images.split(',').filter(p => p) : []
    }));
  }

  /**
   * ブログ投稿をキーワードで検索
   * @param {string} keyword - 検索キーワード
   * @returns {Promise<Array>} 検索結果の投稿配列
   */
  async searchBlogPosts(keyword) {
    const query = `
      SELECT bp.*,
             GROUP_CONCAT(bi.image_url) as images,
             GROUP_CONCAT(bi.local_path) as local_images
      FROM blog_posts bp
      LEFT JOIN blog_images bi ON bp.id = bi.post_id
      WHERE bp.title LIKE ? OR bp.content LIKE ?
      GROUP BY bp.id
    `;

    const searchTerm = `%${keyword}%`;
    const rows = await this.dbAll(query, [searchTerm, searchTerm]);

    return rows.map(row => ({
      ...row,
      images: row.images ? row.images.split(',') : [],
      local_images: row.local_images ? row.local_images.split(',').filter(p => p) : []
    }));
  }

  /**
   * 全ブログ投稿を取得（日付降順）
   * @returns {Promise<Array>} 全投稿の配列
   */
  async getAllBlogPosts() {
    const query = `
      SELECT bp.*,
             GROUP_CONCAT(bi.image_url) as images,
             GROUP_CONCAT(bi.local_path) as local_images
      FROM blog_posts bp
      LEFT JOIN blog_images bi ON bp.id = bi.post_id
      GROUP BY bp.id
      ORDER BY bp.date DESC
    `;

    const rows = await this.dbAll(query);

    return rows.map(row => ({
      ...row,
      images: row.images ? row.images.split(',') : [],
      local_images: row.local_images ? row.local_images.split(',').filter(p => p) : []
    }));
  }

  /**
   * 特定投稿の画像情報を取得
   * @param {number} postId - 投稿ID
   * @returns {Promise<Array>} 画像情報の配列
   */
  async getBlogImages(postId) {
    return this.dbAll('SELECT * FROM blog_images WHERE post_id = ?', [postId]);
  }

  /**
   * ブログ投稿の画像ローカルパスを更新
   * @param {string} postUrl - 投稿URL
   * @param {Array<string>} localImagePaths - ローカル画像パスの配列
   */
  async updateBlogPostImages(postUrl, localImagePaths) {
    // 投稿IDを取得
    const row = await this.dbGet('SELECT id FROM blog_posts WHERE url = ?', [postUrl]);

    if (!row) {
      throw new Error('Post not found');
    }

    const postId = row.id;

    // 既存の画像レコードを取得
    const imageRows = await this.dbAll(
      'SELECT * FROM blog_images WHERE post_id = ? ORDER BY id',
      [postId]
    );

    // ローカルパスを更新
    const updatePromises = imageRows.map((imageRow, index) => {
      const localPath = localImagePaths[index] || null;
      return this.dbRun(
        'UPDATE blog_images SET local_path = ? WHERE id = ?',
        [localPath, imageRow.id]
      );
    });

    await Promise.all(updatePromises);
  }

  /**
   * 単一ブログ投稿を取得（画像込み）
   * @param {number} postId - 投稿ID
   * @returns {Promise<object|null>} 投稿オブジェクト、または見つからない場合null
   */
  async getBlogPost(postId) {
    const query = `
      SELECT bp.*,
             GROUP_CONCAT(bi.image_url) as images,
             GROUP_CONCAT(bi.local_path) as local_images
      FROM blog_posts bp
      LEFT JOIN blog_images bi ON bp.id = bi.post_id
      WHERE bp.id = ?
      GROUP BY bp.id
    `;

    const row = await this.dbGet(query, [postId]);

    if (row) {
      return {
        ...row,
        images: row.images ? row.images.split(',') : [],
        local_images: row.local_images ? row.local_images.split(',').filter(p => p) : []
      };
    }

    return null;
  }

  /**
   * ブログ投稿を削除（画像ファイルとレコードも削除）
   * @param {number} postId - 削除する投稿ID
   * @returns {Promise<number>} 削除された行数
   */
  async deleteBlogPost(postId) {
    console.log(`\n=== ブログ削除開始: Post ID = ${postId} ===`);

    return new Promise((resolve, reject) => {
      this.db.serialize(() => {
        // 先に画像情報を取得して、ローカルファイルを削除
        this.db.all('SELECT local_path FROM blog_images WHERE post_id = ?', [postId], (err, imageRows) => {
          if (err) {
            console.error('画像情報取得エラー:', err);
            reject(err);
            return;
          }

          console.log(`画像レコード数: ${imageRows ? imageRows.length : 0}`);

          // ローカル画像ファイルを削除
          if (imageRows && imageRows.length > 0) {
            imageRows.forEach((row, index) => {
              console.log(`\n[画像 ${index + 1}/${imageRows.length}]`);
              console.log(`  local_path: ${row.local_path}`);

              if (row.local_path) {
                try {
                  // 相対パスを絶対パスに変換
                  const absolutePath = row.local_path.startsWith('/')
                    ? row.local_path
                    : path.join(__dirname, row.local_path);

                  console.log(`  絶対パス: ${absolutePath}`);
                  console.log(`  ファイル存在: ${fs.existsSync(absolutePath)}`);

                  if (fs.existsSync(absolutePath)) {
                    fs.unlinkSync(absolutePath);
                    console.log(`  ✓ 画像ファイル削除成功: ${row.local_path}`);
                  } else {
                    console.log(`  ✗ ファイルが見つかりません: ${absolutePath}`);
                  }
                } catch (fileErr) {
                  console.error(`  ✗ 画像ファイル削除エラー: ${row.local_path}`, fileErr.message);
                  // ファイル削除エラーは続行（データベースレコードは削除する）
                }
              } else {
                console.log(`  ✗ local_pathが空です`);
              }
            });
          } else {
            console.log('削除する画像ファイルはありません');
          }

          // データベースから画像レコードを削除
          this.db.run('DELETE FROM blog_images WHERE post_id = ?', [postId], (err) => {
            if (err) {
              console.error('画像レコード削除エラー:', err);
              reject(err);
              return;
            }

            console.log('✓ データベースから画像レコードを削除');

            // ブログ投稿を削除
            this.db.run('DELETE FROM blog_posts WHERE id = ?', [postId], function(err) {
              if (err) {
                console.error('ブログ投稿削除エラー:', err);
                reject(err);
              } else {
                console.log(`✓ ブログ投稿を削除 (変更行数: ${this.changes})`);
                console.log('=== ブログ削除完了 ===\n');
                resolve(this.changes);
              }
            });
          });
        });
      });
    });
  }

  /**
   * データベース接続をクローズ
   */
  close() {
    this.db.close();
  }
}

module.exports = BlogDatabase;

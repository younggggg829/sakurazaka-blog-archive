const sqlite3 = require('sqlite3').verbose();
const path = require('path');

class BlogDatabase {
  constructor() {
    const dbPath = path.join(__dirname, 'sakurazaka_blog.db');
    this.db = new sqlite3.Database(dbPath);
    this.initDatabase();
  }

  initDatabase() {
    this.db.serialize(() => {
      this.db.run(`
        CREATE TABLE IF NOT EXISTS members (
          id INTEGER PRIMARY KEY,
          name TEXT NOT NULL,
          blog_url TEXT
        )
      `);

      this.db.run(`
        CREATE TABLE IF NOT EXISTS blog_posts (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          member_id INTEGER,
          member_name TEXT,
          url TEXT UNIQUE,
          title TEXT,
          date TEXT,
          content TEXT,
          created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
          FOREIGN KEY (member_id) REFERENCES members (id)
        )
      `);

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

  saveMember(member) {
    return new Promise((resolve, reject) => {
      const stmt = this.db.prepare(
        'INSERT OR REPLACE INTO members (id, name, blog_url) VALUES (?, ?, ?)'
      );
      stmt.run(member.id, member.name, member.blogUrl, (err) => {
        if (err) reject(err);
        else resolve();
      });
      stmt.finalize();
    });
  }

  saveMembers(members) {
    return Promise.all(members.map(member => this.saveMember(member)));
  }

  getMembers() {
    return new Promise((resolve, reject) => {
      this.db.all('SELECT * FROM members ORDER BY name', (err, rows) => {
        if (err) reject(err);
        else resolve(rows);
      });
    });
  }

  saveBlogPost(post) {
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

  saveBlogPosts(posts) {
    return Promise.all(posts.map(post => this.saveBlogPost(post)));
  }

  getBlogPosts(memberId = null, limit = 10) {
    return new Promise((resolve, reject) => {
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
      // limitはwebServer.jsで制御

      this.db.all(query, params, (err, rows) => {
        if (err) {
          reject(err);
        } else {
          const posts = rows.map(row => ({
            ...row,
            images: row.images ? row.images.split(',') : [],
            local_images: row.local_images ? row.local_images.split(',').filter(p => p) : []
          }));
          resolve(posts);
        }
      });
    });
  }

  searchBlogPosts(keyword) {
    return new Promise((resolve, reject) => {
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

      this.db.all(query, [searchTerm, searchTerm], (err, rows) => {
        if (err) {
          reject(err);
        } else {
          const posts = rows.map(row => ({
            ...row,
            images: row.images ? row.images.split(',') : [],
            local_images: row.local_images ? row.local_images.split(',').filter(p => p) : []
          }));
          resolve(posts);
        }
      });
    });
  }

  getAllBlogPosts() {
    return new Promise((resolve, reject) => {
      const query = `
        SELECT bp.*,
               GROUP_CONCAT(bi.image_url) as images,
               GROUP_CONCAT(bi.local_path) as local_images
        FROM blog_posts bp
        LEFT JOIN blog_images bi ON bp.id = bi.post_id
        GROUP BY bp.id
        ORDER BY bp.date DESC
      `;

      this.db.all(query, (err, rows) => {
        if (err) {
          reject(err);
        } else {
          const posts = rows.map(row => ({
            ...row,
            images: row.images ? row.images.split(',') : [],
            local_images: row.local_images ? row.local_images.split(',').filter(p => p) : []
          }));
          resolve(posts);
        }
      });
    });
  }

  getBlogImages(postId) {
    return new Promise((resolve, reject) => {
      this.db.all(
        'SELECT * FROM blog_images WHERE post_id = ?',
        [postId],
        (err, rows) => {
          if (err) reject(err);
          else resolve(rows);
        }
      );
    });
  }

  updateBlogPostImages(postUrl, localImagePaths) {
    return new Promise((resolve, reject) => {
      // 最初にpost_idを取得
      this.db.get(
        'SELECT id FROM blog_posts WHERE url = ?',
        [postUrl],
        (err, row) => {
          if (err) {
            reject(err);
            return;
          }

          if (!row) {
            reject(new Error('Post not found'));
            return;
          }

          const postId = row.id;

          // 既存の画像レコードを取得
          this.db.all(
            'SELECT * FROM blog_images WHERE post_id = ? ORDER BY id',
            [postId],
            (err, imageRows) => {
              if (err) {
                reject(err);
                return;
              }

              // ローカルパスを更新
              const updatePromises = imageRows.map((imageRow, index) => {
                return new Promise((resolveUpdate, rejectUpdate) => {
                  const localPath = localImagePaths[index] || null;
                  this.db.run(
                    'UPDATE blog_images SET local_path = ? WHERE id = ?',
                    [localPath, imageRow.id],
                    (updateErr) => {
                      if (updateErr) rejectUpdate(updateErr);
                      else resolveUpdate();
                    }
                  );
                });
              });

              Promise.all(updatePromises)
                .then(() => resolve())
                .catch(reject);
            }
          );
        }
      );
    });
  }

  // 単一投稿取得（画像込み）
  getBlogPost(postId) {
    return new Promise((resolve, reject) => {
      const query = `
        SELECT bp.*,
               GROUP_CONCAT(bi.image_url) as images,
               GROUP_CONCAT(bi.local_path) as local_images
        FROM blog_posts bp
        LEFT JOIN blog_images bi ON bp.id = bi.post_id
        WHERE bp.id = ?
        GROUP BY bp.id
      `;

      this.db.get(query, [postId], (err, row) => {
        if (err) {
          reject(err);
        } else if (row) {
          const post = {
            ...row,
            images: row.images ? row.images.split(',') : [],
            local_images: row.local_images ? row.local_images.split(',').filter(p => p) : []
          };
          resolve(post);
        } else {
          resolve(null);
        }
      });
    });
  }

  deleteBlogPost(postId) {
    return new Promise((resolve, reject) => {
      this.db.serialize(() => {
        // 先に関連画像を削除
        this.db.run('DELETE FROM blog_images WHERE post_id = ?', [postId], (err) => {
          if (err) {
            reject(err);
            return;
          }

          // 次にブログ投稿を削除
          this.db.run('DELETE FROM blog_posts WHERE id = ?', [postId], function(err) {
            if (err) {
              reject(err);
            } else {
              resolve(this.changes);
            }
          });
        });
      });
    });
  }

  close() {
    this.db.close();
  }
}

module.exports = BlogDatabase;
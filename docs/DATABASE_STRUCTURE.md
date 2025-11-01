# 💾 データベース構造（SQLite）

**データベースファイル**: `sakurazaka_blog.db`

## 📋 テーブル構成

1. **members**（櫻坂 46 現役メンバー情報）

   ```sql
   - id: メンバーID (例: 47)
   - name: メンバー名 (例: 森田ひかる)
   - blog_url: 櫻坂46 公式ブログURL
   ```

2. **blog_posts**（ブログ記事）

   ```sql
   - id: 記事ID（自動採番）
   - member_id: メンバーID (外部キー)
   - member_name: メンバー名
   - url: 元ブログURL (一意)
   - title: 記事タイトル
   - date: 投稿日
   - content: 記事本文
   - site: サイト識別子 ('sakurazaka46' または 'keyakizaka46')
   - created_at: 保存日時
   ```

3. **blog_images**（記事画像）
   ```sql
   - id: 画像ID（自動採番）
   - post_id: 記事ID (外部キー)
   - image_url: 元画像URL
   - local_path: ローカル保存パス
   ```

## 画像保存構造

```
images/
├── 森田ひかる_sakurazaka46/
├── 森田ひかる_keyakizaka46/
├── 小田倉麗奈_sakurazaka46/
├── 村山美羽_sakurazaka46/
└── ...
```

- フォルダ名: `{メンバー名}_{サイト識別子}`
- ファイル名: `post_{投稿ID}_{ハッシュ}.jpg`
- サイト識別子: `sakurazaka46` または `keyakizaka46`

## 💾 データベース関連エラー

**🚨 「データベースエラー」が表示された場合：**

1. **安全な方法（推奨）**:

   ```bash
   # バックアップを作成
   cp sakurazaka_blog.db sakurazaka_blog_backup.db

   # 問題のあるDBを削除
   rm sakurazaka_blog.db

   # プログラム再起動（自動でDB再作成）
   npm start
   ```

2. **ファイルシステム を使用**:
   - `~/sakurazaka-blog-archive/`フォルダを開く
   - `sakurazaka_blog.db`を右クリック → ゴミ箱に入れる

**❓ データベースリセットの影響:**

- ✅ **保持されるもの**: 画像ファイル、プログラム機能
- ❌ **失われるもの**: 記事データ（再スクレイピングが必要）
- 📦 **バックアップ**: 削除前にバックアップファイル作成

#### 🗑️ 削除機能について

**選択した投稿を削除ボタンをクリックした場合：**

- ✅ データベースから記事情報を完全削除
- ✅ 画像のデータベースレコードも削除
- ✅ ローカル画像ファイル（`images/`フォルダ内）も削除

#### 🔍 データベース内容の確認

**SQLite でデータベースの中身を確認：**

```bash
# 記事数確認
sqlite3 sakurazaka_blog.db "SELECT COUNT(*) FROM blog_posts;"

# メンバー一覧
sqlite3 sakurazaka_blog.db "SELECT * FROM members;"

# 特定メンバーの記事数
sqlite3 sakurazaka_blog.db "SELECT member_name, COUNT(*) FROM blog_posts GROUP BY member_id;"
```

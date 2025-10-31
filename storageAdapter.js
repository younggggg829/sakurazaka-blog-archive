const fs = require('fs');
const path = require('path');

/**
 * Storage Adapter - 抽象基底クラス
 * ローカルストレージとS3などのクラウドストレージを統一的に扱う
 */
class StorageAdapter {
  /**
   * ファイルを保存
   * @param {Buffer|Stream} data - 保存するデータ
   * @param {string} relativePath - 相対パス（例: "images/member_47/post_123.jpg"）
   * @returns {Promise<string>} 保存されたファイルの相対パス
   */
  async save(data, relativePath) {
    throw new Error('save() must be implemented');
  }

  /**
   * ファイルが存在するかチェック
   * @param {string} relativePath - 相対パス
   * @returns {Promise<boolean>}
   */
  async exists(relativePath) {
    throw new Error('exists() must be implemented');
  }

  /**
   * ファイルのURLを取得
   * @param {string} relativePath - 相対パス
   * @returns {string} アクセス可能なURL
   */
  getUrl(relativePath) {
    throw new Error('getUrl() must be implemented');
  }

  /**
   * ファイルを削除
   * @param {string} relativePath - 相対パス
   * @returns {Promise<boolean>}
   */
  async delete(relativePath) {
    throw new Error('delete() must be implemented');
  }

  /**
   * 絶対パスから相対パスに変換
   * @param {string} absolutePath - 絶対パス
   * @param {string} baseDir - ベースディレクトリ
   * @returns {string} 相対パス
   */
  static toRelativePath(absolutePath, baseDir) {
    if (!absolutePath) return null;
    if (!path.isAbsolute(absolutePath)) return absolutePath;
    return path.relative(baseDir, absolutePath);
  }

  /**
   * 相対パスから絶対パスに変換
   * @param {string} relativePath - 相対パス
   * @param {string} baseDir - ベースディレクトリ
   * @returns {string} 絶対パス
   */
  static toAbsolutePath(relativePath, baseDir) {
    if (!relativePath) return null;
    if (path.isAbsolute(relativePath)) return relativePath;
    return path.join(baseDir, relativePath);
  }
}

/**
 * LocalStorage Adapter
 * ローカルファイルシステムを使用
 */
class LocalStorageAdapter extends StorageAdapter {
  constructor(baseDir) {
    super();
    this.baseDir = baseDir;

    // ベースディレクトリが存在しない場合は作成
    if (!fs.existsSync(this.baseDir)) {
      fs.mkdirSync(this.baseDir, { recursive: true });
    }
  }

  /**
   * ファイルを保存
   * @param {Buffer|Stream} data - 保存するデータ
   * @param {string} relativePath - 相対パス
   * @returns {Promise<string>} 保存されたファイルの相対パス
   */
  async save(data, relativePath) {
    const absolutePath = path.join(this.baseDir, relativePath);
    const dir = path.dirname(absolutePath);

    // ディレクトリが存在しない場合は作成
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }

    // Bufferの場合
    if (Buffer.isBuffer(data)) {
      await fs.promises.writeFile(absolutePath, data);
      return relativePath;
    }

    // Streamの場合
    if (data.pipe) {
      return new Promise((resolve, reject) => {
        const writeStream = fs.createWriteStream(absolutePath);
        data.pipe(writeStream);
        writeStream.on('finish', () => resolve(relativePath));
        writeStream.on('error', reject);
      });
    }

    throw new Error('Unsupported data type');
  }

  /**
   * ファイルが存在するかチェック
   * @param {string} relativePath - 相対パス
   * @returns {Promise<boolean>}
   */
  async exists(relativePath) {
    const absolutePath = path.join(this.baseDir, relativePath);
    return fs.existsSync(absolutePath);
  }

  /**
   * ファイルのURLを取得
   * Expressの静的ファイル提供を前提とする（例: /images/...）
   * @param {string} relativePath - 相対パス
   * @returns {string} URL
   */
  getUrl(relativePath) {
    // 相対パスをURLパスに変換（Windowsパスの場合も考慮）
    const urlPath = relativePath.split(path.sep).join('/');
    return `/${urlPath}`;
  }

  /**
   * ファイルを削除
   * @param {string} relativePath - 相対パス
   * @returns {Promise<boolean>}
   */
  async delete(relativePath) {
    try {
      const absolutePath = path.join(this.baseDir, relativePath);
      if (fs.existsSync(absolutePath)) {
        await fs.promises.unlink(absolutePath);
        return true;
      }
      return false;
    } catch (error) {
      console.error('Delete error:', error);
      return false;
    }
  }

  /**
   * 絶対パスを取得
   * @param {string} relativePath - 相対パス
   * @returns {string} 絶対パス
   */
  getAbsolutePath(relativePath) {
    return path.join(this.baseDir, relativePath);
  }
}

/**
 * S3Storage Adapter
 * AWS S3を使用（将来実装用）
 */
class S3StorageAdapter extends StorageAdapter {
  constructor(config) {
    super();
    this.bucket = config.bucket;
    this.region = config.region;
    this.baseUrl = config.baseUrl || `https://${this.bucket}.s3.${this.region}.amazonaws.com`;

    // AWS SDKは必要になったときに require する
    // this.s3 = new AWS.S3({ region: this.region });
  }

  async save(data, relativePath) {
    throw new Error('S3StorageAdapter is not yet implemented. Install @aws-sdk/client-s3 first.');
    // 実装例:
    // const params = {
    //   Bucket: this.bucket,
    //   Key: relativePath,
    //   Body: data,
    //   ContentType: this.getContentType(relativePath)
    // };
    // await this.s3.putObject(params).promise();
    // return relativePath;
  }

  async exists(relativePath) {
    throw new Error('S3StorageAdapter is not yet implemented');
    // 実装例:
    // try {
    //   await this.s3.headObject({ Bucket: this.bucket, Key: relativePath }).promise();
    //   return true;
    // } catch (error) {
    //   return false;
    // }
  }

  getUrl(relativePath) {
    // S3の場合は完全なURLを返す
    return `${this.baseUrl}/${relativePath}`;
  }

  async delete(relativePath) {
    throw new Error('S3StorageAdapter is not yet implemented');
    // 実装例:
    // await this.s3.deleteObject({ Bucket: this.bucket, Key: relativePath }).promise();
    // return true;
  }

  getContentType(filename) {
    const ext = path.extname(filename).toLowerCase();
    const types = {
      '.jpg': 'image/jpeg',
      '.jpeg': 'image/jpeg',
      '.png': 'image/png',
      '.gif': 'image/gif',
      '.webp': 'image/webp'
    };
    return types[ext] || 'application/octet-stream';
  }
}

/**
 * Storage Adapter Factory
 * 設定に基づいて適切なアダプターを生成
 */
class StorageAdapterFactory {
  /**
   * アダプターを生成
   * @param {Object} config - 設定オブジェクト
   * @param {string} config.type - 'local' または 's3'
   * @param {string} config.baseDir - ローカルストレージの場合のベースディレクトリ
   * @param {string} config.bucket - S3の場合のバケット名
   * @param {string} config.region - S3の場合のリージョン
   * @returns {StorageAdapter}
   */
  static create(config) {
    const type = config.type || 'local';

    switch (type) {
      case 'local':
        return new LocalStorageAdapter(config.baseDir);

      case 's3':
        return new S3StorageAdapter({
          bucket: config.bucket,
          region: config.region,
          baseUrl: config.baseUrl
        });

      default:
        throw new Error(`Unknown storage type: ${type}`);
    }
  }
}

module.exports = {
  StorageAdapter,
  LocalStorageAdapter,
  S3StorageAdapter,
  StorageAdapterFactory
};

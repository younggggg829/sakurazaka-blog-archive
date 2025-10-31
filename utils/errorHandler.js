/**
 * エラーハンドリングユーティリティ
 * 統一されたエラー処理とロギング
 */

/**
 * エラーメッセージをフォーマット
 * @param {Error} error - エラーオブジェクト
 * @param {string} context - エラーが発生したコンテキスト
 * @returns {string} フォーマットされたエラーメッセージ
 */
function formatErrorMessage(error, context = '') {
  const timestamp = new Date().toISOString();
  const contextStr = context ? `[${context}] ` : '';

  return `${timestamp} ${contextStr}${error.name}: ${error.message}`;
}

/**
 * エラーをログに記録
 * @param {Error} error - エラーオブジェクト
 * @param {string} context - エラーが発生したコンテキスト
 */
function logError(error, context = '') {
  console.error(formatErrorMessage(error, context));

  if (error.stack) {
    console.error('Stack trace:', error.stack);
  }
}

/**
 * エラーを安全にラップして再スロー
 * @param {Error} error - 元のエラー
 * @param {string} message - カスタムエラーメッセージ
 * @throws {Error} ラップされたエラー
 */
function wrapError(error, message) {
  const wrappedError = new Error(`${message}: ${error.message}`);
  wrappedError.originalError = error;
  wrappedError.stack = error.stack;
  return wrappedError;
}

/**
 * 非同期関数のエラーをキャッチするラッパー
 * @param {Function} fn - 非同期関数
 * @returns {Function} エラーハンドリング付きの関数
 */
function asyncErrorHandler(fn) {
  return async (...args) => {
    try {
      return await fn(...args);
    } catch (error) {
      logError(error, fn.name || 'Anonymous Function');
      throw error;
    }
  };
}

/**
 * Express用のエラーハンドリングミドルウェア
 * @param {Error} err - エラーオブジェクト
 * @param {object} req - Expressリクエストオブジェクト
 * @param {object} res - Expressレスポンスオブジェクト
 * @param {Function} next - 次のミドルウェア
 */
function expressErrorHandler(err, req, res, next) {
  logError(err, `Express Error - ${req.method} ${req.path}`);

  const statusCode = err.statusCode || 500;
  const message = err.message || 'Internal Server Error';

  res.status(statusCode).json({
    success: false,
    error: {
      message: message,
      ...(process.env.NODE_ENV === 'development' && { stack: err.stack })
    }
  });
}

/**
 * データベースエラーをハンドリング
 * @param {Error} error - データベースエラー
 * @param {string} operation - 実行していた操作
 * @returns {Error} ハンドリングされたエラー
 */
function handleDatabaseError(error, operation = '') {
  const context = `Database Error${operation ? ` - ${operation}` : ''}`;
  logError(error, context);

  // SQLiteの特定のエラーコードをチェック
  if (error.code === 'SQLITE_CONSTRAINT') {
    return new Error('データの整合性エラーが発生しました');
  } else if (error.code === 'SQLITE_BUSY') {
    return new Error('データベースがビジーです。しばらく待ってから再試行してください');
  }

  return new Error('データベース操作中にエラーが発生しました');
}

/**
 * ネットワークエラーをハンドリング
 * @param {Error} error - ネットワークエラー
 * @param {string} url - アクセスしていたURL
 * @returns {Error} ハンドリングされたエラー
 */
function handleNetworkError(error, url = '') {
  const context = `Network Error${url ? ` - ${url}` : ''}`;
  logError(error, context);

  if (error.code === 'ETIMEDOUT' || error.code === 'ESOCKETTIMEDOUT') {
    return new Error('接続がタイムアウトしました');
  } else if (error.code === 'ECONNREFUSED') {
    return new Error('接続が拒否されました');
  } else if (error.code === 'ENOTFOUND') {
    return new Error('ホストが見つかりません');
  }

  return new Error('ネットワークエラーが発生しました');
}

/**
 * ファイルシステムエラーをハンドリング
 * @param {Error} error - ファイルシステムエラー
 * @param {string} filePath - 操作していたファイルパス
 * @returns {Error} ハンドリングされたエラー
 */
function handleFileSystemError(error, filePath = '') {
  const context = `File System Error${filePath ? ` - ${filePath}` : ''}`;
  logError(error, context);

  if (error.code === 'ENOENT') {
    return new Error('ファイルまたはディレクトリが見つかりません');
  } else if (error.code === 'EACCES' || error.code === 'EPERM') {
    return new Error('ファイルへのアクセスが拒否されました');
  } else if (error.code === 'ENOSPC') {
    return new Error('ディスク容量が不足しています');
  }

  return new Error('ファイル操作中にエラーが発生しました');
}

module.exports = {
  formatErrorMessage,
  logError,
  wrapError,
  asyncErrorHandler,
  expressErrorHandler,
  handleDatabaseError,
  handleNetworkError,
  handleFileSystemError,
};

/**
 * ギガファイル便ダウンロードサービス
 * URLからHTMLを取得→JS変数からDLサーバー/ファイルキー抽出→セッションcookie取得→動画ダウンロード
 *
 * DLフロー（download.jsを解析して判明）:
 * 1. 個別ファイルページにGETアクセス → gfsidセッションcookieを取得
 * 2. GET /download.php?file={fileKey} にcookie付きでリクエスト
 * 3. Content-Type: video/mp4 でバイナリが返る
 */
import { Injectable, Logger } from '@nestjs/common';
import axios from 'axios';

interface GigafileInfo {
  server: string;     // メインサーバー（DL用）: e.g. "116.gigafile.nu"
  dlServer: string;   // AJAXサーバー: e.g. "116x.gigafile.nu"
  fileKey: string;
  files: { file: string; size: number }[];
  isMultiFile: boolean;
}

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36';

@Injectable()
export class GigafileService {
  private readonly logger = new Logger(GigafileService.name);

  /**
   * ギガファイル便URLからファイル名を取得（プレビュー用）
   */
  async getFilename(gigafileUrl: string): Promise<string> {
    const html = await this.fetchPage(gigafileUrl);
    return this.extractFilename(html);
  }

  /**
   * ギガファイル便URLから動画をダウンロード（1ファイル）
   */
  async downloadVideo(gigafileUrl: string): Promise<{ buffer: Buffer; filename: string }> {
    this.logger.log(`ギガファイル便からダウンロード開始: ${gigafileUrl}`);

    const html = await this.fetchPage(gigafileUrl);
    const info = this.parsePageInfo(html);
    const filename = this.extractFilename(html);

    if (info) {
      const targetFileKey = info.isMultiFile ? info.files[0].file : info.fileKey;
      this.logger.log(`DL対象: server=${info.server}, file=${targetFileKey}${info.isMultiFile ? ` (${info.files.length}ファイル中の1番目)` : ''}`);
      return this.downloadFileWithSession(info.server, targetFileKey);
    }

    // フォールバック: 旧方式
    const downloadUrl = this.extractDownloadUrlFromHtml(html, gigafileUrl);
    this.logger.log(`フォールバックDL: ${downloadUrl}`);
    const buffer = await this.downloadFromUrl(downloadUrl);
    return { buffer, filename };
  }

  /**
   * ギガファイル便URLから全動画をダウンロード（複数ファイル対応）
   */
  async downloadAllVideos(gigafileUrl: string): Promise<{ buffer: Buffer; filename: string }[]> {
    this.logger.log(`ギガファイル便から全ファイルダウンロード開始: ${gigafileUrl}`);

    const html = await this.fetchPage(gigafileUrl);
    const info = this.parsePageInfo(html);

    if (!info || !info.isMultiFile) {
      const result = await this.downloadVideo(gigafileUrl);
      return [result];
    }

    const results: { buffer: Buffer; filename: string }[] = [];
    for (let i = 0; i < info.files.length; i++) {
      const fileEntry = info.files[i];
      this.logger.log(`[${i + 1}/${info.files.length}] DL中: ${fileEntry.file} (${(fileEntry.size / 1024 / 1024).toFixed(1)}MB)`);
      const result = await this.downloadFileWithSession(info.server, fileEntry.file);
      results.push(result);
    }

    this.logger.log(`全ファイルダウンロード完了: ${results.length}件`);
    return results;
  }

  /**
   * ギガファイル便URLのファイル一覧を取得（DLはしない、メタ情報のみ）
   */
  async getFileList(gigafileUrl: string): Promise<{ server: string; files: { file: string; size: number }[] } | null> {
    const html = await this.fetchPage(gigafileUrl);
    const info = this.parsePageInfo(html);
    if (!info) return null;
    if (info.isMultiFile) {
      return { server: info.server, files: info.files };
    }
    return { server: info.server, files: [{ file: info.fileKey, size: 0 }] };
  }

  /**
   * 個別ファイルキーから1本だけDL
   */
  async downloadSingleFile(server: string, fileKey: string): Promise<{ buffer: Buffer; filename: string }> {
    return this.downloadFileWithSession(server, fileKey);
  }

  /**
   * セッションcookieを取得してからDL（ギガファイル便の正規フロー）
   * 1. 個別ファイルページにGET → gfsid cookieを取得
   * 2. download.php?file=xxx にcookie付きGET → バイナリ取得
   */
  private async downloadFileWithSession(server: string, fileKey: string): Promise<{ buffer: Buffer; filename: string }> {
    // Step 1: 個別ファイルページにアクセスしてセッションcookieを取得
    const filePageUrl = `https://${server}/${fileKey}`;
    this.logger.log(`セッション取得: ${filePageUrl}`);
    const pageResp = await axios.get(filePageUrl, {
      timeout: 30000,
      headers: { 'User-Agent': UA },
    });
    const setCookies: string[] = pageResp.headers['set-cookie'] || [];
    const cookieStr = setCookies.map(c => c.split(';')[0]).join('; ');

    // Step 2: prog_keyを追加してDL実行
    const progKey = Math.random().toString(36).substring(2, 10);
    const allCookies = cookieStr ? `${cookieStr}; prog_key=${progKey}` : `prog_key=${progKey}`;
    const downloadUrl = `https://${server}/download.php?file=${fileKey}`;

    this.logger.log(`DL実行: ${downloadUrl}`);
    const response = await axios.get(downloadUrl, {
      responseType: 'arraybuffer',
      timeout: 600000, // 10分
      maxContentLength: Infinity,
      maxBodyLength: Infinity,
      headers: {
        'User-Agent': UA,
        'Cookie': allCookies,
        'Referer': filePageUrl,
      },
    });

    const buffer = Buffer.from(response.data);

    // DLバリデーション
    if (buffer.length < 10000) {
      const preview = buffer.toString('utf-8', 0, Math.min(500, buffer.length));
      if (preview.includes('<html') || preview.includes('<!DOCTYPE')) {
        throw new Error(`ギガファイル便: 動画ではなくHTMLがダウンロードされました（${buffer.length}bytes）。セッション取得に失敗した可能性があります。`);
      }
    }

    // Content-Dispositionからファイル名を抽出
    const disposition = response.headers['content-disposition'] || '';
    let filename = `video_${Date.now()}.mp4`;
    // filename*=UTF-8''xxx 形式
    const utf8Match = disposition.match(/filename\*=UTF-8''([^;\s]+)/i);
    if (utf8Match) {
      filename = decodeURIComponent(utf8Match[1]);
    } else {
      // filename="xxx" 形式
      const basicMatch = disposition.match(/filename="?([^";\s]+)"?/i);
      if (basicMatch) filename = basicMatch[1];
    }

    this.logger.log(`DL完了: ${filename} (${(buffer.length / 1024 / 1024).toFixed(2)}MB)`);
    return { buffer, filename };
  }

  private async fetchPage(url: string): Promise<string> {
    const response = await axios.get(url, {
      timeout: 30000,
      headers: { 'User-Agent': UA },
    });
    return response.data;
  }

  private async downloadFromUrl(url: string): Promise<Buffer> {
    const response = await axios.get(url, {
      responseType: 'arraybuffer',
      timeout: 600000,
      maxContentLength: Infinity,
      maxBodyLength: Infinity,
      headers: { 'User-Agent': UA },
    });
    return Buffer.from(response.data);
  }

  /**
   * ページHTMLからJS変数を解析してDL情報を抽出
   */
  private parsePageInfo(html: string): GigafileInfo | null {
    // server変数を抽出（DL用メインサーバー: e.g. "116.gigafile.nu"）
    const serverMatch = html.match(/var\s+server\s*=\s*"([^"]+)"/);
    if (!serverMatch) return null;
    const server = serverMatch[1];

    // dl_ajax_server を抽出（プログレス用: e.g. "116x.gigafile.nu"）
    const dlServerMatch = html.match(/var\s+dl_ajax_server\s*=\s*"([^"]+)"/);
    const dlServer = dlServerMatch ? dlServerMatch[1] : server;

    // file キーを抽出
    const fileKeyMatch = html.match(/var\s+file\s*=\s*"([^"]+)"/);
    const fileKey = fileKeyMatch ? fileKeyMatch[1] : '';

    // files 配列を抽出（複数ファイルの場合）
    const filesMatch = html.match(/var\s+files\s*=\s*(\[[\s\S]*?\]);/);
    let files: { file: string; size: number }[] = [];
    if (filesMatch) {
      try {
        files = JSON.parse(filesMatch[1]);
      } catch {
        // パース失敗
      }
    }

    return { server, dlServer, fileKey, files, isMultiFile: files.length > 0 };
  }

  /**
   * フォールバック: HTMLからダウンロードURLを直接抽出
   */
  private extractDownloadUrlFromHtml(html: string, originalUrl: string): string {
    const downloadBtnMatch = html.match(/id="download_btn"[^>]*(?:href|onclick)[^"]*"([^"]+)"/);
    if (downloadBtnMatch) return downloadBtnMatch[1];

    const dlLinkMatch = html.match(/(https?:\/\/dl\d*\.gigafile\.nu\/[^\s"'<>]+)/);
    if (dlLinkMatch) return dlLinkMatch[1];

    const fileKeyMatch = html.match(/name="file"\s+value="([^"]+)"/);
    if (fileKeyMatch) {
      const baseUrl = originalUrl.replace(/\/[^/]*$/, '');
      return `${baseUrl}/download.php?file=${fileKeyMatch[1]}`;
    }

    const keyMatch = html.match(/name="download_key"\s+value="([^"]+)"/);
    if (keyMatch) return `https://gigafile.nu/download.php?download_key=${keyMatch[1]}`;

    throw new Error('ギガファイル便: ダウンロードURLが見つかりません。URLを確認してください。');
  }

  /**
   * HTMLからファイル名を抽出
   */
  private extractFilename(html: string): string {
    const nameMatch = html.match(/class="file_name"[^>]*>([^<]+)</);
    if (nameMatch) return nameMatch[1].trim();

    const originalMatch = html.match(/name="original_name"\s+value="([^"]+)"/);
    if (originalMatch) return originalMatch[1];

    const titleMatch = html.match(/<title>([^<]+)</);
    if (titleMatch) {
      const title = titleMatch[1].replace(/\s*-\s*ギガファイル便.*$/, '').trim();
      if (title && title !== 'ギガファイル便') return title;
    }

    return `video_${Date.now()}.mp4`;
  }
}

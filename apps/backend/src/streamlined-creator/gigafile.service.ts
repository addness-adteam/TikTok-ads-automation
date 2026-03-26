/**
 * ギガファイル便ダウンロードサービス
 * URLからHTMLを取得→JS変数からDLサーバー/ファイルキー抽出→動画ダウンロード
 */
import { Injectable, Logger } from '@nestjs/common';
import axios from 'axios';

interface GigafileInfo {
  dlServer: string;
  fileKey: string;
  files: { file: string; size: number }[];
  isMultiFile: boolean;
}

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
   * ギガファイル便URLから動画をダウンロード
   * @returns Buffer
   */
  async downloadVideo(gigafileUrl: string): Promise<{ buffer: Buffer; filename: string }> {
    this.logger.log(`ギガファイル便からダウンロード開始: ${gigafileUrl}`);

    // 1. ページHTMLを取得
    const html = await this.fetchPage(gigafileUrl);

    // 2. ページ情報を解析
    const info = this.parsePageInfo(html, gigafileUrl);
    const filename = this.extractFilename(html);

    // 3. ダウンロードURL構築＆実行
    let downloadUrl: string;

    if (info) {
      // JS変数からDLサーバーとファイルキーが取れた場合（AJAX方式）
      const targetFileKey = info.isMultiFile ? info.files[0].file : info.fileKey;
      downloadUrl = `https://${info.dlServer}/download.php?file=${targetFileKey}`;
      this.logger.log(`AJAX方式DL: server=${info.dlServer}, file=${targetFileKey}${info.isMultiFile ? ` (${info.files.length}ファイル中の1番目)` : ''}`);
    } else {
      // フォールバック: HTML内のリンクパターンマッチ
      downloadUrl = this.extractDownloadUrlFromHtml(html, gigafileUrl);
      this.logger.log(`HTMLパターンマッチDL: ${downloadUrl}`);
    }

    const buffer = await this.downloadFromUrl(downloadUrl);
    this.logger.log(`ダウンロード完了: ${filename} (${(buffer.length / 1024 / 1024).toFixed(2)}MB)`);

    return { buffer, filename };
  }

  /**
   * ギガファイル便URLから全動画をダウンロード（複数ファイル対応）
   */
  async downloadAllVideos(gigafileUrl: string): Promise<{ buffer: Buffer; filename: string }[]> {
    this.logger.log(`ギガファイル便から全ファイルダウンロード開始: ${gigafileUrl}`);

    const html = await this.fetchPage(gigafileUrl);
    const info = this.parsePageInfo(html, gigafileUrl);

    if (!info || !info.isMultiFile) {
      // 単一ファイルの場合は既存メソッドにフォールバック
      const result = await this.downloadVideo(gigafileUrl);
      return [result];
    }

    const results: { buffer: Buffer; filename: string }[] = [];
    for (let i = 0; i < info.files.length; i++) {
      const fileEntry = info.files[i];
      const downloadUrl = `https://${info.dlServer}/download.php?file=${fileEntry.file}`;
      this.logger.log(`[${i + 1}/${info.files.length}] DL中: ${fileEntry.file} (${(fileEntry.size / 1024 / 1024).toFixed(1)}MB)`);

      const buffer = await this.downloadFromUrl(downloadUrl);
      const filename = `video_${i + 1}_${Date.now()}.mp4`;
      results.push({ buffer, filename });
    }

    this.logger.log(`全ファイルダウンロード完了: ${results.length}件`);
    return results;
  }

  private async fetchPage(url: string): Promise<string> {
    const response = await axios.get(url, {
      timeout: 30000,
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
      },
    });
    return response.data;
  }

  private async downloadFromUrl(url: string): Promise<Buffer> {
    const response = await axios.get(url, {
      responseType: 'arraybuffer',
      timeout: 600000, // 10分
      maxContentLength: Infinity,
      maxBodyLength: Infinity,
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
      },
    });
    return Buffer.from(response.data);
  }

  /**
   * ページHTMLからJS変数を解析してDL情報を抽出
   */
  private parsePageInfo(html: string, originalUrl: string): GigafileInfo | null {
    // dl_ajax_server を抽出（例: "116x.gigafile.nu"）
    const serverMatch = html.match(/var\s+dl_ajax_server\s*=\s*"([^"]+)"/);
    if (!serverMatch) return null;
    const dlServer = serverMatch[1];

    // file キーを抽出（例: "0704-977320b952f1abdd35663425bb129433"）
    const fileKeyMatch = html.match(/var\s+file\s*=\s*"([^"]+)"/);
    const fileKey = fileKeyMatch ? fileKeyMatch[1] : '';

    // files 配列を抽出（複数ファイルの場合）
    const filesMatch = html.match(/var\s+files\s*=\s*(\[[\s\S]*?\]);/);
    let files: { file: string; size: number }[] = [];
    if (filesMatch) {
      try {
        files = JSON.parse(filesMatch[1]);
      } catch {
        // パース失敗時は空配列のまま
      }
    }

    const isMultiFile = files.length > 0;

    return { dlServer, fileKey, files, isMultiFile };
  }

  /**
   * フォールバック: HTMLからダウンロードURLを直接抽出
   */
  private extractDownloadUrlFromHtml(html: string, originalUrl: string): string {
    // パターン1: download_btn のonclickやhref
    const downloadBtnMatch = html.match(/id="download_btn"[^>]*(?:href|onclick)[^"]*"([^"]+)"/);
    if (downloadBtnMatch) {
      return downloadBtnMatch[1];
    }

    // パターン2: dl.gigafile.nu リンク
    const dlLinkMatch = html.match(/(https?:\/\/dl\d*\.gigafile\.nu\/[^\s"'<>]+)/);
    if (dlLinkMatch) {
      return dlLinkMatch[1];
    }

    // パターン3: POSTでダウンロードする場合のfile keyを抽出
    const fileKeyMatch = html.match(/name="file"\s+value="([^"]+)"/);
    if (fileKeyMatch) {
      const baseUrl = originalUrl.replace(/\/[^/]*$/, '');
      return `${baseUrl}/download.php?file=${fileKeyMatch[1]}`;
    }

    // パターン4: hidden inputのdownload_key
    const keyMatch = html.match(/name="download_key"\s+value="([^"]+)"/);
    if (keyMatch) {
      return `https://gigafile.nu/download.php?download_key=${keyMatch[1]}`;
    }

    throw new Error('ギガファイル便: ダウンロードURLが見つかりません。URLを確認してください。');
  }

  /**
   * HTMLからファイル名を抽出
   */
  private extractFilename(html: string): string {
    // パターン1: file_info内のファイル名
    const nameMatch = html.match(/class="file_name"[^>]*>([^<]+)</);
    if (nameMatch) {
      return nameMatch[1].trim();
    }

    // パターン2: original_name
    const originalMatch = html.match(/name="original_name"\s+value="([^"]+)"/);
    if (originalMatch) {
      return originalMatch[1];
    }

    // パターン3: titleタグ
    const titleMatch = html.match(/<title>([^<]+)</);
    if (titleMatch) {
      const title = titleMatch[1].replace(/\s*-\s*ギガファイル便.*$/, '').trim();
      if (title && title !== 'ギガファイル便') return title;
    }

    return `video_${Date.now()}.mp4`;
  }
}

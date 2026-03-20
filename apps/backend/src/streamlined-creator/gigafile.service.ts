/**
 * ギガファイル便ダウンロードサービス
 * URLからHTMLを取得→DLリンク抽出→動画ダウンロード
 */
import { Injectable, Logger } from '@nestjs/common';
import axios from 'axios';

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

    // 2. ダウンロードURLを抽出
    const downloadUrl = this.extractDownloadUrl(html, gigafileUrl);
    const filename = this.extractFilename(html);

    this.logger.log(`ファイル名: ${filename}, DL URL: ${downloadUrl}`);

    // 3. ダウンロード実行
    const response = await axios.get(downloadUrl, {
      responseType: 'arraybuffer',
      timeout: 600000, // 10分（大きい動画対応）
      maxContentLength: Infinity,
      maxBodyLength: Infinity,
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
      },
    });

    const buffer = Buffer.from(response.data);
    this.logger.log(`ダウンロード完了: ${filename} (${(buffer.length / 1024 / 1024).toFixed(2)}MB)`);

    return { buffer, filename };
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

  /**
   * HTMLからダウンロードURLを抽出
   * ギガファイル便のページ構造からDLリンクを取得
   */
  private extractDownloadUrl(html: string, originalUrl: string): string {
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
      // ギガファイル便のダウンロードAPIにPOST
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

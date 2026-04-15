import { Injectable, Logger } from '@nestjs/common';
import { LstepAttendanceCsvParser } from './lstep-attendance-csv-parser';

/** Lステップから着座CSVを取得するインターフェース */
export interface AttendanceCsvFetcher {
  fetchAttendedEmails(): Promise<Set<string>>;
}

/**
 * Playwrightを使ってLステップにログインし、友だちリスト→CSV操作→CSVエクスポート
 * から「ウェビナー①_着座（滞在率25%以上）」タグ絞り込みでCSVをダウンロード。
 *
 * 実装ノート:
 *  - Playwrightのchromium headlessで実行
 *  - セレクタは初回実装時に実UIで特定（TODO: 実行時に動的特定 or ユーザーに確認）
 *  - 認証情報は環境変数 LSTEP_EMAIL / LSTEP_PASSWORD から取得
 *  - GitHub Actionsではnpx playwright install chromium でブラウザ設定
 */
@Injectable()
export class PlaywrightLstepScraper implements AttendanceCsvFetcher {
  private readonly logger = new Logger(PlaywrightLstepScraper.name);
  private readonly parser = new LstepAttendanceCsvParser();

  async fetchAttendedEmails(): Promise<Set<string>> {
    const email = process.env.LSTEP_EMAIL;
    const password = process.env.LSTEP_PASSWORD;
    if (!email || !password) {
      throw new Error('LSTEP_EMAIL / LSTEP_PASSWORD 環境変数が未設定');
    }

    // 動的importでplaywright依存を必要時のみロード（CI環境以外で壊れない）
    // @ts-expect-error playwrightはGitHub Actions runnerでのみ実行（Vercelには存在しない）
    const { chromium } = await import('playwright');

    this.logger.log('Lステップスクレイピング開始');
    const browser = await chromium.launch({ headless: true });
    const context = await browser.newContext({ acceptDownloads: true });
    const page = await context.newPage();

    page.setDefaultTimeout(60000);
    page.setDefaultNavigationTimeout(60000);

    try {
      // 1) ログイン
      await page.goto('https://manager.linestep.net/account/login', { waitUntil: 'domcontentloaded', timeout: 60000 });
      // メアドフィールドが見えるまで待つ
      await page.waitForSelector('input[type="email"], input[name="email"]', { timeout: 30000 });
      await page.fill('input[name="email"], input[type="email"]', email);
      await page.fill('input[name="password"], input[type="password"]', password);
      // 「機械じゃない」チェックボックス（reCAPTCHAではない単純checkbox想定）
      const notRobot = page.locator('input[type="checkbox"]').first();
      if (await notRobot.isVisible().catch(() => false)) {
        await notRobot.check().catch(() => {});
      }
      await Promise.all([
        page.waitForLoadState('domcontentloaded'),
        page.click('button[type="submit"], input[type="submit"]'),
      ]);
      // ログイン後の遷移を待つ
      await page.waitForURL((url) => !url.toString().includes('/account/login'), { timeout: 30000 });
      this.logger.log(`ログイン完了: ${page.url()}`);

      // 2) 友だちリスト → CSV操作
      await page.getByText('友だちリスト', { exact: false }).first().click();
      await page.waitForLoadState('domcontentloaded');
      await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
      await page.getByText('CSV操作', { exact: false }).first().click();
      await page.waitForLoadState('domcontentloaded');

      // 3) CSVエクスポート
      await page.getByText('CSVエクスポート', { exact: false }).first().click();
      await page.waitForLoadState('domcontentloaded');

      // 4) 条件設定:
      //    - 「LINE登録名」チェックを追加
      await page.getByLabel(/LINE登録名/).check().catch(() => {});
      //    - タグ「ウェビナー①_着座（滞在率25%以上）」を選択
      await page.getByText('ウェビナー①_着座', { exact: false }).first().click();

      // 5) ダウンロード実行
      const [download] = await Promise.all([
        page.waitForEvent('download', { timeout: 60000 }),
        page.getByText('この条件でダウンロード', { exact: false }).first().click(),
      ]);
      const csvPath = await download.path();
      if (!csvPath) throw new Error('ダウンロードパス取得失敗');
      const fs = await import('fs');
      const csvText = fs.readFileSync(csvPath, 'utf8');
      this.logger.log(`CSV取得完了: ${csvText.length} bytes`);

      return this.parser.parse(csvText);
    } finally {
      await browser.close();
    }
  }
}

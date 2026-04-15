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
    // LSTEP_STORAGE_STATE_B64 (base64エンコードされたstorageState) を使用してログイン画面をスキップ
    const storageStateB64 = process.env.LSTEP_STORAGE_STATE_B64;
    if (!storageStateB64) {
      throw new Error(
        'LSTEP_STORAGE_STATE_B64 環境変数が未設定。scripts/capture-lstep-session.ts で生成してGitHub Secretsに登録してください',
      );
    }
    let storageState: any;
    try {
      const json = Buffer.from(storageStateB64, 'base64').toString('utf8');
      storageState = JSON.parse(json);
    } catch (e: any) {
      throw new Error(`LSTEP_STORAGE_STATE_B64 のデコード失敗: ${e.message}`);
    }

    // 動的importでplaywright依存を必要時のみロード（CI環境以外で壊れない）
    const { chromium } = await import('playwright');

    this.logger.log(
      'Lステップスクレイピング開始 (storageStateでログインスキップ)',
    );
    const browser = await chromium.launch({
      headless: true,
      args: [
        '--disable-blink-features=AutomationControlled',
        '--disable-features=IsolateOrigins,site-per-process',
      ],
    });
    const context = await browser.newContext({
      acceptDownloads: true,
      viewport: { width: 1400, height: 900 },
      userAgent:
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
      storageState,
    });
    await context.addInitScript(() => {
      Object.defineProperty(navigator, 'webdriver', { get: () => undefined });
    });
    const page = await context.newPage();

    page.setDefaultTimeout(60000);
    page.setDefaultNavigationTimeout(60000);

    const dumpOnError = async (stage: string) => {
      try {
        const html = await page.content();
        this.logger.warn(`[DIAG:${stage}] url=${page.url()}`);
        this.logger.warn(`[DIAG:${stage}] title=${await page.title()}`);
        // input要素を列挙
        const inputs = await page.$$eval('input', (els) =>
          els.map((e: any) => ({
            type: e.type,
            name: e.name,
            id: e.id,
            placeholder: e.placeholder,
            class: e.className,
          })),
        );
        this.logger.warn(
          `[DIAG:${stage}] inputs=${JSON.stringify(inputs).slice(0, 2000)}`,
        );
        // フォーム要素
        const forms = await page.$$eval('form', (els) =>
          els.map((e: any) => ({
            id: e.id,
            action: e.action,
            method: e.method,
          })),
        );
        this.logger.warn(
          `[DIAG:${stage}] forms=${JSON.stringify(forms).slice(0, 1000)}`,
        );
        this.logger.warn(
          `[DIAG:${stage}] HTML先頭2KB:\n${html.slice(0, 2000)}`,
        );
      } catch (e: any) {
        this.logger.warn(`[DIAG] 診断失敗: ${e.message}`);
      }
    };

    try {
      // 1) セッション有効性チェック: ダッシュボードへ直接アクセス
      await page.goto('https://manager.linestep.net/', {
        waitUntil: 'domcontentloaded',
        timeout: 60000,
      });
      await page.waitForTimeout(2000);
      if (page.url().includes('/account/login')) {
        await dumpOnError('session-expired');
        throw new Error(
          'Lステップセッションが期限切れ。ローカルで scripts/capture-lstep-session.ts を再実行し、' +
            'GitHub Secrets LSTEP_STORAGE_STATE_B64 を更新してください',
        );
      }
      this.logger.log(`セッション有効: ${page.url()}`);

      // 2) 友だちリスト直接遷移（URLで）
      await page.goto('https://manager.linestep.net/line/show', {
        waitUntil: 'domcontentloaded',
      });
      await page.waitForTimeout(2000);

      // 3) CSV操作 → CSVエクスポート
      // TODO: /line/exporter/XXXXX/register への直接URL取得方法を確定させる
      //       今は text-matching で辿る（失敗したら診断ダンプを見て修正）
      try {
        await page.getByText('CSV操作', { exact: false }).first().click();
        await page.waitForTimeout(1000);
        await page
          .getByText('CSVエクスポート', { exact: false })
          .first()
          .click();
        await page.waitForLoadState('domcontentloaded');
        await page.waitForURL(/\/line\/exporter\/.*\/register/, {
          timeout: 15000,
        });
      } catch (e: any) {
        await dumpOnError('csv-export-nav');
        throw new Error(`CSVエクスポート画面への遷移失敗: ${e.message}`);
      }

      // 4) 条件設定: LINE登録名にチェック + タグ選択
      await page
        .getByLabel(/LINE登録名/)
        .check()
        .catch(() => {});
      await page
        .getByText('ウェビナー①_着座', { exact: false })
        .first()
        .click()
        .catch(() => {});

      // 5) ダウンロードボタン押下 → 非同期ジョブ実行 → /list へリダイレクト
      await page
        .getByText('この条件でダウンロード', { exact: false })
        .first()
        .click();
      await page.waitForURL(/\/line\/exporter\/.*\/list/, { timeout: 30000 });
      this.logger.log(`ジョブ実行中: ${page.url()}`);

      // 6) ジョブ完了をポーリング: 最大5分間、30秒おきにリロード
      const maxWaitMs = 5 * 60 * 1000;
      const pollInterval = 30 * 1000;
      const startedAt = Date.now();
      let downloadLink: any = null;
      while (Date.now() - startedAt < maxWaitMs) {
        await page.reload({ waitUntil: 'domcontentloaded' });
        await page.waitForTimeout(2000);
        // 「ダウンロード」ボタン/リンクを探す
        const link = page.getByText(/^ダウンロード$/).first();
        if (await link.isVisible().catch(() => false)) {
          downloadLink = link;
          this.logger.log('ダウンロード可能');
          break;
        }
        this.logger.log(
          `ジョブ待機中... ${Math.round((Date.now() - startedAt) / 1000)}s`,
        );
        await page.waitForTimeout(pollInterval);
      }
      if (!downloadLink) {
        await dumpOnError('download-timeout');
        throw new Error('CSV生成ジョブが5分以内に完了せず');
      }

      // 7) CSV保存
      const [download] = await Promise.all([
        page.waitForEvent('download', { timeout: 60000 }),
        downloadLink.click(),
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

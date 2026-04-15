/**
 * Lステップの実UIをローカルで探索するスクリプト
 * - ヘッドフルモード(画面が見える)で起動
 * - 各ステップ後にHTMLダンプ→ファイル保存
 * - ユーザーはブラウザを見ながら進行を確認できる
 *
 * 実行前:
 *   npm install playwright  (ローカル)
 *   npx playwright install chromium
 *
 * 実行:
 *   LSTEP_EMAIL=xxx LSTEP_PASSWORD=yyy npx tsx scripts/explore-lstep.ts
 *
 * または apps/backend/.env に LSTEP_EMAIL/LSTEP_PASSWORD を書いてからでもOK
 */
import { config } from 'dotenv';
import * as path from 'path';
import * as fs from 'fs';
config({ path: path.resolve(__dirname, '../apps/backend/.env') });
config({ path: path.resolve(process.cwd(), '.env') });

async function main() {
  const email = process.env.LSTEP_EMAIL;
  const password = process.env.LSTEP_PASSWORD;
  if (!email || !password) {
    console.error('LSTEP_EMAIL / LSTEP_PASSWORD が未設定');
    process.exit(1);
  }

  // @ts-expect-error playwrightは devDependencies
  const { chromium } = await import('playwright');
  const outDir = path.resolve(process.cwd(), 'lstep-explore-output');
  fs.mkdirSync(outDir, { recursive: true });

  const browser = await chromium.launch({ headless: false, slowMo: 300 });
  const context = await browser.newContext({ acceptDownloads: true, viewport: { width: 1400, height: 900 } });
  const page = await context.newPage();

  const dump = async (stepName: string) => {
    const html = await page.content();
    const url = page.url();
    const title = await page.title();
    const inputs = await page.$$eval('input', (els: any[]) =>
      els.map((e) => ({ type: e.type, name: e.name, id: e.id, placeholder: e.placeholder, cls: e.className }))
    );
    const buttons = await page.$$eval('button, input[type="submit"], input[type="button"]', (els: any[]) =>
      els.map((e) => ({ tag: e.tagName, type: e.type, text: (e.innerText || e.value || '').slice(0, 60), id: e.id, cls: e.className }))
    );
    const summary = {
      step: stepName, url, title,
      inputs, buttons,
    };
    fs.writeFileSync(path.join(outDir, `${stepName}.json`), JSON.stringify(summary, null, 2), 'utf8');
    fs.writeFileSync(path.join(outDir, `${stepName}.html`), html, 'utf8');
    await page.screenshot({ path: path.join(outDir, `${stepName}.png`), fullPage: true });
    console.log(`[${stepName}] url=${url} title=${title}`);
    console.log(`  inputs=${inputs.length}件, buttons=${buttons.length}件 → ${outDir}\\${stepName}.{json,html,png}`);
  };

  console.log('ブラウザ起動。各ステップ後にEnterを押して次に進みます。');
  const enter = () => new Promise<void>((r) => process.stdin.once('data', () => r()));

  // ステップ1: ログイン画面
  await page.goto('https://manager.linestep.net/account/login', { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(2000);
  await dump('01-login-page');
  console.log('→ 画面を見て、ログインフォームの実セレクタ確認してください。Enterで自動入力してログイン試行します...');
  await enter();

  // 画面を見ながらメアド・パスワード手動入力してもらう方式も可。
  // スクリプトから自動入力試行（実際のセレクタに合わせて微調整要）
  try {
    // inputの1番目をemail、2番目をpasswordと仮定
    const inputs = await page.$$('input');
    if (inputs.length >= 2) {
      await inputs[0].fill(email);
      await inputs[1].fill(password);
    }
    // チェックボックス
    const cb = page.locator('input[type="checkbox"]').first();
    if (await cb.isVisible().catch(() => false)) await cb.check().catch(() => {});
  } catch (e) { console.log('自動入力失敗、手動で入力してください', e); }

  console.log('→ 画面でログインボタンをクリックしてログインしてください。完了したらEnter');
  await enter();
  await dump('02-after-login');
  console.log('→ 友だちリストへ遷移してください。Enter');
  await enter();
  await dump('03-friends-list');
  console.log('→ CSV操作を開いてください。Enter');
  await enter();
  await dump('04-csv-menu');
  console.log('→ CSVエクスポート画面を開いて条件設定してください。Enter');
  await enter();
  await dump('05-csv-export');
  console.log('→ ダウンロードボタンを押してCSVを取得できるか確認してください。Enter で終了');
  await enter();
  await dump('06-after-download');

  await browser.close();
  console.log(`\n全ダンプは ${outDir} に保存されました。`);
  console.log('このフォルダの *.json と *.png を見て、各ステップの正しいセレクタ/テキストを確認してください。');
}
main().catch((e) => { console.error(e); process.exit(1); });

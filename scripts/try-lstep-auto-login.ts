/**
 * Lステップ自動ログイン実験スクリプト
 * - ID/パス自動入力
 * - reCAPTCHAチェックボックスをクリック（iframe内）
 * - ログインボタン押下
 * - 結果（成功 / 画像パズル表示 / エラー）をダンプ
 */
import { config } from 'dotenv';
import * as path from 'path';
import * as fs from 'fs';
config({ path: path.resolve(__dirname, '../apps/backend/.env') });
config({ path: path.resolve(process.cwd(), '.env') });

async function main() {
  const email = process.env.LSTEP_EMAIL;
  const password = process.env.LSTEP_PASSWORD;
  if (!email || !password) { console.error('LSTEP_EMAIL / LSTEP_PASSWORD 未設定'); process.exit(1); }

  // @ts-expect-error playwright is devDep
  const { chromium } = await import('playwright');
  const outDir = path.resolve(process.cwd(), 'lstep-explore-output');
  fs.mkdirSync(outDir, { recursive: true });

  const browser = await chromium.launch({
    headless: false,
    slowMo: 200,
    args: [
      '--disable-blink-features=AutomationControlled',
      '--disable-features=IsolateOrigins,site-per-process',
    ],
  });
  const context = await browser.newContext({
    viewport: { width: 1400, height: 900 },
    userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
  });

  // navigator.webdriver を消す
  await context.addInitScript(() => {
    Object.defineProperty(navigator, 'webdriver', { get: () => undefined });
  });

  const page = await context.newPage();
  page.setDefaultTimeout(30000);

  console.log('[1] ログインページへ');
  await page.goto('https://manager.linestep.net/account/login', { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('#input_name');

  console.log('[2] ユーザーID/パス入力');
  await page.fill('#input_name', email);
  await page.fill('#input_password', password);

  console.log('[3] reCAPTCHA iframe探索');
  // reCAPTCHAは iframe[src*="recaptcha"] 内のチェックボックス
  const frames = page.frames();
  console.log(`  現在のframe数: ${frames.length}`);
  for (const f of frames) console.log(`    - ${f.url()}`);

  const captchaFrame = page.frameLocator('iframe[src*="recaptcha"][src*="anchor"]').first();
  console.log('[4] チェックボックスクリック試行');
  try {
    // 人間的なマウス移動を挟む
    await page.mouse.move(200, 200);
    await page.waitForTimeout(300);
    await page.mouse.move(300, 350, { steps: 10 });
    await page.waitForTimeout(200);
    await captchaFrame.locator('#recaptcha-anchor').click({ timeout: 10000 });
    console.log('  → クリック成功');
  } catch (e: any) {
    console.log(`  → クリック失敗: ${e.message}`);
  }

  console.log('[5] 10秒待機してreCAPTCHA検証結果を観察');
  await page.waitForTimeout(10000);

  // 検証結果: #recaptcha-anchor が checked になっているか
  try {
    const isChecked = await captchaFrame.locator('#recaptcha-anchor').getAttribute('aria-checked');
    console.log(`  aria-checked=${isChecked}`);
  } catch {}

  // 画像パズルが出ているか (bframeが表示されているか)
  const bframeVisible = await page.locator('iframe[src*="recaptcha"][src*="bframe"]').isVisible().catch(() => false);
  console.log(`  画像パズル表示: ${bframeVisible}`);

  await page.screenshot({ path: path.join(outDir, 'auto-login-after-captcha.png'), fullPage: true });

  console.log('[6] ログインボタンの状態確認');
  const loginBtn = page.locator('button.loginButton');
  const isDisabled = await loginBtn.isDisabled().catch(() => true);
  console.log(`  ログインボタン disabled=${isDisabled}`);

  if (!isDisabled) {
    console.log('[7] ログインボタンクリック');
    await loginBtn.click();
    await page.waitForTimeout(5000);
    console.log(`  遷移後URL: ${page.url()}`);
    const loggedIn = !page.url().includes('/account/login');
    console.log(`  ログイン成功: ${loggedIn}`);
    await page.screenshot({ path: path.join(outDir, 'auto-login-after-submit.png'), fullPage: true });
  } else {
    console.log('[7] ログインボタンがdisabledのまま → reCAPTCHA未通過');
  }

  console.log('\n完了。スクショ:');
  console.log(`  - ${outDir}\\auto-login-after-captcha.png`);
  console.log(`  - ${outDir}\\auto-login-after-submit.png`);
  console.log('\nブラウザを見てEnterで終了...');
  await new Promise<void>((r) => process.stdin.once('data', () => r()));
  await browser.close();
}
main().catch(e => { console.error(e); process.exit(1); });

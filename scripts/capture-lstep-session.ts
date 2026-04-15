/**
 * Lステップセッションキャプチャツール
 *
 * 1. ブラウザが起動してLステップログイン画面が開く
 * 2. 手動でログイン（reCAPTCHAも手動で通す）
 * 3. ダッシュボード到達後、ターミナルでEnter
 * 4. cookie+localStorageが lstep-session.json に保存される
 * 5. 出力される base64 文字列をGitHub Secrets `LSTEP_STORAGE_STATE_B64` に登録
 *
 * 実行: npx tsx scripts/capture-lstep-session.ts
 */
import * as path from 'path';
import * as fs from 'fs';

async function main() {
  // @ts-expect-error playwright is devDep
  const { chromium } = await import('playwright');

  const browser = await chromium.launch({
    headless: false,
    slowMo: 100,
    args: ['--disable-blink-features=AutomationControlled'],
  });
  const context = await browser.newContext({
    viewport: { width: 1400, height: 900 },
    userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
  });
  await context.addInitScript(() => {
    Object.defineProperty(navigator, 'webdriver', { get: () => undefined });
  });

  const page = await context.newPage();
  await page.goto('https://manager.linestep.net/account/login', { waitUntil: 'domcontentloaded' });

  console.log('\n===== Lステップに手動でログインしてください =====');
  console.log('1. ユーザーID/パスワード入力');
  console.log('2. 「私はロボットではありません」チェック（画像パズル出たら解く）');
  console.log('3. ログインボタンクリック');
  console.log('4. ダッシュボードが表示されたら、このターミナルでEnterを押す');
  console.log('==========================================\n');

  await new Promise<void>((r) => process.stdin.once('data', () => r()));

  const currentUrl = page.url();
  if (currentUrl.includes('/account/login')) {
    console.error(`❌ まだログイン画面のままです: ${currentUrl}`);
    console.error('   手動でログインしてから再度Enterを押してください');
    process.exit(1);
  }
  console.log(`✅ ログイン確認: ${currentUrl}`);

  const outPath = path.resolve(process.cwd(), 'lstep-session.json');
  await context.storageState({ path: outPath });
  console.log(`✅ セッション保存: ${outPath}`);

  const raw = fs.readFileSync(outPath, 'utf8');
  const b64 = Buffer.from(raw).toString('base64');
  const b64Path = path.resolve(process.cwd(), 'lstep-session.b64.txt');
  fs.writeFileSync(b64Path, b64, 'utf8');
  console.log(`✅ base64エンコード: ${b64Path} (${b64.length} 文字)`);

  console.log('\n===== GitHub Secrets 登録手順 =====');
  console.log('1. GitHub repo → Settings → Secrets and variables → Actions');
  console.log('2. New repository secret');
  console.log('3. Name: LSTEP_STORAGE_STATE_B64');
  console.log('4. Value: lstep-session.b64.txt の中身をコピペ');
  console.log('====================================\n');

  await browser.close();
  console.log('完了。lstep-session.json は .gitignore 対象なので安心してください。');
}
main().catch((e) => { console.error(e); process.exit(1); });

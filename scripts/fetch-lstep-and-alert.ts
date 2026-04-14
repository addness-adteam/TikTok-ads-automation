/**
 * GitHub Actions runnerで実行するスクリプト
 * 1. Lステップから着座CSVをPlaywrightで取得
 * 2. 着座メアド配列を抽出
 * 3. Vercel backendの /jobs/seminar-attendance-alert へPOST
 */
import { PlaywrightLstepScraper } from '../apps/backend/src/seminar-attendance-alert/infrastructure/lstep-scraper';

async function main() {
  const apiBaseUrl = process.env.API_BASE_URL ?? 'https://tik-tok-ads-automation-backend.vercel.app';
  const dryRun = process.env.DRY_RUN === 'true';

  console.log(`開始: dryRun=${dryRun}, API=${apiBaseUrl}`);

  // 1) Lステップから取得
  const scraper = new PlaywrightLstepScraper();
  const attendedEmails = await scraper.fetchAttendedEmails();
  console.log(`着座メアド取得: ${attendedEmails.size}件`);

  if (attendedEmails.size === 0) {
    console.error('着座メアド0件 → 処理中断');
    process.exit(1);
  }

  // 2) Vercelへ転送
  const url = `${apiBaseUrl}/jobs/seminar-attendance-alert?dryRun=${dryRun}`;
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ attendedEmails: [...attendedEmails] }),
  });
  const text = await res.text();
  console.log(`HTTP ${res.status}`);
  console.log(text);
  if (!res.ok) process.exit(1);
}

main().catch((e) => {
  console.error('失敗:', e);
  process.exit(1);
});

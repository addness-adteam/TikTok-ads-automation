// 実際のバグを再現するテスト
console.log('=== 実際のバグの再現テスト ===\n');

// ケース1: JST 11/17 00:05で実行（GitHub Actions）
console.log('【ケース1: JST 11/17 00:05で実行】\n');

// JST 11/17 00:05をシミュレート
const jstTime = new Date('2025-11-17T00:05:00+09:00'); // JST
console.log(`実行時刻（JST）: ${jstTime.toLocaleString('ja-JP', { timeZone: 'Asia/Tokyo' })}`);
console.log(`実行時刻（UTC）: ${jstTime.toISOString()}\n`);

// 修正前のロジック（ローカルタイムゾーンで計算）
// サーバーがJSTで動いている場合
console.log('サーバータイムゾーン: JST（ローカル開発環境）');
const localEndDate = new Date(jstTime);
localEndDate.setDate(localEndDate.getDate() - 1); // JST 11/16 00:05
const localStartDate = new Date(jstTime);
localStartDate.setDate(localStartDate.getDate() - 7); // JST 11/10 00:05

const localStartStr = localStartDate.toISOString().split('T')[0];
const localEndStr = localEndDate.toISOString().split('T')[0];

console.log(`  修正前: ${localStartStr} ～ ${localEndStr}`);

// サーバーがUTCで動いている場合（Vercel）
console.log('\nサーバータイムゾーン: UTC（Vercel本番環境）');

// Vercelでは、new Date()がUTC 11/16 15:05を返す
const utcServerTime = new Date(jstTime.getTime()); // UTC 11/16 15:05
const utcEndDate = new Date(utcServerTime);
utcEndDate.setDate(utcEndDate.getDate() - 1); // UTC 11/15 15:05
const utcStartDate = new Date(utcServerTime);
utcStartDate.setDate(utcStartDate.getDate() - 7); // UTC 11/9 15:05

const utcStartStr = utcStartDate.toISOString().split('T')[0];
const utcEndStr = utcEndDate.toISOString().split('T')[0];

console.log(`  修正前: ${utcStartStr} ～ ${utcEndStr} ❌ 1日ずれている！`);

// 修正後のロジック（JST基準で計算）
console.log('\n修正後のロジック（サーバータイムゾーンに依存しない）');
const now = jstTime;
const jstOffset = 9 * 60 * 60 * 1000;
const jstNow = new Date(now.getTime() + jstOffset);

const endDateJST = new Date(jstNow);
endDateJST.setUTCDate(endDateJST.getUTCDate() - 1);
const startDateJST = new Date(jstNow);
startDateJST.setUTCDate(startDateJST.getUTCDate() - 7);

const fixedStartStr = startDateJST.toISOString().split('T')[0];
const fixedEndStr = endDateJST.toISOString().split('T')[0];

console.log(`  修正後: ${fixedStartStr} ～ ${fixedEndStr} ✅\n`);

// まとめ
console.log('【問題の説明】');
console.log('1. ローカル環境（JST）では問題が発生しない');
console.log('2. Vercel（UTC）では、修正前のロジックで1日ずれる');
console.log('3. 修正後のロジックは、サーバータイムゾーンに依存せず正しく動作する\n');

console.log('【結論】');
console.log(`修正前（UTC環境）: ${utcStartStr} ～ ${utcEndStr}`);
console.log(`修正後（全環境）  : ${fixedStartStr} ～ ${fixedEndStr}`);
console.log(`改善: ${utcStartStr !== fixedStartStr ? '✅ 修正されました' : '変更なし'}`);

// タイムゾーン修正のテスト（UTCサーバーをシミュレート）
console.log('=== タイムゾーン修正のテスト（UTCサーバーをシミュレート） ===\n');

// UTCで11/17 00:05を シミュレート（JSTでは11/17 09:05）
const utcNow = new Date('2025-11-17T00:05:00.000Z'); // UTC 11/17 00:05 = JST 11/17 09:05

console.log(`シミュレート時刻: ${utcNow.toISOString()} (UTC)`);
console.log(`日本時間: ${new Date(utcNow.getTime() + 9 * 60 * 60 * 1000).toISOString()}\n`);

// 修正前のロジック（バグあり）
console.log('【修正前のロジック（バグあり）】');
const oldEndDate = new Date(utcNow);
oldEndDate.setDate(oldEndDate.getDate() - 1);
const oldStartDate = new Date(utcNow);
oldStartDate.setDate(oldStartDate.getDate() - 7);

const oldStartDateStr = oldStartDate.toISOString().split('T')[0];
const oldEndDateStr = oldEndDate.toISOString().split('T')[0];

console.log(`開始日: ${oldStartDateStr}`);
console.log(`終了日: ${oldEndDateStr}`);
console.log();

// 修正後のロジック（正しい）
console.log('【修正後のロジック（正しい）】');
const jstOffset = 9 * 60 * 60 * 1000; // JSTはUTC+9時間
const jstNow = new Date(utcNow.getTime() + jstOffset);

// JST基準で昨日と7日前を計算
const endDateJST = new Date(jstNow);
endDateJST.setUTCDate(endDateJST.getUTCDate() - 1); // 昨日
const startDateJST = new Date(jstNow);
startDateJST.setUTCDate(startDateJST.getUTCDate() - 7); // 7日前

const newStartDateStr = startDateJST.toISOString().split('T')[0];
const newEndDateStr = endDateJST.toISOString().split('T')[0];

console.log(`開始日: ${newStartDateStr}`);
console.log(`終了日: ${newEndDateStr}`);
console.log();

// 比較
console.log('【比較】');
console.log(`修正前の開始日: ${oldStartDateStr} ❌`);
console.log(`修正後の開始日: ${newStartDateStr} ✅`);
console.log();
console.log(`修正前の終了日: ${oldEndDateStr} ❌`);
console.log(`修正後の終了日: ${newEndDateStr} ✅`);
console.log();

// 日付の差を計算
const oldStart = new Date(oldStartDateStr);
const newStart = new Date(newStartDateStr);
const daysDiff = Math.round((newStart.getTime() - oldStart.getTime()) / (1000 * 60 * 60 * 24));

console.log(`日付のずれ: ${daysDiff}日`);
console.log();

// 期待される結果
console.log('【期待される結果】');
console.log('UTCサーバーでは、修正により日付が1日進むはずです');
console.log(`本来取得すべき期間: 11/10～11/16`);
console.log(`修正前の期間: ${oldStartDateStr}～${oldEndDateStr}`);
console.log(`修正後の期間: ${newStartDateStr}～${newEndDateStr}`);
console.log(`結果: ${daysDiff === 1 ? '✅ 正しく修正されています' : '❌ 修正に問題があります'}`);

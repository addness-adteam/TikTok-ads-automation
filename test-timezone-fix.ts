// タイムゾーン修正のテストスクリプト
console.log('=== タイムゾーン修正のテスト ===\n');

// 修正前のロジック（バグあり）
console.log('【修正前のロジック（バグあり）】');
const oldEndDate = new Date();
oldEndDate.setDate(oldEndDate.getDate() - 1);
const oldStartDate = new Date();
oldStartDate.setDate(oldStartDate.getDate() - 7);

const oldStartDateStr = oldStartDate.toISOString().split('T')[0];
const oldEndDateStr = oldEndDate.toISOString().split('T')[0];

console.log(`現在時刻: ${new Date().toString()}`);
console.log(`開始日: ${oldStartDateStr}`);
console.log(`終了日: ${oldEndDateStr}`);
console.log();

// 修正後のロジック（正しい）
console.log('【修正後のロジック（正しい）】');
const now = new Date();
const jstOffset = 9 * 60 * 60 * 1000; // JSTはUTC+9時間
const jstNow = new Date(now.getTime() + jstOffset);

// JST基準で昨日と7日前を計算
const endDateJST = new Date(jstNow);
endDateJST.setUTCDate(endDateJST.getUTCDate() - 1); // 昨日
const startDateJST = new Date(jstNow);
startDateJST.setUTCDate(startDateJST.getUTCDate() - 7); // 7日前

const newStartDateStr = startDateJST.toISOString().split('T')[0];
const newEndDateStr = endDateJST.toISOString().split('T')[0];

console.log(`現在時刻（JST）: ${jstNow.toISOString()}`);
console.log(`開始日: ${newStartDateStr}`);
console.log(`終了日: ${newEndDateStr}`);
console.log();

// 比較
console.log('【比較】');
console.log(`修正前の開始日: ${oldStartDateStr}`);
console.log(`修正後の開始日: ${newStartDateStr}`);
console.log(`差分: ${oldStartDateStr === newStartDateStr ? '✅ 一致' : '❌ 不一致'}`);
console.log();
console.log(`修正前の終了日: ${oldEndDateStr}`);
console.log(`修正後の終了日: ${newEndDateStr}`);
console.log(`差分: ${oldEndDateStr === newEndDateStr ? '✅ 一致' : '❌ 不一致'}`);
console.log();

// 日付の差を計算
const oldStart = new Date(oldStartDateStr);
const newStart = new Date(newStartDateStr);
const daysDiff = Math.round((newStart.getTime() - oldStart.getTime()) / (1000 * 60 * 60 * 24));

console.log(`日付のずれ: ${daysDiff}日`);
console.log();

// 期待される結果
console.log('【期待される結果】');
console.log('修正により、日付が1日進むはずです（11/9 → 11/10など）');
console.log(`実際の結果: ${daysDiff === 1 ? '✅ 正しく修正されています' : '❌ 修正に問題があります'}`);

// ============================================================================
// KPI値パーサー
// スプシのKPI値はフォーマットがバラバラなので統一的にパースする
// ============================================================================

/**
 * パーセンテージ文字列を比率（0〜1+）にパースする
 * "7.9％" → 0.079, "300%" → 3.0, "0.7613" → 0.7613
 */
export function parseKpiPercentage(value: string): number {
  if (!value) return NaN;

  const trimmed = value.trim();

  // 全角・半角パーセント記号を除去してパース
  if (trimmed.includes('%') || trimmed.includes('％')) {
    const numStr = trimmed.replace(/[%％]/g, '').replace(/,/g, '').trim();
    const num = parseFloat(numStr);
    return num / 100;
  }

  // パーセント記号なし → そのまま数値として解釈（0.7613等の比率）
  const num = parseFloat(trimmed.replace(/,/g, ''));
  return num;
}

/**
 * 金額文字列を数値にパースする
 * "¥48,830" → 48830, "2000万" → 20000000, "652306" → 652306
 */
export function parseKpiAmount(value: string): number {
  if (!value) return NaN;

  const trimmed = value.trim();

  // 漢字単位「万」の処理
  if (trimmed.includes('万')) {
    const numStr = trimmed.replace(/万/g, '').replace(/[¥,]/g, '').trim();
    return parseFloat(numStr) * 10_000;
  }

  // 円マーク・カンマを除去
  const cleaned = trimmed.replace(/[¥,]/g, '').trim();
  return parseFloat(cleaned);
}

/**
 * KPI値を自動判定してパースする
 * パーセント記号 → 比率、円マーク/万 → 金額、小数(0-1) → 比率、その他 → 金額
 */
export function parseKpiValue(value: string): number {
  if (!value || typeof value !== 'string') return NaN;

  const trimmed = value.trim();
  if (trimmed === '') return NaN;

  // パーセント記号があれば比率
  if (trimmed.includes('%') || trimmed.includes('％')) {
    return parseKpiPercentage(trimmed);
  }

  // 円マークがあれば金額
  if (trimmed.includes('¥')) {
    return parseKpiAmount(trimmed);
  }

  // 万があれば金額
  if (trimmed.includes('万')) {
    return parseKpiAmount(trimmed);
  }

  // 数値としてパース
  const num = parseFloat(trimmed.replace(/,/g, ''));
  if (isNaN(num)) return NaN;

  // 0〜1の小数は比率として扱う（0.7613等）
  // 1より大きい整数は金額として扱う（652306等）
  // 注: 1.0は比率としても金額としても解釈できるが、比率として扱う
  return num;
}

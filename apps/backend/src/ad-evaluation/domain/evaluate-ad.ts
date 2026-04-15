// ============================================================================
// 広告効果測定 - コアドメインロジック
// 停止済みCRの実績をKPIと突合し、判定 + 次アクションを生成
// ============================================================================

import {
  AdPerformance,
  KPIThresholds,
  EvaluationResult,
  EvaluationVerdict,
  NextAction,
} from './types';

/** データ不足と判定する最低消化額 */
const MIN_SPEND_FOR_EVALUATION = 3000;
/** データ不足と判定する最低配信日数 */
const MIN_DAYS_FOR_EVALUATION = 2;
/** KPI超過倍率がこれ以上なら廃止提案 */
const ABANDON_THRESHOLD = 2.0;

export function evaluateAd(
  ad: AdPerformance,
  kpi: KPIThresholds,
): EvaluationResult {
  // メトリクス算出
  const cpa = ad.optins > 0 ? ad.spend / ad.optins : 0;
  const frontCPO = ad.frontPurchases > 0 ? ad.spend / ad.frontPurchases : null;
  const indResCPO =
    ad.individualReservations > 0 ? ad.spend / ad.individualReservations : null;

  const metrics = {
    spend: ad.spend,
    optins: ad.optins,
    frontPurchases: ad.frontPurchases,
    individualReservations: ad.individualReservations,
    cpa,
    frontCPO,
    indResCPO,
  };

  // KPI比較
  const cpaRatio = ad.optins > 0 ? cpa / kpi.allowableCPA : null;
  const frontCPORatio =
    frontCPO !== null && kpi.allowableFrontCPO
      ? frontCPO / kpi.allowableFrontCPO
      : null;
  const indResCPORatio =
    indResCPO !== null ? indResCPO / kpi.allowableIndResCPO : null;

  const kpiComparison = { cpaRatio, frontCPORatio, indResCPORatio };

  // ===== 判定ロジック =====

  // 配信中 → MONITORING
  if (ad.status === 'ENABLE') {
    return buildResult(
      ad,
      'MONITORING',
      metrics,
      kpiComparison,
      `配信継続中（${ad.daysActive}日目、消化¥${ad.spend.toLocaleString()}、オプト${ad.optins}件）`,
      { type: 'CONTINUE', reason: '配信中のため経過観察' },
    );
  }

  // データ不足チェック
  if (
    ad.spend < MIN_SPEND_FOR_EVALUATION ||
    ad.daysActive < MIN_DAYS_FOR_EVALUATION
  ) {
    return buildResult(
      ad,
      'INSUFFICIENT_DATA',
      metrics,
      kpiComparison,
      `データ不足（消化¥${ad.spend.toLocaleString()}、${ad.daysActive}日間）。判定には最低¥${MIN_SPEND_FOR_EVALUATION}・${MIN_DAYS_FOR_EVALUATION}日必要`,
      {
        type: 'INVESTIGATE',
        reason: '配信期間/消化額が不足。再出稿してデータを蓄積するか検討',
      },
    );
  }

  // ===== 停止済みCRの判定 =====

  // 個別予約がある場合 → 個別予約CPOで最終判定（R010）
  if (ad.individualReservations > 0 && indResCPO !== null) {
    if (indResCPORatio !== null && indResCPORatio <= 1.0) {
      // 個別予約CPO KPI以内 → SUCCESS
      return buildResult(
        ad,
        'SUCCESS',
        metrics,
        kpiComparison,
        `個別予約CPO ¥${indResCPO.toLocaleString()}（KPI ¥${kpi.allowableIndResCPO.toLocaleString()}の${(indResCPORatio * 100).toFixed(0)}%）。KPI以内で成功`,
        {
          type: 'CROSS_DEPLOY',
          reason: `個別予約CPO KPI以内。他アカウントへの横展開で配信面を拡大`,
        },
      );
    } else if (indResCPORatio !== null && indResCPORatio >= ABANDON_THRESHOLD) {
      // 大幅超過 → FAILURE + 廃止
      return buildResult(
        ad,
        'FAILURE',
        metrics,
        kpiComparison,
        `個別予約CPO ¥${indResCPO.toLocaleString()}（KPI ¥${kpi.allowableIndResCPO.toLocaleString()}の${(indResCPORatio * 100).toFixed(0)}%）。KPIの${ABANDON_THRESHOLD}倍以上超過`,
        {
          type: 'ABANDON',
          reason: `個別予約CPOがKPIの${indResCPORatio.toFixed(1)}倍。改善余地なし`,
        },
      );
    } else {
      // 僅かに超過 → FAILURE + 改善提案
      return buildResult(
        ad,
        'FAILURE',
        metrics,
        kpiComparison,
        `個別予約CPO ¥${indResCPO.toLocaleString()}（KPI ¥${kpi.allowableIndResCPO.toLocaleString()}の${((indResCPORatio || 0) * 100).toFixed(0)}%）。僅かに超過`,
        {
          type: 'CHANGE_HOOK',
          reason:
            '個別予約CPOが僅かにKPI超過。動画フック差し替えまたはLP変更で改善の余地あり',
        },
      );
    }
  }

  // 個別予約0だがフロント購入あり → フロントCPOで判定
  if (ad.frontPurchases > 0 && ad.individualReservations === 0) {
    return buildResult(
      ad,
      'PARTIAL_SUCCESS',
      metrics,
      kpiComparison,
      `フロント${ad.frontPurchases}件購入あり、個別予約0件。フロント購入者が個別予約に至っていない`,
      {
        type: 'INVESTIGATE',
        reason:
          'フロント→個別予約の導線を確認。メルマガ/LINE誘導の改善が必要か検討',
      },
    );
  }

  // オプトはあるがフロント0 → PARTIAL（訴求問題 R005）
  if (
    ad.optins > 0 &&
    ad.frontPurchases === 0 &&
    ad.individualReservations === 0
  ) {
    const cpaOk = cpaRatio !== null && cpaRatio <= 1.0;
    if (cpaOk) {
      return buildResult(
        ad,
        'PARTIAL_SUCCESS',
        metrics,
        kpiComparison,
        `CPA ¥${cpa.toFixed(0)}（KPI以内）だがフロント販売0件。訴求がフロント購入に繋がっていない`,
        {
          type: 'CHANGE_LP',
          reason:
            'CPAは良いがフロント売れない。LP/OTOの訴求変更を検討（R005: 訴求自体の問題の可能性）',
        },
      );
    }
  }

  // オプト0 → CPA判定
  if (ad.optins === 0) {
    return buildResult(
      ad,
      'FAILURE',
      metrics,
      kpiComparison,
      `消化¥${ad.spend.toLocaleString()}でオプト0件。LP到達前に離脱しているか、ピクセル未発火の可能性`,
      {
        type: 'INVESTIGATE',
        reason:
          'オプト0。ピクセル発火確認/LP表示速度/ターゲティングの見直しが必要',
      },
    );
  }

  // CPAがKPI超過 → FAILURE
  if (cpaRatio !== null && cpaRatio > 1.0) {
    if (cpaRatio >= ABANDON_THRESHOLD) {
      return buildResult(
        ad,
        'FAILURE',
        metrics,
        kpiComparison,
        `CPA ¥${cpa.toFixed(0)}（KPI ¥${kpi.allowableCPA}の${(cpaRatio * 100).toFixed(0)}%）。大幅超過`,
        {
          type: 'ABANDON',
          reason: `CPAがKPIの${cpaRatio.toFixed(1)}倍。このCR/ターゲティングでは採算が合わない`,
        },
      );
    }
    return buildResult(
      ad,
      'FAILURE',
      metrics,
      kpiComparison,
      `CPA ¥${cpa.toFixed(0)}（KPI ¥${kpi.allowableCPA}の${(cpaRatio * 100).toFixed(0)}%）。超過`,
      {
        type: 'CHANGE_HOOK',
        reason:
          'CPA超過。動画フック差し替えまたはターゲティング変更で改善を試みる',
      },
    );
  }

  // ここまで来たらCPAはOKだが個別予約もフロントも0
  return buildResult(
    ad,
    'PARTIAL_SUCCESS',
    metrics,
    kpiComparison,
    `CPA ¥${cpa.toFixed(0)}（KPI以内）、オプト${ad.optins}件。フロント/個別予約はまだ発生していない`,
    {
      type: 'CONTINUE',
      reason: 'CPAは良好だがまだ下流CVが発生していない。データ蓄積を継続',
    },
  );
}

function buildResult(
  ad: AdPerformance,
  verdict: EvaluationVerdict,
  metrics: EvaluationResult['metrics'],
  kpiComparison: EvaluationResult['kpiComparison'],
  interpretation: string,
  nextAction: NextAction,
): EvaluationResult {
  return {
    adName: ad.adName,
    adId: ad.adId,
    channelType: ad.channelType,
    verdict,
    interpretation,
    metrics,
    kpiComparison,
    nextAction,
  };
}

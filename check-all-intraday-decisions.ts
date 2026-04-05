/**
 * 日中CPA最適化の全広告判断結果を確認するスクリプト
 * dryRun APIを呼び出して、全CRの判断結果を表示
 */

async function checkAllIntradayDecisions() {
  const API_URL = 'https://tik-tok-ads-automation-backend.vercel.app/jobs/intraday-cpa-check?dryRun=true';

  console.log('=== 日中CPA最適化 全広告判断結果 ===\n');
  console.log(`実行時刻: ${new Date().toISOString()}`);
  console.log(`API: ${API_URL}\n`);

  try {
    const response = await fetch(API_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
    });

    if (!response.ok) {
      throw new Error(`HTTP ${response.status}: ${response.statusText}`);
    }

    const result = await response.json() as any;

    if (!result.dryRunResult) {
      console.log('dryRunResultが見つかりません');
      console.log(JSON.stringify(result, null, 2));
      return;
    }

    const { advertisers, summary } = result.dryRunResult;

    // サマリー表示
    console.log('=== サマリー ===');
    console.log(`総広告数: ${summary.totalAds}件`);
    console.log(`停止対象: ${summary.wouldPause}件`);
    console.log(`予算削減対象: ${summary.wouldReduce}件`);
    console.log(`継続: ${summary.wouldContinue}件`);
    console.log('');

    // 各広告主の詳細
    for (const adv of advertisers) {
      if (adv.ads.length === 0) continue;

      console.log(`\n========================================`);
      console.log(`広告主ID: ${adv.advertiserId}`);
      console.log(`========================================`);

      // 判断結果ごとにグループ化
      const paused = adv.ads.filter((a: any) => a.decision === 'PAUSE');
      const reduced = adv.ads.filter((a: any) => a.decision === 'REDUCE_BUDGET');
      const continued = adv.ads.filter((a: any) => a.decision === 'CONTINUE');

      // 停止対象
      if (paused.length > 0) {
        console.log(`\n🔴 停止対象 (${paused.length}件)`);
        console.log('-'.repeat(50));
        for (const ad of paused) {
          console.log(`  広告名: ${ad.adName}`);
          console.log(`  広告ID: ${ad.adId}`);
          console.log(`  当日消化: ¥${ad.todaySpend?.toFixed(0) || '0'}`);
          console.log(`  当日CV: ${ad.todayCV}件`);
          console.log(`  当日CPA: ${ad.todayCPA ? `¥${ad.todayCPA.toFixed(0)}` : '-'}`);
          console.log(`  過去7日間CV: ${ad.last7DaysCV || ad.yesterdayCV || 0}件`);
          console.log(`  過去7日間CPA: ${(ad.last7DaysCPA || ad.yesterdayCPA) ? `¥${(ad.last7DaysCPA || ad.yesterdayCPA).toFixed(0)}` : '-'}`);
          console.log(`  判断理由: ${ad.reason}`);
          console.log('');
        }
      }

      // 予算削減対象
      if (reduced.length > 0) {
        console.log(`\n🟡 予算削減対象 (${reduced.length}件)`);
        console.log('-'.repeat(50));
        for (const ad of reduced) {
          console.log(`  広告名: ${ad.adName}`);
          console.log(`  広告ID: ${ad.adId}`);
          console.log(`  当日消化: ¥${ad.todaySpend?.toFixed(0) || '0'}`);
          console.log(`  当日CV: ${ad.todayCV}件`);
          console.log(`  当日CPA: ${ad.todayCPA ? `¥${ad.todayCPA.toFixed(0)}` : '-'}`);
          console.log(`  判断理由: ${ad.reason}`);
          console.log('');
        }
      }

      // 継続
      if (continued.length > 0) {
        console.log(`\n🟢 継続 (${continued.length}件)`);
        console.log('-'.repeat(50));
        for (const ad of continued) {
          console.log(`  広告名: ${ad.adName}`);
          console.log(`  広告ID: ${ad.adId}`);
          console.log(`  当日消化: ¥${ad.todaySpend?.toFixed(0) || '0'}`);
          console.log(`  当日CV: ${ad.todayCV}件`);
          console.log(`  当日CPA: ${ad.todayCPA ? `¥${ad.todayCPA.toFixed(0)}` : '-'}`);
          console.log(`  判断理由: ${ad.reason}`);
          console.log('');
        }
      }
    }

  } catch (error) {
    console.error('エラー:', error);
  }
}

checkAllIntradayDecisions();

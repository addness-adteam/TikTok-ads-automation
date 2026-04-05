/**
 * SP CR00468 (Smart+, 動画21本) を SP2・SP3 に横展開
 */
const API_BASE = 'https://tik-tok-ads-automation-backend.vercel.app';

const SOURCE_ADVERTISER_ID = '7474920444831875080'; // SP1
const SOURCE_AD_ID = '1858931396655186';

const targets = [
  { id: '7592868952431362066', name: 'SP2' },
  { id: '7616545514662051858', name: 'SP3' },
];

async function deploy(targetId: string, targetName: string) {
  console.log(`\n${'='.repeat(60)}`);
  console.log(`🚀 CR00468 → ${targetName} (${targetId})`);
  console.log(`  モード: SMART_PLUS（動画21本→1広告）`);
  console.log(`  日予算: ¥5,000`);

  const body = {
    sourceAdvertiserId: SOURCE_ADVERTISER_ID,
    sourceAdId: SOURCE_AD_ID,
    targetAdvertiserIds: [targetId],
    mode: 'SMART_PLUS',
    dailyBudget: 5000,
  };

  try {
    console.log(`  API呼び出し中（動画21本のDL/ULに数分かかります）...`);
    const res = await fetch(`${API_BASE}/api/cross-deploy/deploy`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });

    const data = await res.json();

    if (!res.ok) {
      console.log(`  ❌ HTTP ${res.status}: ${JSON.stringify(data).substring(0, 300)}`);
      return;
    }

    for (const result of data) {
      if (result.status === 'SUCCESS') {
        console.log(`  ✅ 成功!`);
        console.log(`    Campaign ID: ${result.campaignId}`);
        console.log(`    AdGroup ID: ${result.adgroupId}`);
        console.log(`    Ad ID: ${result.adId}`);
        console.log(`    Ad Name: ${result.adName}`);
        console.log(`    UTAGE経路: ${result.utagePath}`);
        console.log(`    LP: ${result.destinationUrl?.substring(0, 80)}`);
        console.log(`    CR番号: ${result.crNumber}`);
        console.log(`    日予算: ¥${result.dailyBudget}`);
      } else {
        console.log(`  ❌ 失敗: ${result.error}`);
        console.log(`    失敗ステップ: ${result.failedStep}`);
      }
    }
  } catch (e: any) {
    console.log(`  ❌ エラー: ${e.message?.substring(0, 300)}`);
  }
}

async function main() {
  console.log('=== SP CR00468 横展開 → SP2, SP3 ===');
  console.log('元広告: 260307/清水絢吾/スマプラ/CVポイント検証/LP2-CR00468');
  console.log('動画21本のSmart+広告\n');

  for (const t of targets) {
    await deploy(t.id, t.name);
  }

  console.log('\n\n=== 完了 ===');
}

main().catch(console.error);

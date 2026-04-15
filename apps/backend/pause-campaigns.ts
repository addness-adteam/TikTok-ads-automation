/**
 * 指定キャンペーンを DELETE ステータスに変更して停止
 */
import { config } from 'dotenv';
import * as path from 'path';
config({ path: path.resolve(__dirname, '.env') });
config({ path: path.resolve(process.cwd(), '.env') });
import axios from 'axios';

const ACCESS_TOKEN = process.env.TIKTOK_ACCESS_TOKEN || '2092744b8976b4b9392e0c8e8bdf2bf09570bb82';
const TIKTOK_BASE = 'https://business-api.tiktok.com/open_api';

async function updateCampaignStatus(advertiserId: string, campaignId: string, operation: 'DISABLE' | 'DELETE') {
  const res = await axios.post(
    `${TIKTOK_BASE}/v1.3/campaign/status/update/`,
    {
      advertiser_id: advertiserId,
      campaign_ids: [campaignId],
      operation_status: operation,
    },
    { headers: { 'Access-Token': ACCESS_TOKEN, 'Content-Type': 'application/json' } },
  );
  return res.data;
}

async function main() {
  // A1: AI_1 campaign 1862532272763074
  // A2: AI_2 campaign 1862532219430322
  const targets = [
    { label: 'A1', advertiserId: '7468288053866561553', campaignId: '1862532272763074' },
    { label: 'A2', advertiserId: '7523128243466551303', campaignId: '1862532219430322' },
  ];

  for (const t of targets) {
    try {
      console.log(`${t.label} キャンペーン ${t.campaignId} を DELETE に変更中...`);
      const resp = await updateCampaignStatus(t.advertiserId, t.campaignId, 'DELETE');
      console.log(`  code=${resp.code} message=${resp.message}`);
    } catch (e: any) {
      console.error(`  失敗: ${e.response?.data?.message ?? e.message}`);
    }
  }
}
main().catch(e => { console.error(e); process.exit(1); });

import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

const ACCOUNTS: Record<string, string> = {
  'AI_1': '7468288053866561553',
  'AI_2': '7523128243466551303',
  'AI_3': '7543540647266074641',
  'AI_4': '7580666710525493255',
  'SP1': '7474920444831875080',
  'SP2': '7592868952431362066',
  'SP3': '7616545514662051858',
  'SNS1': '7247073333517238273',
  'SNS2': '7543540100849156112',
  'SNS3': '7543540381615800337',
};

async function main() {
  // Get all advertisers
  const advertisers = await prisma.advertiser.findMany({
    where: {
      tiktokAdvertiserId: { in: Object.values(ACCOUNTS) },
    },
    select: { id: true, tiktokAdvertiserId: true, name: true },
  });

  const advMap = new Map(advertisers.map(a => [a.tiktokAdvertiserId, a]));
  const nameMap = Object.fromEntries(Object.entries(ACCOUNTS).map(([k, v]) => [v, k]));

  for (const dateLabel of ['2026-03-21 (yesterday)', '2026-03-22 (today)']) {
    const dateStr = dateLabel.startsWith('2026-03-21') ? '2026-03-21' : '2026-03-22';
    const startDate = new Date(`${dateStr}T00:00:00.000Z`);
    const endDate = new Date(`${dateStr}T23:59:59.999Z`);

    console.log(`\n${'='.repeat(80)}`);
    console.log(`  ${dateLabel} Performance Metrics`);
    console.log(`${'='.repeat(80)}`);

    let grandTotalSpend = 0;
    let grandTotalConversions = 0;

    for (const [label, tiktokId] of Object.entries(ACCOUNTS)) {
      const adv = advMap.get(tiktokId);
      if (!adv) {
        console.log(`\n--- ${label} (${tiktokId}): NOT FOUND IN DB ---`);
        continue;
      }

      // Get ad-level metrics for this advertiser on this date
      const metrics = await prisma.$queryRaw<Array<{
        ad_tiktok_id: string;
        ad_name: string;
        ad_status: string;
        total_spend: number;
        total_conversions: number;
        total_impressions: number;
        total_clicks: number;
      }>>`
        SELECT
          a."tiktokId" as ad_tiktok_id,
          a."name" as ad_name,
          a."status" as ad_status,
          SUM(m."spend") as total_spend,
          SUM(m."conversions") as total_conversions,
          SUM(m."impressions") as total_impressions,
          SUM(m."clicks") as total_clicks
        FROM metrics m
        JOIN ads a ON m."adId" = a."id"
        JOIN adgroups ag ON a."adgroupId" = ag."id"
        JOIN campaigns c ON ag."campaignId" = c."id"
        WHERE c."advertiserId" = ${adv.id}
          AND m."entityType" = 'AD'
          AND m."statDate" >= ${startDate}
          AND m."statDate" <= ${endDate}
        GROUP BY a."tiktokId", a."name", a."status"
        ORDER BY total_spend DESC
      `;

      if (metrics.length === 0) {
        console.log(`\n--- ${label} (${adv.name}): No metrics for ${dateStr} ---`);
        continue;
      }

      const accountSpend = metrics.reduce((s, m) => s + Number(m.total_spend), 0);
      const accountConversions = metrics.reduce((s, m) => s + Number(m.total_conversions), 0);
      const accountCPA = accountConversions > 0 ? accountSpend / accountConversions : null;

      grandTotalSpend += accountSpend;
      grandTotalConversions += accountConversions;

      console.log(`\n--- ${label} (${adv.name}) ---`);
      console.log(`  Total Spend: ¥${Math.round(accountSpend).toLocaleString()}`);
      console.log(`  Total Conversions: ${accountConversions}`);
      console.log(`  CPA: ${accountCPA ? `¥${Math.round(accountCPA).toLocaleString()}` : 'N/A (0 CV)'}`);
      console.log(`  Active Ads: ${metrics.length}`);
      console.log('');
      console.log(`  ${'Ad Name'.padEnd(50)} ${'Status'.padEnd(12)} ${'Spend'.padStart(12)} ${'CV'.padStart(5)} ${'CPA'.padStart(12)} ${'Impr'.padStart(10)} ${'Clicks'.padStart(8)}`);
      console.log(`  ${'-'.repeat(50)} ${'-'.repeat(12)} ${'-'.repeat(12)} ${'-'.repeat(5)} ${'-'.repeat(12)} ${'-'.repeat(10)} ${'-'.repeat(8)}`);

      for (const m of metrics) {
        const spend = Number(m.total_spend);
        const cv = Number(m.total_conversions);
        const impr = Number(m.total_impressions);
        const clicks = Number(m.total_clicks);
        const cpa = cv > 0 ? `¥${Math.round(spend / cv).toLocaleString()}` : '-';
        const name = m.ad_name.length > 48 ? m.ad_name.substring(0, 48) + '..' : m.ad_name;

        console.log(`  ${name.padEnd(50)} ${m.ad_status.padEnd(12)} ¥${Math.round(spend).toLocaleString().padStart(10)} ${cv.toString().padStart(5)} ${cpa.padStart(12)} ${impr.toLocaleString().padStart(10)} ${clicks.toLocaleString().padStart(8)}`);
      }
    }

    console.log(`\n${'='.repeat(80)}`);
    console.log(`  GRAND TOTAL for ${dateStr}:`);
    console.log(`  Spend: ¥${Math.round(grandTotalSpend).toLocaleString()}`);
    console.log(`  Conversions: ${grandTotalConversions}`);
    console.log(`  CPA: ${grandTotalConversions > 0 ? `¥${Math.round(grandTotalSpend / grandTotalConversions).toLocaleString()}` : 'N/A'}`);
    console.log(`${'='.repeat(80)}`);
  }

  await prisma.$disconnect();
}

main().catch(async (e) => {
  console.error(e);
  await prisma.$disconnect();
  process.exit(1);
});

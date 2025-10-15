import { PrismaClient } from './apps/backend/generated/prisma';

const prisma = new PrismaClient();

async function checkData() {
  try {
    // Count OAuth tokens
    const oauthCount = await prisma.oAuthToken.count();
    console.log(`OAuth Tokens: ${oauthCount}`);

    // Count Report Metrics
    const metricsCount = await prisma.reportMetrics.count();
    console.log(`Report Metrics: ${metricsCount}`);

    if (metricsCount > 0) {
      // Show recent metrics
      const recentMetrics = await prisma.reportMetrics.findMany({
        take: 5,
        orderBy: { createdAt: 'desc' },
        select: {
          id: true,
          date: true,
          dataLevel: true,
          dimensionValue: true,
          impressions: true,
          clicks: true,
          spend: true,
          createdAt: true,
        },
      });
      console.log('\nRecent Metrics:');
      console.table(recentMetrics);
    }
  } catch (error) {
    console.error('Error:', error);
  } finally {
    await prisma.$disconnect();
  }
}

checkData();

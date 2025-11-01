import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { TiktokService } from '../tiktok/tiktok.service';

@Injectable()
export class DashboardService {
  private readonly logger = new Logger(DashboardService.name);
  private readonly accessToken: string;
  private readonly advertiserIds: string[];

  constructor(
    private configService: ConfigService,
    private tiktokService: TiktokService,
  ) {
    this.accessToken = this.configService.get<string>('TIKTOK_ACCESS_TOKEN') || '';
    const idsString = this.configService.get<string>('TIKTOK_ADVERTISER_IDS') || '';
    this.advertiserIds = idsString.split(',').map(id => id.trim()).filter(id => id);

    this.logger.log(`Initialized with ${this.advertiserIds.length} advertiser IDs`);
  }

  /**
   * 全AdvertiserのダッシュボードデータGetを集約
   */
  async getAggregatedDashboardData() {
    const endDate = new Date().toISOString().split('T')[0];
    const startDate = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString().split('T')[0];

    this.logger.log(`Fetching data for period: ${startDate} to ${endDate}`);

    // 全Advertiserのキャンペーンを取得
    const allCampaigns: any[] = [];
    const allReportData: any[] = [];

    for (const advertiserId of this.advertiserIds) {
      try {
        // キャンペーン取得
        const campaignsResponse = await this.tiktokService.getCampaigns(
          advertiserId,
          this.accessToken,
        );

        // 広告セット取得
        const adGroupsResponse = await this.tiktokService.getAdGroups(
          advertiserId,
          this.accessToken,
        );

        // キャンペーンIDごとに広告セットの予算を集計
        const adGroupsByCampaign: Record<string, any[]> = {};
        if (adGroupsResponse?.data?.list) {
          adGroupsResponse.data.list.forEach((adGroup: any) => {
            const campaignId = adGroup.campaign_id;
            if (!adGroupsByCampaign[campaignId]) {
              adGroupsByCampaign[campaignId] = [];
            }
            adGroupsByCampaign[campaignId].push(adGroup);
          });
        }

        if (campaignsResponse?.data?.list) {
          const campaigns = campaignsResponse.data.list.map((c: any) => {
            const adGroups = adGroupsByCampaign[c.campaign_id] || [];

            // 広告セットの日予算を集計
            let totalAdGroupBudget = 0;
            let adGroupBudgetMode = '';

            adGroups.forEach((ag: any) => {
              if (ag.budget) {
                totalAdGroupBudget += parseFloat(ag.budget);
                adGroupBudgetMode = ag.budget_mode || '';
              }
            });

            return {
              id: c.campaign_id,
              tiktokId: c.campaign_id,
              advertiserId: c.advertiser_id,
              name: c.campaign_name,
              objectiveType: c.objective_type,
              budgetMode: c.budget_mode || adGroupBudgetMode,
              budget: c.budget || (totalAdGroupBudget > 0 ? totalAdGroupBudget : null),
              adGroupCount: adGroups.length,
              status: c.operation_status,
              createdAt: c.create_time,
              updatedAt: c.modify_time,
            };
          });
          allCampaigns.push(...campaigns);
        }

        // レポートデータ取得
        const reportResponse = await this.tiktokService.getReport(
          advertiserId,
          this.accessToken,
          {
            dataLevel: 'AUCTION_CAMPAIGN',
            startDate,
            endDate,
          },
        );

        if (reportResponse?.data?.list) {
          allReportData.push(...reportResponse.data.list);
        }
      } catch (error) {
        this.logger.warn(`Failed to fetch data for advertiser ${advertiserId}:`, error.message);
        // エラーがあっても他のAdvertiserのデータは取得を続ける
      }
    }

    // KPIデータを計算
    let totalSpend = 0;
    let totalImpressions = 0;
    let totalClicks = 0;
    let totalConversions = 0;

    const chartDataMap: Record<string, any> = {};

    allReportData.forEach((record: any) => {
      const metrics = record.metrics || {};
      const date = record.dimensions?.stat_time_day || record.stat_time_day;

      totalSpend += parseFloat(metrics.spend || '0');
      totalImpressions += parseInt(metrics.impressions || '0', 10);
      totalClicks += parseInt(metrics.clicks || '0', 10);
      totalConversions += parseInt(metrics.conversions || '0', 10);

      if (date) {
        if (!chartDataMap[date]) {
          chartDataMap[date] = {
            date,
            spend: 0,
            impressions: 0,
            clicks: 0,
            conversions: 0,
          };
        }

        chartDataMap[date].spend += parseFloat(metrics.spend || '0');
        chartDataMap[date].impressions += parseInt(metrics.impressions || '0', 10);
        chartDataMap[date].clicks += parseInt(metrics.clicks || '0', 10);
        chartDataMap[date].conversions += parseInt(metrics.conversions || '0', 10);
      }
    });

    const avgCtr = totalImpressions > 0 ? (totalClicks / totalImpressions) * 100 : 0;
    const avgCpa = totalConversions > 0 ? totalSpend / totalConversions : 0;

    const kpiData = {
      totalSpend,
      totalImpressions,
      totalClicks,
      totalConversions,
      avgCtr,
      avgCpa,
    };

    const chartData = Object.values(chartDataMap).sort((a: any, b: any) =>
      a.date.localeCompare(b.date),
    );

    this.logger.log(`Aggregated data: ${allCampaigns.length} campaigns, ${allReportData.length} report records`);

    return {
      campaigns: allCampaigns,
      kpiData,
      chartData,
    };
  }
}

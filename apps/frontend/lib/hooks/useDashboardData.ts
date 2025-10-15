import { useState, useEffect } from 'react';
import { useAuth } from '../context/AuthContext';
import { getCampaigns, getReport, Campaign } from '../api';

// モックデータ（APIが利用できない場合のフォールバック）
const mockKpiData = {
  totalSpend: 12500.50,
  totalImpressions: 1250000,
  totalClicks: 25300,
  totalConversions: 450,
  avgCtr: 2.02,
  avgCpa: 27.78,
};

const mockChartData = [
  { date: '2025-10-01', spend: 1800, impressions: 180000, clicks: 3600, conversions: 65 },
  { date: '2025-10-02', spend: 1650, impressions: 165000, clicks: 3300, conversions: 60 },
  { date: '2025-10-03', spend: 1900, impressions: 190000, clicks: 3800, conversions: 70 },
  { date: '2025-10-04', spend: 1750, impressions: 175000, clicks: 3500, conversions: 63 },
  { date: '2025-10-05', spend: 2100, impressions: 210000, clicks: 4200, conversions: 75 },
  { date: '2025-10-06', spend: 1950, impressions: 195000, clicks: 3900, conversions: 68 },
  { date: '2025-10-07', spend: 2200, impressions: 220000, clicks: 4400, conversions: 80 },
];

const mockCampaigns: Campaign[] = [
  {
    id: '1',
    tiktokId: '1234567890',
    advertiserId: 'adv123',
    name: 'Summer Sale 2025',
    objectiveType: 'APP_PROMOTION',
    budgetMode: 'BUDGET_MODE_DAY',
    budget: 500,
    status: 'ENABLE',
    createdAt: '2025-10-01T00:00:00Z',
    updatedAt: '2025-10-01T00:00:00Z',
  },
  {
    id: '2',
    tiktokId: '1234567891',
    advertiserId: 'adv123',
    name: 'New Product Launch',
    objectiveType: 'CONVERSIONS',
    budgetMode: 'BUDGET_MODE_TOTAL',
    budget: 10000,
    status: 'ENABLE',
    createdAt: '2025-09-28T00:00:00Z',
    updatedAt: '2025-10-01T00:00:00Z',
  },
  {
    id: '3',
    tiktokId: '1234567892',
    advertiserId: 'adv123',
    name: 'Brand Awareness Q3',
    objectiveType: 'REACH',
    budgetMode: 'BUDGET_MODE_DAY',
    budget: 200,
    status: 'DISABLE',
    createdAt: '2025-09-15T00:00:00Z',
    updatedAt: '2025-09-30T00:00:00Z',
  },
];

interface DashboardData {
  campaigns: Campaign[];
  kpiData: {
    totalSpend: number;
    totalImpressions: number;
    totalClicks: number;
    totalConversions: number;
    avgCtr: number;
    avgCpa: number;
  };
  chartData: Array<{
    date: string;
    spend: number;
    impressions: number;
    clicks: number;
    conversions: number;
  }>;
  isLoading: boolean;
  error: string | null;
  isUsingMockData: boolean;
}

export function useDashboardData(): DashboardData {
  const { accessToken, advertiserId } = useAuth();
  const [campaigns, setCampaigns] = useState<Campaign[]>(mockCampaigns);
  const [kpiData, setKpiData] = useState(mockKpiData);
  const [chartData, setChartData] = useState(mockChartData);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [isUsingMockData, setIsUsingMockData] = useState(true);

  useEffect(() => {
    const fetchData = async () => {
      setIsLoading(true);
      setError(null);

      // 認証情報がない場合はモックデータを使用
      if (!advertiserId || !accessToken) {
        console.log('認証情報が未設定のため、モックデータを使用します');
        setIsUsingMockData(true);
        setIsLoading(false);
        return;
      }

      try {
        // Campaign一覧を取得
        const campaignsResponse = await getCampaigns(advertiserId, accessToken);

        if (campaignsResponse.success && campaignsResponse.data?.data?.list) {
          const fetchedCampaigns = campaignsResponse.data.data.list.map((c: any) => ({
            id: c.campaign_id,
            tiktokId: c.campaign_id,
            advertiserId: c.advertiser_id,
            name: c.campaign_name,
            objectiveType: c.objective_type,
            budgetMode: c.budget_mode,
            budget: c.budget,
            status: c.operation_status,
            createdAt: c.create_time,
            updatedAt: c.modify_time,
          }));

          setCampaigns(fetchedCampaigns);
          setIsUsingMockData(false);
        }

        // レポートデータを取得（過去7日間）
        const endDate = new Date().toISOString().split('T')[0];
        const startDate = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString().split('T')[0];

        const reportResponse = await getReport(
          advertiserId,
          accessToken,
          'AUCTION_CAMPAIGN',
          startDate,
          endDate
        );

        if (reportResponse.success && reportResponse.data?.data?.list) {
          const reportData = reportResponse.data.data.list;

          // KPIデータを計算
          let totalSpend = 0;
          let totalImpressions = 0;
          let totalClicks = 0;
          let totalConversions = 0;

          const chartDataMap: Record<string, any> = {};

          reportData.forEach((record: any) => {
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

          const avgCtr = totalClicks > 0 ? (totalClicks / totalImpressions) * 100 : 0;
          const avgCpa = totalConversions > 0 ? totalSpend / totalConversions : 0;

          setKpiData({
            totalSpend,
            totalImpressions,
            totalClicks,
            totalConversions,
            avgCtr,
            avgCpa,
          });

          setChartData(
            Object.values(chartDataMap).sort((a, b) => a.date.localeCompare(b.date))
          );

          setIsUsingMockData(false);
        }
      } catch (err: any) {
        console.error('データ取得エラー:', err);
        setError(err.message || 'データの取得に失敗しました');
        setIsUsingMockData(true);
      } finally {
        setIsLoading(false);
      }
    };

    fetchData();
  }, [accessToken, advertiserId]);

  return {
    campaigns,
    kpiData,
    chartData,
    isLoading,
    error,
    isUsingMockData,
  };
}

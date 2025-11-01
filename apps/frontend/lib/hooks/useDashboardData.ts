import { useState, useEffect } from 'react';
import { Campaign } from '../api';

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

      try {
        // 新しいダッシュボードAPIエンドポイントを呼び出す
        const response = await fetch(`${process.env.NEXT_PUBLIC_API_URL}/api/dashboard`);

        if (!response.ok) {
          throw new Error(`API error: ${response.status}`);
        }

        const result = await response.json();

        if (result.success && result.data) {
          const { campaigns: fetchedCampaigns, kpiData: fetchedKpiData, chartData: fetchedChartData } = result.data;

          setCampaigns(fetchedCampaigns || []);
          setKpiData(fetchedKpiData || mockKpiData);
          setChartData(fetchedChartData || mockChartData);
          setIsUsingMockData(false);

          console.log(`実データ取得成功: ${fetchedCampaigns?.length || 0} キャンペーン`);
        } else {
          throw new Error(result.error || 'データの取得に失敗しました');
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
  }, []);

  return {
    campaigns,
    kpiData,
    chartData,
    isLoading,
    error,
    isUsingMockData,
  };
}

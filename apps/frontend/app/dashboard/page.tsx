'use client';

import { useState } from 'react';
import { TrendingUp, DollarSign, MousePointerClick, Target, AlertCircle, Loader2 } from 'lucide-react';
import { KpiCard } from '@/components/dashboard/kpi-card';
import { PerformanceChart } from '@/components/dashboard/performance-chart';
import { CampaignList } from '@/components/dashboard/campaign-list';
import { useDashboardData } from '@/lib/hooks/useDashboardData';
import { AppLayout } from '@/components/layout/AppLayout';

export default function DashboardPage() {
  const [selectedMetric, setSelectedMetric] = useState<'spend' | 'impressions' | 'clicks' | 'conversions'>('spend');
  const { campaigns, kpiData, chartData, isLoading, error, isUsingMockData } = useDashboardData();

  // OAuth認証不要 - 固定トークンを使用

  // ローディング状態
  if (isLoading) {
    return (
      <AppLayout>
        <div className="min-h-screen bg-gray-50 flex items-center justify-center">
          <div className="text-center">
            <Loader2 className="w-12 h-12 text-blue-600 animate-spin mx-auto mb-4" />
            <p className="text-gray-600">データを読み込み中...</p>
          </div>
        </div>
      </AppLayout>
    );
  }

  return (
    <AppLayout>
      <div className="min-h-screen bg-gray-50">
      {/* Header */}
      <header className="bg-white border-b border-gray-200">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-4">
          <h1 className="text-2xl font-bold text-gray-900">TikTok広告ダッシュボード</h1>
          <p className="text-sm text-gray-600 mt-1">広告パフォーマンスの概要（13アカウント）</p>
        </div>
      </header>

      <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        {/* エラー表示 */}
        {error && (
          <div className="mb-6 bg-red-50 border border-red-200 rounded-lg p-4 flex items-start gap-3">
            <AlertCircle className="w-5 h-5 text-red-600 flex-shrink-0 mt-0.5" />
            <div>
              <h3 className="text-sm font-semibold text-red-900 mb-1">データ取得エラー</h3>
              <p className="text-sm text-red-700">{error}</p>
              <p className="text-xs text-red-600 mt-2">モックデータを表示しています</p>
            </div>
          </div>
        )}

        {/* モックデータ使用中の通知 */}
        {isUsingMockData && !error && (
          <div className="mb-6 bg-yellow-50 border border-yellow-200 rounded-lg p-4 flex items-start gap-3">
            <AlertCircle className="w-5 h-5 text-yellow-600 flex-shrink-0 mt-0.5" />
            <div>
              <h3 className="text-sm font-semibold text-yellow-900 mb-1">開発モード</h3>
              <p className="text-sm text-yellow-700">
                認証情報が未設定のため、モックデータを表示しています。
              </p>
              <p className="text-xs text-yellow-600 mt-1">
                実データを表示するには、<code className="bg-yellow-100 px-1 py-0.5 rounded">.env.local</code>にAdvertiser IDとAccess Tokenを設定してください。
              </p>
            </div>
          </div>
        )}
        {/* KPI Cards */}
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6 mb-8">
          <KpiCard
            title="総広告費"
            value={kpiData.totalSpend}
            change={5.2}
            icon={DollarSign}
            format="currency"
          />
          <KpiCard
            title="総インプレッション"
            value={kpiData.totalImpressions}
            change={-2.1}
            icon={TrendingUp}
            format="number"
          />
          <KpiCard
            title="総クリック数"
            value={kpiData.totalClicks}
            change={3.8}
            icon={MousePointerClick}
            format="number"
          />
          <KpiCard
            title="総コンバージョン数"
            value={kpiData.totalConversions}
            change={8.5}
            icon={Target}
            format="number"
          />
        </div>

        {/* 追加のKPI */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6 mb-8">
          <div className="bg-white rounded-lg border border-gray-200 p-6">
            <h3 className="text-sm font-medium text-gray-600 mb-2">平均CTR</h3>
            <p className="text-2xl font-bold text-gray-900">{kpiData.avgCtr.toFixed(2)}%</p>
          </div>
          <div className="bg-white rounded-lg border border-gray-200 p-6">
            <h3 className="text-sm font-medium text-gray-600 mb-2">平均CPA</h3>
            <p className="text-2xl font-bold text-gray-900">${kpiData.avgCpa.toFixed(2)}</p>
          </div>
        </div>

        {/* メトリクス選択 */}
        <div className="mb-4">
          <div className="flex gap-2">
            {(['spend', 'impressions', 'clicks', 'conversions'] as const).map((metric) => (
              <button
                key={metric}
                onClick={() => setSelectedMetric(metric)}
                className={`px-4 py-2 rounded-lg text-sm font-medium transition-colors ${
                  selectedMetric === metric
                    ? 'bg-blue-600 text-white'
                    : 'bg-white text-gray-700 border border-gray-200 hover:bg-gray-50'
                }`}
              >
                {metric === 'spend' && '広告費'}
                {metric === 'impressions' && 'インプレッション'}
                {metric === 'clicks' && 'クリック数'}
                {metric === 'conversions' && 'コンバージョン数'}
              </button>
            ))}
          </div>
        </div>

        {/* パフォーマンスチャート */}
        <div className="mb-8">
          <PerformanceChart data={chartData} metric={selectedMetric} />
        </div>

        {/* Campaign一覧 */}
        <CampaignList campaigns={campaigns} />
      </main>
      </div>
    </AppLayout>
  );
}

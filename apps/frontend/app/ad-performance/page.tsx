'use client';

import { useState, useEffect } from 'react';
import { Loader2, AlertTriangle, AlertCircle, Info, TrendingUp, Eye, Filter, RefreshCw } from 'lucide-react';
import { AppLayout } from '@/components/layout/AppLayout';
import { getAdPerformances, AdPerformance } from '@/lib/api';

// API URLを取得
const getApiUrl = () => {
  if (typeof window === 'undefined') return 'http://localhost:4000';
  return window.location.hostname === 'localhost'
    ? 'http://localhost:4000'
    : 'https://tik-tok-ads-automation-backend.vercel.app';
};

interface Advertiser {
  id: string;
  tiktokAdvertiserId: string;
  name: string;
  status: string;
  appealId: string | null;
}

export default function AdPerformancePage() {
  // アカウント選択関連
  const [advertisers, setAdvertisers] = useState<Advertiser[]>([]);
  const [selectedAdvertiserId, setSelectedAdvertiserId] = useState<string | null>(null);
  const [isLoadingAdvertisers, setIsLoadingAdvertisers] = useState(true);

  const [performances, setPerformances] = useState<AdPerformance[]>([]);
  const [summary, setSummary] = useState<{
    totalAds: number;
    adsWithDeviation: number;
    adsNeedingReview: number;
  } | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [selectedPerformance, setSelectedPerformance] = useState<AdPerformance | null>(null);

  // フィルタ状態
  const [filters, setFilters] = useState({
    impressionThresholdMet: undefined as boolean | undefined,
    hasDeviation: undefined as boolean | undefined,
  });
  const [showFilters, setShowFilters] = useState(false);

  // アカウント一覧を取得
  useEffect(() => {
    fetchAdvertisers();
  }, []);

  const fetchAdvertisers = async () => {
    try {
      setIsLoadingAdvertisers(true);
      const response = await fetch(`${getApiUrl()}/api/advertisers`);
      if (!response.ok) {
        throw new Error('Failed to fetch advertisers');
      }
      const result = await response.json();

      let advertisersData = [];
      if (result.success && result.data) {
        advertisersData = result.data;
      } else if (Array.isArray(result)) {
        advertisersData = result;
      } else {
        throw new Error(result.error || 'Failed to fetch advertisers');
      }

      // アクティブなアカウントのみフィルタ
      const activeAdvertisers = advertisersData.filter(
        (adv: Advertiser) => adv.status === 'ACTIVE'
      );
      setAdvertisers(activeAdvertisers);

      // 最初のアカウントを自動選択
      if (activeAdvertisers.length > 0 && !selectedAdvertiserId) {
        setSelectedAdvertiserId(activeAdvertisers[0].tiktokAdvertiserId);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'アカウントの取得に失敗しました');
    } finally {
      setIsLoadingAdvertisers(false);
    }
  };

  // パフォーマンスデータ取得
  const fetchData = async () => {
    if (!selectedAdvertiserId) return;

    setIsLoading(true);
    setError(null);

    try {
      const response = await getAdPerformances(selectedAdvertiserId, {
        impressionThresholdMet: filters.impressionThresholdMet,
        hasDeviation: filters.hasDeviation,
      });
      setPerformances(response.performances);
      setSummary(response.summary);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'データの取得に失敗しました');
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    if (selectedAdvertiserId) {
      fetchData();
    }
  }, [selectedAdvertiserId, filters]);

  // CPA乖離度を計算
  const calculateDeviation = (performance: AdPerformance): { percentage: number; severity: string } | null => {
    if (!performance.bestCPA || performance.totalConversions === 0) return null;

    const currentCPA = performance.totalSpend / performance.totalConversions;
    const deviation = ((currentCPA - performance.bestCPA) / performance.bestCPA) * 100;

    let severity = 'INFO';
    if (deviation >= 50) {
      severity = 'CRITICAL';
    } else if (deviation >= 20) {
      severity = 'WARNING';
    }

    return { percentage: deviation, severity };
  };

  // 乖離度に応じたスタイル
  const getDeviationStyle = (severity: string) => {
    switch (severity) {
      case 'CRITICAL':
        return 'bg-red-100 text-red-800 border-red-200';
      case 'WARNING':
        return 'bg-yellow-100 text-yellow-800 border-yellow-200';
      default:
        return 'bg-green-100 text-green-800 border-green-200';
    }
  };

  // 乖離度アイコン
  const getDeviationIcon = (severity: string) => {
    switch (severity) {
      case 'CRITICAL':
        return <AlertCircle className="w-4 h-4 text-red-600" />;
      case 'WARNING':
        return <AlertTriangle className="w-4 h-4 text-yellow-600" />;
      default:
        return <Info className="w-4 h-4 text-green-600" />;
    }
  };

  // 数値フォーマット
  const formatNumber = (num: number) => {
    return new Intl.NumberFormat('ja-JP').format(Math.round(num));
  };

  const formatCurrency = (num: number) => {
    return `¥${formatNumber(num)}`;
  };

  // ローディング中
  if (isLoadingAdvertisers) {
    return (
      <AppLayout>
        <div className="min-h-screen bg-gray-50 flex items-center justify-center">
          <div className="text-center">
            <Loader2 className="w-12 h-12 text-blue-600 animate-spin mx-auto mb-4" />
            <p className="text-gray-600">アカウント情報を読み込み中...</p>
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
            <div className="flex items-center justify-between">
              <div>
                <h1 className="text-2xl font-bold text-gray-900">広告パフォーマンス</h1>
                <p className="text-sm text-gray-600 mt-1">
                  広告ごとのパフォーマンス推移とCPA乖離を確認できます
                </p>
              </div>
              <button
                onClick={fetchData}
                disabled={isLoading || !selectedAdvertiserId}
                className="flex items-center gap-2 px-4 py-2 bg-gray-900 text-white rounded-lg hover:bg-gray-800 disabled:bg-gray-300 transition-colors"
              >
                <RefreshCw className={`w-4 h-4 ${isLoading ? 'animate-spin' : ''}`} />
                更新
              </button>
            </div>
          </div>
        </header>

        <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
          {/* アカウント選択 */}
          <div className="bg-white rounded-lg border border-gray-200 p-4 mb-6">
            <label className="block text-sm font-medium text-gray-700 mb-2">
              広告アカウント
            </label>
            {advertisers.length === 0 ? (
              <div className="text-center py-4">
                <AlertCircle className="w-8 h-8 text-gray-400 mx-auto mb-2" />
                <p className="text-gray-600 text-sm">アクティブな広告アカウントがありません</p>
              </div>
            ) : (
              <select
                value={selectedAdvertiserId || ''}
                onChange={(e) => setSelectedAdvertiserId(e.target.value)}
                className="w-full md:w-auto min-w-[300px] px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
              >
                {advertisers.map((adv) => (
                  <option key={adv.id} value={adv.tiktokAdvertiserId}>
                    {adv.name} ({adv.tiktokAdvertiserId})
                  </option>
                ))}
              </select>
            )}
          </div>
          {/* サマリーカード */}
          {summary && (
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-6">
              <div className="bg-white rounded-lg border border-gray-200 p-4">
                <div className="flex items-center gap-3">
                  <div className="p-2 bg-blue-100 rounded-lg">
                    <TrendingUp className="w-5 h-5 text-blue-600" />
                  </div>
                  <div>
                    <p className="text-sm text-gray-600">総広告数</p>
                    <p className="text-2xl font-bold text-gray-900">{summary.totalAds}</p>
                  </div>
                </div>
              </div>

              <div className="bg-white rounded-lg border border-gray-200 p-4">
                <div className="flex items-center gap-3">
                  <div className="p-2 bg-yellow-100 rounded-lg">
                    <AlertTriangle className="w-5 h-5 text-yellow-600" />
                  </div>
                  <div>
                    <p className="text-sm text-gray-600">CPA乖離あり</p>
                    <p className="text-2xl font-bold text-gray-900">{summary.adsWithDeviation}</p>
                  </div>
                </div>
              </div>

              <div className="bg-white rounded-lg border border-gray-200 p-4">
                <div className="flex items-center gap-3">
                  <div className="p-2 bg-red-100 rounded-lg">
                    <Eye className="w-5 h-5 text-red-600" />
                  </div>
                  <div>
                    <p className="text-sm text-gray-600">要レビュー</p>
                    <p className="text-2xl font-bold text-gray-900">{summary.adsNeedingReview}</p>
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* フィルタ */}
          <div className="bg-white rounded-lg border border-gray-200 p-4 mb-6">
            <button
              onClick={() => setShowFilters(!showFilters)}
              className="flex items-center gap-2 text-sm font-medium text-gray-700"
            >
              <Filter className="w-4 h-4" />
              フィルタ
              {(filters.impressionThresholdMet !== undefined || filters.hasDeviation !== undefined) && (
                <span className="ml-2 px-2 py-0.5 bg-blue-100 text-blue-800 text-xs rounded-full">
                  適用中
                </span>
              )}
            </button>

            {showFilters && (
              <div className="mt-4 flex flex-wrap gap-4">
                <div>
                  <label className="block text-xs text-gray-600 mb-1">インプレッション閾値</label>
                  <select
                    value={filters.impressionThresholdMet === undefined ? '' : String(filters.impressionThresholdMet)}
                    onChange={(e) => setFilters(prev => ({
                      ...prev,
                      impressionThresholdMet: e.target.value === '' ? undefined : e.target.value === 'true'
                    }))}
                    className="px-3 py-2 border border-gray-300 rounded-lg text-sm"
                  >
                    <option value="">すべて</option>
                    <option value="true">達成済み (10万imp以上)</option>
                    <option value="false">未達成</option>
                  </select>
                </div>

                <div>
                  <label className="block text-xs text-gray-600 mb-1">CPA乖離</label>
                  <select
                    value={filters.hasDeviation === undefined ? '' : String(filters.hasDeviation)}
                    onChange={(e) => setFilters(prev => ({
                      ...prev,
                      hasDeviation: e.target.value === '' ? undefined : e.target.value === 'true'
                    }))}
                    className="px-3 py-2 border border-gray-300 rounded-lg text-sm"
                  >
                    <option value="">すべて</option>
                    <option value="true">乖離あり (20%以上)</option>
                    <option value="false">乖離なし</option>
                  </select>
                </div>

                <button
                  onClick={() => setFilters({ impressionThresholdMet: undefined, hasDeviation: undefined })}
                  className="self-end px-3 py-2 text-sm text-gray-600 hover:text-gray-900"
                >
                  リセット
                </button>
              </div>
            )}
          </div>

          {/* エラー表示 */}
          {error && (
            <div className="mb-6 bg-red-50 border border-red-200 rounded-lg p-4 flex items-start gap-3">
              <AlertCircle className="w-5 h-5 text-red-600 flex-shrink-0 mt-0.5" />
              <div>
                <h3 className="text-sm font-semibold text-red-900 mb-1">エラー</h3>
                <p className="text-sm text-red-700">{error}</p>
              </div>
            </div>
          )}

          {/* ローディング */}
          {isLoading ? (
            <div className="bg-white rounded-lg border border-gray-200 p-12 text-center">
              <Loader2 className="w-8 h-8 text-blue-600 animate-spin mx-auto mb-4" />
              <p className="text-gray-600">データを読み込み中...</p>
            </div>
          ) : performances.length === 0 ? (
            <div className="bg-white rounded-lg border border-gray-200 p-12 text-center">
              <TrendingUp className="w-12 h-12 text-gray-400 mx-auto mb-4" />
              <p className="text-gray-600">パフォーマンスデータがありません</p>
              <p className="text-sm text-gray-500 mt-2">
                広告が配信されると、ここにパフォーマンスデータが表示されます
              </p>
            </div>
          ) : (
            /* パフォーマンス一覧テーブル */
            <div className="bg-white rounded-lg border border-gray-200 overflow-hidden">
              <div className="overflow-x-auto">
                <table className="min-w-full divide-y divide-gray-200">
                  <thead className="bg-gray-50">
                    <tr>
                      <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                        広告名
                      </th>
                      <th className="px-4 py-3 text-right text-xs font-medium text-gray-500 uppercase tracking-wider">
                        支出
                      </th>
                      <th className="px-4 py-3 text-right text-xs font-medium text-gray-500 uppercase tracking-wider">
                        インプレッション
                      </th>
                      <th className="px-4 py-3 text-right text-xs font-medium text-gray-500 uppercase tracking-wider">
                        CV
                      </th>
                      <th className="px-4 py-3 text-right text-xs font-medium text-gray-500 uppercase tracking-wider">
                        現在CPA
                      </th>
                      <th className="px-4 py-3 text-right text-xs font-medium text-gray-500 uppercase tracking-wider">
                        ベストCPA
                      </th>
                      <th className="px-4 py-3 text-center text-xs font-medium text-gray-500 uppercase tracking-wider">
                        乖離度
                      </th>
                      <th className="px-4 py-3 text-center text-xs font-medium text-gray-500 uppercase tracking-wider">
                        レビュー
                      </th>
                    </tr>
                  </thead>
                  <tbody className="bg-white divide-y divide-gray-200">
                    {performances.map((performance) => {
                      const deviation = calculateDeviation(performance);
                      const currentCPA = performance.totalConversions > 0
                        ? performance.totalSpend / performance.totalConversions
                        : null;

                      return (
                        <tr
                          key={performance.id}
                          className="hover:bg-gray-50 cursor-pointer"
                          onClick={() => setSelectedPerformance(performance)}
                        >
                          <td className="px-4 py-4">
                            <div className="flex items-center gap-2">
                              {performance.impressionThresholdMet && (
                                <span className="w-2 h-2 bg-green-500 rounded-full" title="閾値達成" />
                              )}
                              <div>
                                <p className="text-sm font-medium text-gray-900 truncate max-w-xs">
                                  {performance.ad?.name || '広告名不明'}
                                </p>
                                <p className="text-xs text-gray-500">
                                  {performance.ad?.status || '-'}
                                </p>
                              </div>
                            </div>
                          </td>
                          <td className="px-4 py-4 text-right text-sm text-gray-900">
                            {formatCurrency(performance.totalSpend)}
                          </td>
                          <td className="px-4 py-4 text-right text-sm text-gray-900">
                            {formatNumber(performance.totalImpressions)}
                          </td>
                          <td className="px-4 py-4 text-right text-sm text-gray-900">
                            {performance.totalConversions}
                          </td>
                          <td className="px-4 py-4 text-right text-sm text-gray-900">
                            {currentCPA ? formatCurrency(currentCPA) : '-'}
                          </td>
                          <td className="px-4 py-4 text-right text-sm text-gray-900">
                            {performance.bestCPA ? formatCurrency(performance.bestCPA) : '-'}
                          </td>
                          <td className="px-4 py-4 text-center">
                            {deviation ? (
                              <span className={`inline-flex items-center gap-1 px-2 py-1 text-xs font-medium rounded-full border ${getDeviationStyle(deviation.severity)}`}>
                                {getDeviationIcon(deviation.severity)}
                                {deviation.percentage > 0 ? '+' : ''}{deviation.percentage.toFixed(1)}%
                              </span>
                            ) : (
                              <span className="text-xs text-gray-400">-</span>
                            )}
                          </td>
                          <td className="px-4 py-4 text-center text-sm text-gray-900">
                            {performance.reviewCount}回
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {/* 詳細モーダル */}
          {selectedPerformance && (
            <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
              <div className="bg-white rounded-lg w-full max-w-2xl max-h-[80vh] overflow-hidden flex flex-col">
                <div className="flex items-center justify-between p-4 border-b border-gray-200">
                  <h3 className="text-lg font-semibold text-gray-900">
                    パフォーマンス詳細
                  </h3>
                  <button
                    onClick={() => setSelectedPerformance(null)}
                    className="text-gray-400 hover:text-gray-600"
                  >
                    ✕
                  </button>
                </div>

                <div className="flex-1 overflow-y-auto p-4 space-y-4">
                  {/* 広告情報 */}
                  <div className="bg-gray-50 rounded-lg p-4">
                    <h4 className="text-sm font-medium text-gray-700 mb-2">広告情報</h4>
                    <p className="text-lg font-semibold text-gray-900">
                      {selectedPerformance.ad?.name || '広告名不明'}
                    </p>
                    <p className="text-sm text-gray-600">
                      ステータス: {selectedPerformance.ad?.status || '-'}
                    </p>
                  </div>

                  {/* 累計実績 */}
                  <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                    <div className="bg-blue-50 rounded-lg p-3">
                      <p className="text-xs text-blue-600">累計支出</p>
                      <p className="text-lg font-bold text-blue-900">
                        {formatCurrency(selectedPerformance.totalSpend)}
                      </p>
                    </div>
                    <div className="bg-blue-50 rounded-lg p-3">
                      <p className="text-xs text-blue-600">累計インプレッション</p>
                      <p className="text-lg font-bold text-blue-900">
                        {formatNumber(selectedPerformance.totalImpressions)}
                      </p>
                    </div>
                    <div className="bg-blue-50 rounded-lg p-3">
                      <p className="text-xs text-blue-600">累計クリック</p>
                      <p className="text-lg font-bold text-blue-900">
                        {formatNumber(selectedPerformance.totalClicks)}
                      </p>
                    </div>
                    <div className="bg-blue-50 rounded-lg p-3">
                      <p className="text-xs text-blue-600">累計CV</p>
                      <p className="text-lg font-bold text-blue-900">
                        {selectedPerformance.totalConversions}
                      </p>
                    </div>
                  </div>

                  {/* ベスト記録 */}
                  <div className="bg-green-50 rounded-lg p-4">
                    <h4 className="text-sm font-medium text-green-700 mb-3">ベスト記録</h4>
                    <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                      <div>
                        <p className="text-xs text-green-600">ベストCPA</p>
                        <p className="text-lg font-bold text-green-900">
                          {selectedPerformance.bestCPA ? formatCurrency(selectedPerformance.bestCPA) : '-'}
                        </p>
                        {selectedPerformance.bestCPADate && (
                          <p className="text-xs text-green-600">
                            {new Date(selectedPerformance.bestCPADate).toLocaleDateString('ja-JP')}
                          </p>
                        )}
                      </div>
                      <div>
                        <p className="text-xs text-green-600">ベストフロントCPO</p>
                        <p className="text-lg font-bold text-green-900">
                          {selectedPerformance.bestFrontCPO ? formatCurrency(selectedPerformance.bestFrontCPO) : '-'}
                        </p>
                        {selectedPerformance.bestFrontCPODate && (
                          <p className="text-xs text-green-600">
                            {new Date(selectedPerformance.bestFrontCPODate).toLocaleDateString('ja-JP')}
                          </p>
                        )}
                      </div>
                      <div>
                        <p className="text-xs text-green-600">ベストCTR</p>
                        <p className="text-lg font-bold text-green-900">
                          {selectedPerformance.bestCTR ? `${(selectedPerformance.bestCTR * 100).toFixed(2)}%` : '-'}
                        </p>
                        {selectedPerformance.bestCTRDate && (
                          <p className="text-xs text-green-600">
                            {new Date(selectedPerformance.bestCTRDate).toLocaleDateString('ja-JP')}
                          </p>
                        )}
                      </div>
                    </div>
                  </div>

                  {/* レビュー情報 */}
                  <div className="bg-gray-50 rounded-lg p-4">
                    <h4 className="text-sm font-medium text-gray-700 mb-3">レビュー情報</h4>
                    <div className="grid grid-cols-2 gap-4">
                      <div>
                        <p className="text-xs text-gray-600">レビュー回数</p>
                        <p className="text-lg font-bold text-gray-900">
                          {selectedPerformance.reviewCount}回
                        </p>
                      </div>
                      <div>
                        <p className="text-xs text-gray-600">前回レビュー時の支出</p>
                        <p className="text-lg font-bold text-gray-900">
                          {formatCurrency(selectedPerformance.spendAtLastReview)}
                        </p>
                      </div>
                      <div>
                        <p className="text-xs text-gray-600">前回レビュー日</p>
                        <p className="text-lg font-bold text-gray-900">
                          {selectedPerformance.lastReviewDate
                            ? new Date(selectedPerformance.lastReviewDate).toLocaleDateString('ja-JP')
                            : '-'}
                        </p>
                      </div>
                      <div>
                        <p className="text-xs text-gray-600">インプレッション閾値</p>
                        <p className="text-lg font-bold text-gray-900">
                          {selectedPerformance.impressionThresholdMet ? (
                            <span className="text-green-600">達成</span>
                          ) : (
                            <span className="text-gray-400">未達成</span>
                          )}
                        </p>
                      </div>
                    </div>
                  </div>
                </div>

                <div className="p-4 border-t border-gray-200">
                  <button
                    onClick={() => setSelectedPerformance(null)}
                    className="w-full px-4 py-2 bg-gray-900 text-white rounded-lg hover:bg-gray-800 transition-colors"
                  >
                    閉じる
                  </button>
                </div>
              </div>
            </div>
          )}

          {/* 説明セクション */}
          <div className="mt-6 bg-blue-50 border border-blue-200 rounded-lg p-6">
            <h3 className="text-sm font-semibold text-blue-900 mb-2">
              広告パフォーマンス管理について
            </h3>
            <ul className="text-sm text-blue-800 space-y-1 list-disc list-inside">
              <li>インプレッション10万達成後にCPAを記録開始します</li>
              <li>支出10万円ごとにレビュー通知が送信されます</li>
              <li>ベストCPAからの乖離度が20%以上で警告、50%以上で重要アラートとなります</li>
              <li>各広告のパフォーマンス推移を確認して、予算調整の参考にしてください</li>
            </ul>
          </div>
        </main>
      </div>
    </AppLayout>
  );
}

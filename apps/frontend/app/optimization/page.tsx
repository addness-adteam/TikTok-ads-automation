'use client';

import { useState, useEffect } from 'react';
import { Loader2, PlayCircle, CheckCircle, XCircle, AlertCircle } from 'lucide-react';
import { AppLayout } from '@/components/layout/AppLayout';

// API URLを取得（本番環境では固定URL、開発環境ではlocalhost）
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
  appeal?: {
    id: string;
    name: string;
  } | null;
}

interface OptimizationResult {
  advertiserId: string;
  success: boolean;
  totalAds?: number;
  evaluated?: number;
  decisions?: number;
  executed?: number;
  error?: string;
  detailedLogs?: Array<{
    adId: string;
    adName: string;
    action: 'PAUSE' | 'CONTINUE' | 'INCREASE_BUDGET';
    reason: string;
    currentBudget?: number;
    newBudget?: number;
    metrics: {
      cpa?: number;
      frontCpo?: number;
      cvCount?: number;
      frontSalesCount?: number;
      spend?: number;
      impressions?: number;
      clicks?: number;
    };
    targets: {
      targetCPA?: number;
      allowableCPA?: number;
      targetFrontCPO?: number;
      allowableFrontCPO?: number;
    };
  }>;
}

export default function OptimizationPage() {
  const [advertisers, setAdvertisers] = useState<Advertiser[]>([]);
  const [selectedAdvertiserIds, setSelectedAdvertiserIds] = useState<string[]>([]);
  const [isLoadingAdvertisers, setIsLoadingAdvertisers] = useState(true);
  const [isExecuting, setIsExecuting] = useState(false);
  const [executionResults, setExecutionResults] = useState<OptimizationResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Advertiser一覧を取得
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

      // レスポンス形式を確認して適切にデータをセット
      let advertisersData = [];
      if (result.success && result.data) {
        advertisersData = result.data;
      } else if (Array.isArray(result)) {
        // 旧形式（配列）にも対応
        advertisersData = result;
      } else {
        throw new Error(result.error || 'Failed to fetch advertisers');
      }

      // アクティブで訴求が紐付いているAdvertiserのみフィルタ
      const activeAdvertisers = advertisersData.filter(
        (adv: Advertiser) => adv.status === 'ACTIVE' && adv.appealId
      );
      setAdvertisers(activeAdvertisers);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load advertisers');
    } finally {
      setIsLoadingAdvertisers(false);
    }
  };

  // チェックボックスのトグル処理
  const toggleAdvertiserSelection = (advertiserId: string) => {
    setSelectedAdvertiserIds(prev => {
      if (prev.includes(advertiserId)) {
        return prev.filter(id => id !== advertiserId);
      } else {
        return [...prev, advertiserId];
      }
    });
  };

  // 全選択
  const selectAll = () => {
    setSelectedAdvertiserIds(advertisers.map(adv => adv.tiktokAdvertiserId));
  };

  // 全解除
  const deselectAll = () => {
    setSelectedAdvertiserIds([]);
  };

  const executeOptimization = async () => {
    if (selectedAdvertiserIds.length === 0) {
      setError('少なくとも1つのアカウントを選択してください');
      return;
    }

    setIsExecuting(true);
    setExecutionResults(null);
    setError(null);

    try {
      const apiUrl = getApiUrl();
      const response = await fetch(
        `${apiUrl}/api/optimization/execute-selected`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({ advertiserIds: selectedAdvertiserIds }),
        }
      );

      if (!response.ok) {
        throw new Error('Failed to execute optimization');
      }

      const result = await response.json();

      if (result.success) {
        setExecutionResults(result.data);
      } else {
        setError(result.error || 'Optimization failed');
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to execute optimization');
    } finally {
      setIsExecuting(false);
    }
  };

  const executeAllOptimization = async () => {
    setIsExecuting(true);
    setExecutionResults(null);
    setError(null);

    try {
      const apiUrl = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:4000';
      const response = await fetch(`${apiUrl}/api/optimization/execute`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({}),
      });

      if (!response.ok) {
        throw new Error('Failed to execute optimization');
      }

      const result = await response.json();

      if (result.success) {
        // 全体の結果を集計
        const totalResults: OptimizationResult = {
          advertiserId: 'all',
          success: true,
          totalAds: result.data.results.reduce((sum: number, r: any) => sum + (r.totalAds || 0), 0),
          evaluated: result.data.results.reduce((sum: number, r: any) => sum + (r.evaluated || 0), 0),
          decisions: result.data.results.reduce((sum: number, r: any) => sum + (r.decisions || 0), 0),
          executed: result.data.results.reduce((sum: number, r: any) => sum + (r.executed || 0), 0),
        };
        setExecutionResults(totalResults);
      } else {
        setError(result.error || 'Optimization failed');
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to execute optimization');
    } finally {
      setIsExecuting(false);
    }
  };

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
            <h1 className="text-2xl font-bold text-gray-900">予算調整システム</h1>
            <p className="text-sm text-gray-600 mt-1">
              広告パフォーマンスに基づいて自動で予算を最適化します
            </p>
          </div>
        </header>

        <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
          {/* エラー表示 */}
          {error && (
            <div className="mb-6 bg-red-50 border border-red-200 rounded-lg p-4 flex items-start gap-3">
              <XCircle className="w-5 h-5 text-red-600 flex-shrink-0 mt-0.5" />
              <div>
                <h3 className="text-sm font-semibold text-red-900 mb-1">エラー</h3>
                <p className="text-sm text-red-700">{error}</p>
              </div>
            </div>
          )}

          {/* 成功表示 */}
          {executionResults && executionResults.success && (
            <div className="mb-6 bg-green-50 border border-green-200 rounded-lg p-4 flex items-start gap-3">
              <CheckCircle className="w-5 h-5 text-green-600 flex-shrink-0 mt-0.5" />
              <div className="flex-1">
                <h3 className="text-sm font-semibold text-green-900 mb-1">
                  予算調整が完了しました
                  {(executionResults as any).totalAdvertisers && (
                    <span className="ml-2 text-xs font-normal">
                      ({(executionResults as any).totalAdvertisers}アカウント)
                    </span>
                  )}
                </h3>
                <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mt-3">
                  <div>
                    <p className="text-xs text-green-600">対象広告数</p>
                    <p className="text-lg font-bold text-green-900">
                      {executionResults.totalAds || 0}
                    </p>
                  </div>
                  <div>
                    <p className="text-xs text-green-600">評価した広告</p>
                    <p className="text-lg font-bold text-green-900">
                      {executionResults.evaluated || 0}
                    </p>
                  </div>
                  <div>
                    <p className="text-xs text-green-600">判断数</p>
                    <p className="text-lg font-bold text-green-900">
                      {executionResults.decisions || 0}
                    </p>
                  </div>
                  <div>
                    <p className="text-xs text-green-600">実行数</p>
                    <p className="text-lg font-bold text-green-900">
                      {executionResults.executed || 0}
                    </p>
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* 詳細ログ表示 */}
          {executionResults && executionResults.detailedLogs && executionResults.detailedLogs.length > 0 && (
            <div className="mb-6 bg-white border border-gray-200 rounded-lg p-6">
              <h3 className="text-lg font-semibold text-gray-900 mb-4">
                個別広告結果 (全{executionResults.detailedLogs.length}件)
              </h3>
              <div className="space-y-4">
                {executionResults.detailedLogs.map((log, index) => {
                  const actionIcon = log.action === 'PAUSE' ? '⏸️' :
                                    log.action === 'INCREASE_BUDGET' ? '📈' : '✅';
                  const actionText = log.action === 'PAUSE' ? 'pause' :
                                    log.action === 'INCREASE_BUDGET' ? 'increase' : 'maintain';
                  const actionColor = log.action === 'PAUSE' ? 'text-red-700' :
                                     log.action === 'INCREASE_BUDGET' ? 'text-blue-700' : 'text-green-700';

                  return (
                    <div key={index} className="border border-gray-200 rounded-lg p-4 bg-gray-50">
                      <div className="flex items-start gap-2 mb-2">
                        <span className="text-xl">{actionIcon}</span>
                        <div className="flex-1">
                          <p className="font-medium text-gray-900">広告: {log.adName}</p>
                          <p className={`text-sm font-semibold ${actionColor} mt-1`}>
                            判定: {actionText}
                            {log.currentBudget !== undefined && log.newBudget !== undefined && (
                              <span className="ml-2">
                                (¥{log.currentBudget.toLocaleString()} → ¥{log.newBudget.toLocaleString()})
                              </span>
                            )}
                          </p>
                          <p className="text-sm text-gray-700 mt-1">理由: {log.reason}</p>

                          <div className="mt-2 text-sm text-gray-600 space-y-1">
                            {log.metrics.cpa !== undefined && (
                              <div>
                                CPA: ¥{Math.round(log.metrics.cpa).toLocaleString()}
                                {log.targets.targetCPA && (
                                  <span className="ml-2">(目標¥{Math.round(log.targets.targetCPA).toLocaleString()})</span>
                                )}
                              </div>
                            )}
                            {log.metrics.frontCpo !== undefined && (
                              <div>
                                フロントCPO: ¥{Math.round(log.metrics.frontCpo).toLocaleString()}
                                {log.targets.targetFrontCPO && (
                                  <span className="ml-2">(目標¥{Math.round(log.targets.targetFrontCPO).toLocaleString()})</span>
                                )}
                              </div>
                            )}
                            {(log.metrics.cvCount !== undefined || log.metrics.frontSalesCount !== undefined) && (
                              <div>
                                実績: CV{log.metrics.cvCount || 0}件, フロント{log.metrics.frontSalesCount || 0}件
                              </div>
                            )}
                            {log.metrics.spend !== undefined && (
                              <div>
                                メトリクス: 支出¥{Math.round(log.metrics.spend).toLocaleString()}
                                {log.metrics.impressions !== undefined && (
                                  <span className="ml-2">/ Imp {log.metrics.impressions.toLocaleString()}</span>
                                )}
                                {log.metrics.clicks !== undefined && (
                                  <span className="ml-2">/ Click {log.metrics.clicks.toLocaleString()}</span>
                                )}
                              </div>
                            )}
                          </div>
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {/* Advertiser選択 */}
          <div className="bg-white rounded-lg border border-gray-200 p-6 mb-6">
            <h2 className="text-lg font-semibold text-gray-900 mb-4">
              アカウント選択
            </h2>

            {advertisers.length === 0 ? (
              <div className="text-center py-8">
                <AlertCircle className="w-12 h-12 text-gray-400 mx-auto mb-3" />
                <p className="text-gray-600">
                  アクティブで訴求が紐付いているアカウントがありません
                </p>
              </div>
            ) : (
              <div className="space-y-4">
                <div>
                  <div className="flex items-center justify-between mb-3">
                    <label className="block text-sm font-medium text-gray-700">
                      最適化するアカウントを選択（複数選択可）
                    </label>
                    <div className="flex gap-2">
                      <button
                        onClick={selectAll}
                        disabled={isExecuting}
                        className="text-sm text-blue-600 hover:text-blue-700 underline disabled:text-gray-400"
                      >
                        全選択
                      </button>
                      <span className="text-gray-400">|</span>
                      <button
                        onClick={deselectAll}
                        disabled={isExecuting}
                        className="text-sm text-blue-600 hover:text-blue-700 underline disabled:text-gray-400"
                      >
                        全解除
                      </button>
                    </div>
                  </div>

                  <div className="border border-gray-300 rounded-lg p-3 max-h-64 overflow-y-auto space-y-2">
                    {advertisers.map((advertiser) => (
                      <label
                        key={advertiser.id}
                        className="flex items-start gap-3 p-2 hover:bg-gray-50 rounded cursor-pointer"
                      >
                        <input
                          type="checkbox"
                          checked={selectedAdvertiserIds.includes(advertiser.tiktokAdvertiserId)}
                          onChange={() => toggleAdvertiserSelection(advertiser.tiktokAdvertiserId)}
                          disabled={isExecuting}
                          className="mt-1 h-4 w-4 text-blue-600 focus:ring-blue-500 border-gray-300 rounded"
                        />
                        <div className="flex-1">
                          <div className="text-sm font-medium text-gray-900">
                            {advertiser.name}
                          </div>
                          <div className="text-xs text-gray-500">
                            {advertiser.tiktokAdvertiserId}
                            {advertiser.appeal && ` - ${advertiser.appeal.name}`}
                          </div>
                        </div>
                      </label>
                    ))}
                  </div>

                  <div className="mt-2 text-sm text-gray-600">
                    {selectedAdvertiserIds.length}件のアカウントを選択中
                  </div>
                </div>

                <div className="flex gap-3">
                  <div className="flex-1">
                    <button
                      onClick={executeOptimization}
                      disabled={selectedAdvertiserIds.length === 0 || isExecuting}
                      className="w-full flex items-center justify-center gap-2 px-6 py-3 bg-gray-900 text-white rounded-lg font-medium hover:bg-gray-800 disabled:bg-gray-300 disabled:cursor-not-allowed transition-colors"
                    >
                      {isExecuting ? (
                        <>
                          <Loader2 className="w-5 h-5 animate-spin" />
                          実行中...
                        </>
                      ) : (
                        <>
                          <PlayCircle className="w-5 h-5" />
                          選択したアカウントで実行
                        </>
                      )}
                    </button>
                  </div>

                  <div className="flex-1">
                    <button
                      onClick={executeAllOptimization}
                      disabled={isExecuting}
                      className="w-full flex items-center justify-center gap-2 px-6 py-3 bg-gray-900 text-white rounded-lg font-medium hover:bg-gray-800 disabled:bg-gray-300 disabled:cursor-not-allowed transition-colors"
                    >
                      {isExecuting ? (
                        <>
                          <Loader2 className="w-5 h-5 animate-spin" />
                          実行中...
                        </>
                      ) : (
                        <>
                          <PlayCircle className="w-5 h-5" />
                          全アカウントで実行
                        </>
                      )}
                    </button>
                  </div>
                </div>
              </div>
            )}
          </div>

          {/* 説明セクション */}
          <div className="bg-blue-50 border border-blue-200 rounded-lg p-6">
            <h3 className="text-sm font-semibold text-blue-900 mb-2">
              予算調整の仕組み
            </h3>
            <ul className="text-sm text-blue-800 space-y-1 list-disc list-inside">
              <li>過去7日間の広告パフォーマンスを評価します</li>
              <li>5000インプレッション未満の広告は継続配信</li>
              <li>
                フロントCPOが目標値以下の広告は予算を30%増額
              </li>
              <li>
                フロントCPOが許容値を超過した広告は配信停止
              </li>
              <li>
                広告セット単位で予算を調整します
              </li>
            </ul>
          </div>
        </main>
      </div>
    </AppLayout>
  );
}

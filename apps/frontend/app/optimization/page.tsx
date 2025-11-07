'use client';

import { useState, useEffect } from 'react';
import { Loader2, PlayCircle, CheckCircle, XCircle, AlertCircle } from 'lucide-react';
import { AppLayout } from '@/components/layout/AppLayout';

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
}

export default function OptimizationPage() {
  const [advertisers, setAdvertisers] = useState<Advertiser[]>([]);
  const [selectedAdvertiserId, setSelectedAdvertiserId] = useState<string>('');
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

  const executeOptimization = async () => {
    if (!selectedAdvertiserId) {
      setError('アカウントを選択してください');
      return;
    }

    setIsExecuting(true);
    setExecutionResults(null);
    setError(null);

    try {
      const apiUrl = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:4000';
      const response = await fetch(
        `${apiUrl}/api/optimization/execute/${selectedAdvertiserId}`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({}),
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
                  <label
                    htmlFor="advertiser-select"
                    className="block text-sm font-medium text-gray-700 mb-2"
                  >
                    最適化するアカウントを選択
                  </label>
                  <select
                    id="advertiser-select"
                    value={selectedAdvertiserId}
                    onChange={(e) => setSelectedAdvertiserId(e.target.value)}
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                    disabled={isExecuting}
                  >
                    <option value="">-- アカウントを選択 --</option>
                    {advertisers.map((advertiser) => (
                      <option
                        key={advertiser.id}
                        value={advertiser.tiktokAdvertiserId}
                      >
                        {advertiser.name} ({advertiser.tiktokAdvertiserId})
                        {advertiser.appeal && ` - ${advertiser.appeal.name}`}
                      </option>
                    ))}
                  </select>
                </div>

                <div className="flex gap-3">
                  <button
                    onClick={executeOptimization}
                    disabled={!selectedAdvertiserId || isExecuting}
                    className="flex-1 flex items-center justify-center gap-2 px-6 py-3 bg-blue-600 text-white rounded-lg font-medium hover:bg-blue-700 disabled:bg-gray-300 disabled:cursor-not-allowed transition-colors"
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

                  <button
                    onClick={executeAllOptimization}
                    disabled={isExecuting}
                    className="flex-1 flex items-center justify-center gap-2 px-6 py-3 bg-purple-600 text-white rounded-lg font-medium hover:bg-purple-700 disabled:bg-gray-300 disabled:cursor-not-allowed transition-colors"
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

'use client';

import { useState, useEffect } from 'react';
import {
  Loader2,
  AlertTriangle,
  AlertCircle,
  RefreshCw,
  Users,
  FileText,
  PauseCircle,
  Percent,
  ChevronDown,
  ChevronRight,
} from 'lucide-react';
import { AppLayout } from '@/components/layout/AppLayout';
import {
  getCreatorStopRates,
  CreatorStopRate,
  CreatorStopRateResponse,
} from '@/lib/api';

export default function CreatorStopRatePage() {
  const [data, setData] = useState<CreatorStopRateResponse['data'] | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [expandedCreator, setExpandedCreator] = useState<string | null>(null);
  const [days, setDays] = useState(30);

  const fetchData = async () => {
    setIsLoading(true);
    setError(null);
    try {
      const response = await getCreatorStopRates({ days });
      setData(response.data);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'データの取得に失敗しました');
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    fetchData();
  }, [days]);

  const getStopRateColor = (rate: number) => {
    if (rate > 90) return 'text-red-700';
    if (rate > 80) return 'text-orange-600';
    if (rate > 50) return 'text-yellow-600';
    return 'text-green-600';
  };

  const getStopRateBarColor = (rate: number) => {
    if (rate > 90) return 'bg-red-500';
    if (rate > 80) return 'bg-orange-500';
    if (rate > 50) return 'bg-yellow-500';
    return 'bg-green-500';
  };

  const getRowBg = (creator: CreatorStopRate) => {
    if (creator.isAlert) return 'bg-red-50';
    return '';
  };

  return (
    <AppLayout>
      <div className="min-h-screen bg-gray-50">
        {/* Header */}
        <header className="bg-white border-b border-gray-200">
          <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-4">
            <div className="flex items-center justify-between">
              <div>
                <h1 className="text-2xl font-bold text-gray-900">
                  制作者別 広告停止率
                </h1>
                <p className="text-sm text-gray-600 mt-1">
                  CR制作者ごとの広告停止率を可視化し、品質改善に活用します
                </p>
              </div>
              <div className="flex items-center gap-3">
                <select
                  value={days}
                  onChange={(e) => setDays(parseInt(e.target.value, 10))}
                  className="px-3 py-2 border border-gray-300 rounded-lg text-sm"
                >
                  <option value={7}>直近7日</option>
                  <option value={14}>直近14日</option>
                  <option value={30}>直近30日</option>
                  <option value={60}>直近60日</option>
                </select>
                <button
                  onClick={fetchData}
                  disabled={isLoading}
                  className="flex items-center gap-2 px-4 py-2 bg-gray-900 text-white rounded-lg hover:bg-gray-800 disabled:bg-gray-300 transition-colors"
                >
                  <RefreshCw
                    className={`w-4 h-4 ${isLoading ? 'animate-spin' : ''}`}
                  />
                  更新
                </button>
              </div>
            </div>
          </div>
        </header>

        <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
          {/* エラー表示 */}
          {error && (
            <div className="mb-6 bg-red-50 border border-red-200 rounded-lg p-4 flex items-start gap-3">
              <AlertCircle className="w-5 h-5 text-red-600 flex-shrink-0 mt-0.5" />
              <div>
                <h3 className="text-sm font-semibold text-red-900 mb-1">
                  エラー
                </h3>
                <p className="text-sm text-red-700">{error}</p>
              </div>
            </div>
          )}

          {isLoading ? (
            <div className="bg-white rounded-lg border border-gray-200 p-12 text-center">
              <Loader2 className="w-8 h-8 text-blue-600 animate-spin mx-auto mb-4" />
              <p className="text-gray-600">データを読み込み中...</p>
            </div>
          ) : data ? (
            <>
              {/* サマリーカード */}
              <div className="grid grid-cols-1 md:grid-cols-4 gap-4 mb-6">
                <div className="bg-white rounded-lg border border-gray-200 p-4">
                  <div className="flex items-center gap-3">
                    <div className="p-2 bg-blue-100 rounded-lg">
                      <Users className="w-5 h-5 text-blue-600" />
                    </div>
                    <div>
                      <p className="text-sm text-gray-600">制作者数</p>
                      <p className="text-2xl font-bold text-gray-900">
                        {data.summary.totalCreators}
                      </p>
                    </div>
                  </div>
                </div>

                <div className="bg-white rounded-lg border border-gray-200 p-4">
                  <div className="flex items-center gap-3">
                    <div className="p-2 bg-green-100 rounded-lg">
                      <FileText className="w-5 h-5 text-green-600" />
                    </div>
                    <div>
                      <p className="text-sm text-gray-600">総CR数</p>
                      <p className="text-2xl font-bold text-gray-900">
                        {data.summary.totalCRs}
                      </p>
                      <p className="text-xs text-gray-400">
                        ({data.summary.totalAds}広告)
                      </p>
                    </div>
                  </div>
                </div>

                <div className="bg-white rounded-lg border border-gray-200 p-4">
                  <div className="flex items-center gap-3">
                    <div className="p-2 bg-orange-100 rounded-lg">
                      <PauseCircle className="w-5 h-5 text-orange-600" />
                    </div>
                    <div>
                      <p className="text-sm text-gray-600">総停止数</p>
                      <p className="text-2xl font-bold text-gray-900">
                        {data.summary.totalPaused}
                      </p>
                    </div>
                  </div>
                </div>

                <div className="bg-white rounded-lg border border-gray-200 p-4">
                  <div className="flex items-center gap-3">
                    <div className="p-2 bg-purple-100 rounded-lg">
                      <Percent className="w-5 h-5 text-purple-600" />
                    </div>
                    <div>
                      <p className="text-sm text-gray-600">全体停止率</p>
                      <p
                        className={`text-2xl font-bold ${getStopRateColor(data.summary.overallStopRate)}`}
                      >
                        {data.summary.overallStopRate}%
                      </p>
                    </div>
                  </div>
                </div>
              </div>

              {/* アラートバナー */}
              {data.summary.alertCount > 0 && (
                <div className="mb-6 bg-red-50 border border-red-300 rounded-lg p-4 flex items-start gap-3">
                  <AlertTriangle className="w-5 h-5 text-red-600 flex-shrink-0 mt-0.5" />
                  <div>
                    <h3 className="text-sm font-semibold text-red-900 mb-1">
                      停止率90%超えの制作者が{data.summary.alertCount}
                      名います
                    </h3>
                    <p className="text-sm text-red-700">
                      {data.creators
                        .filter((c) => c.isAlert)
                        .map((c) => c.creatorName)
                        .join('、')}
                      の停止率が90%を超えています。CR品質の確認を推奨します。
                    </p>
                  </div>
                </div>
              )}

              {/* 期間表示 */}
              <div className="mb-4 text-sm text-gray-500">
                集計期間: {data.period.from} ~ {data.period.to}（
                {data.period.days}日間）
              </div>

              {/* メインテーブル */}
              {data.creators.length === 0 ? (
                <div className="bg-white rounded-lg border border-gray-200 p-12 text-center">
                  <Users className="w-12 h-12 text-gray-400 mx-auto mb-4" />
                  <p className="text-gray-600">
                    対象期間に該当する広告データがありません
                  </p>
                </div>
              ) : (
                <div className="bg-white rounded-lg border border-gray-200 overflow-hidden">
                  <div className="overflow-x-auto">
                    <table className="min-w-full divide-y divide-gray-200">
                      <thead className="bg-gray-50">
                        <tr>
                          <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider w-8">
                            &nbsp;
                          </th>
                          <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                            制作者名
                          </th>
                          <th className="px-4 py-3 text-right text-xs font-medium text-gray-500 uppercase tracking-wider">
                            CR数
                          </th>
                          <th className="px-4 py-3 text-right text-xs font-medium text-gray-500 uppercase tracking-wider">
                            停止数
                          </th>
                          <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider min-w-[200px]">
                            停止率
                          </th>
                          <th className="px-4 py-3 text-center text-xs font-medium text-gray-500 uppercase tracking-wider">
                            ステータス
                          </th>
                        </tr>
                      </thead>
                      <tbody className="bg-white divide-y divide-gray-200">
                        {data.creators.map((creator) => {
                          const isExpanded =
                            expandedCreator === creator.creatorName;

                          return (
                            <ExpandableRow
                              key={creator.creatorName}
                              creator={creator}
                              isExpanded={isExpanded}
                              onToggle={() =>
                                setExpandedCreator(
                                  isExpanded ? null : creator.creatorName,
                                )
                              }
                              getStopRateColor={getStopRateColor}
                              getStopRateBarColor={getStopRateBarColor}
                              getRowBg={getRowBg}
                            />
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}

              {/* 説明セクション */}
              <div className="mt-6 bg-blue-50 border border-blue-200 rounded-lg p-6">
                <h3 className="text-sm font-semibold text-blue-900 mb-2">
                  停止率レポートについて
                </h3>
                <ul className="text-sm text-blue-800 space-y-1 list-disc list-inside">
                  <li>
                    CR数: 同一CR名の広告をグループ化した数
                  </li>
                  <li>
                    停止数: 同一CRの全広告が停止された場合のみカウント（1つでも稼働中なら停止扱いにしない）
                  </li>
                  <li>
                    停止率90%超えの制作者はアラート表示されます
                  </li>
                  <li>
                    対象アカウント: AI導線 + スキルプラス導線
                  </li>
                </ul>
              </div>
            </>
          ) : null}
        </main>
      </div>
    </AppLayout>
  );
}

function ExpandableRow({
  creator,
  isExpanded,
  onToggle,
  getStopRateColor,
  getStopRateBarColor,
  getRowBg,
}: {
  creator: CreatorStopRate;
  isExpanded: boolean;
  onToggle: () => void;
  getStopRateColor: (rate: number) => string;
  getStopRateBarColor: (rate: number) => string;
  getRowBg: (creator: CreatorStopRate) => string;
}) {
  return (
    <>
      <tr
        className={`hover:bg-gray-50 cursor-pointer ${getRowBg(creator)}`}
        onClick={onToggle}
      >
        <td className="px-4 py-4">
          {isExpanded ? (
            <ChevronDown className="w-4 h-4 text-gray-500" />
          ) : (
            <ChevronRight className="w-4 h-4 text-gray-500" />
          )}
        </td>
        <td className="px-4 py-4">
          <div className="flex items-center gap-2">
            {creator.isAlert && (
              <AlertTriangle className="w-4 h-4 text-red-500" />
            )}
            <span className="text-sm font-medium text-gray-900">
              {creator.creatorName}
            </span>
          </div>
        </td>
        <td className="px-4 py-4 text-right text-sm text-gray-900">
          {creator.crCount}
        </td>
        <td className="px-4 py-4 text-right text-sm text-gray-900">
          {creator.pauseCount}
        </td>
        <td className="px-4 py-4">
          <div className="flex items-center gap-3">
            <div className="flex-1 bg-gray-200 rounded-full h-2.5">
              <div
                className={`h-2.5 rounded-full ${getStopRateBarColor(creator.stopRate)}`}
                style={{ width: `${Math.min(creator.stopRate, 100)}%` }}
              />
            </div>
            <span
              className={`text-sm font-semibold w-14 text-right ${getStopRateColor(creator.stopRate)}`}
            >
              {creator.stopRate}%
            </span>
          </div>
        </td>
        <td className="px-4 py-4 text-center">
          {creator.isAlert ? (
            <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-red-100 text-red-800">
              要確認
            </span>
          ) : (
            <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-green-100 text-green-800">
              正常
            </span>
          )}
        </td>
      </tr>

      {/* 展開時: CR別広告一覧 */}
      {isExpanded && (
        <tr>
          <td colSpan={6} className="px-0 py-0">
            <div className="bg-gray-50 px-8 py-4 border-t border-gray-100">
              <h4 className="text-xs font-medium text-gray-500 uppercase tracking-wider mb-3">
                {creator.creatorName} のCR一覧（{creator.crCount}CR / {creator.adCount}広告）
              </h4>
              {creator.crs.map((cr) => (
                <div key={cr.crName} className="mb-3 last:mb-0">
                  <div className="flex items-center gap-2 mb-1">
                    <span className="text-sm font-medium text-gray-800">
                      {cr.crName}
                    </span>
                    <span className="text-xs text-gray-400">
                      ({cr.ads.length}広告)
                    </span>
                    {cr.isFullyPaused ? (
                      <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-red-100 text-red-700">
                        全停止
                      </span>
                    ) : (
                      <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-green-100 text-green-700">
                        稼働中
                      </span>
                    )}
                  </div>
                  <div className="overflow-x-auto ml-4">
                    <table className="min-w-full divide-y divide-gray-200">
                      <thead>
                        <tr>
                          <th className="px-3 py-1 text-left text-xs font-medium text-gray-500">
                            広告名
                          </th>
                          <th className="px-3 py-1 text-left text-xs font-medium text-gray-500">
                            広告ID
                          </th>
                          <th className="px-3 py-1 text-center text-xs font-medium text-gray-500">
                            ステータス
                          </th>
                          <th className="px-3 py-1 text-center text-xs font-medium text-gray-500">
                            自動停止
                          </th>
                          <th className="px-3 py-1 text-left text-xs font-medium text-gray-500">
                            停止日時
                          </th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-gray-100">
                        {cr.ads.map((ad) => (
                          <tr key={ad.adTiktokId} className="hover:bg-gray-100">
                            <td className="px-3 py-1.5 text-sm text-gray-900 max-w-xs truncate">
                              {ad.adName}
                            </td>
                            <td className="px-3 py-1.5 text-xs text-gray-500 font-mono">
                              {ad.adTiktokId}
                            </td>
                            <td className="px-3 py-1.5 text-center">
                              <span
                                className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-medium ${
                                  ad.status === 'ENABLE' || ad.status === 'STATUS_ENABLE'
                                    ? 'bg-green-100 text-green-700'
                                    : 'bg-gray-100 text-gray-600'
                                }`}
                              >
                                {ad.status === 'ENABLE' || ad.status === 'STATUS_ENABLE'
                                  ? '配信中'
                                  : '停止'}
                              </span>
                            </td>
                            <td className="px-3 py-1.5 text-center">
                              {ad.isPaused ? (
                                <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-red-100 text-red-700">
                                  停止済
                                </span>
                              ) : (
                                <span className="text-xs text-gray-400">-</span>
                              )}
                            </td>
                            <td className="px-3 py-1.5 text-sm text-gray-500">
                              {ad.pauseDate
                                ? new Date(ad.pauseDate).toLocaleString('ja-JP')
                                : '-'}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              ))}
            </div>
          </td>
        </tr>
      )}
    </>
  );
}

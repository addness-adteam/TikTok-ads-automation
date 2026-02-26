'use client';

import { useState, useEffect } from 'react';
import { Loader2, AlertCircle, Plus, Edit2, Trash2, Check, X, ShieldOff, Power } from 'lucide-react';
import { AppLayout } from '@/components/layout/AppLayout';
import {
  getBudgetExclusions,
  createBudgetExclusion,
  updateBudgetExclusion,
  deleteBudgetExclusion,
  BudgetOptimizationExclusion,
} from '@/lib/api';

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

interface Ad {
  id: string;
  name: string;
  status: string;
  tiktokAdId?: string;
}

// CR名をパース（YYMMDD/制作者名/CR名/LP名 → CR名抽出）
function parseCreativeName(adName: string): string | null {
  const parts = adName.split('/');
  if (parts.length < 4) return null;
  return parts.slice(2, parts.length - 1).join('/');
}

export default function ExclusionsPage() {
  // アカウント選択関連
  const [advertisers, setAdvertisers] = useState<Advertiser[]>([]);
  const [selectedAdvertiserId, setSelectedAdvertiserId] = useState<string | null>(null);
  const [isLoadingAdvertisers, setIsLoadingAdvertisers] = useState(true);

  const [exclusions, setExclusions] = useState<BudgetOptimizationExclusion[]>([]);
  const [ads, setAds] = useState<Ad[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [isLoadingAds, setIsLoadingAds] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // 新規作成モーダル
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [createForm, setCreateForm] = useState({
    adId: '',
    creativeName: '',
    reason: '',
    expiresAt: '',
  });
  const [isCreating, setIsCreating] = useState(false);

  // 編集モーダル
  const [editingExclusion, setEditingExclusion] = useState<BudgetOptimizationExclusion | null>(null);
  const [editForm, setEditForm] = useState({
    reason: '',
    enabled: true,
    expiresAt: '',
  });
  const [isUpdating, setIsUpdating] = useState(false);

  // 削除確認
  const [deletingExclusionId, setDeletingExclusionId] = useState<string | null>(null);
  const [isDeleting, setIsDeleting] = useState(false);

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

  // 除外一覧取得
  const fetchExclusions = async () => {
    setIsLoading(true);
    setError(null);

    try {
      const data = await getBudgetExclusions();
      // 選択中のアカウントに紐づく除外 + 全アカウント対象の除外を表示
      const filtered = data.filter(
        (ex) => ex.advertiserId === selectedAdvertiserId || ex.advertiserId === null
      );
      setExclusions(filtered);
    } catch (err) {
      setError(err instanceof Error ? err.message : '除外設定の取得に失敗しました');
    } finally {
      setIsLoading(false);
    }
  };

  // 広告一覧取得
  const fetchAds = async () => {
    if (!selectedAdvertiserId) return;

    setIsLoadingAds(true);
    try {
      const response = await fetch(`${getApiUrl()}/api/advertisers/${selectedAdvertiserId}/ads`);
      if (!response.ok) throw new Error('Failed to fetch ads');
      const result = await response.json();
      const allAds: Ad[] = result.data || [];
      // 配信中のみフィルタ
      const deliveryAds = allAds.filter((ad) => ad.status && ad.status.includes('DELIVERY'));
      setAds(deliveryAds);
    } catch (err) {
      console.error('Failed to fetch ads:', err);
    } finally {
      setIsLoadingAds(false);
    }
  };

  useEffect(() => {
    if (selectedAdvertiserId) {
      fetchExclusions();
    }
  }, [selectedAdvertiserId]);

  // 既に除外済みのCR名を取得
  const excludedCreativeNames = new Set(exclusions.map((ex) => ex.creativeName));

  // 既に除外済みのCR名と同じ広告をドロップダウンから除外
  const availableAds = ads.filter((ad) => {
    const crName = parseCreativeName(ad.name);
    return crName && !excludedCreativeNames.has(crName);
  });

  // 広告選択時にCR名を自動パース
  const handleAdSelect = (adId: string) => {
    const selectedAd = ads.find((ad) => ad.id === adId);
    const creativeName = selectedAd ? parseCreativeName(selectedAd.name) || '' : '';
    setCreateForm((prev) => ({ ...prev, adId, creativeName }));
  };

  // 新規作成
  const handleCreate = async () => {
    if (!createForm.creativeName.trim()) {
      setError('CR名を入力してください');
      return;
    }

    setIsCreating(true);
    setError(null);

    try {
      const newExclusion = await createBudgetExclusion({
        creativeName: createForm.creativeName.trim(),
        advertiserId: selectedAdvertiserId || undefined,
        reason: createForm.reason || undefined,
        expiresAt: createForm.expiresAt || undefined,
      });

      setExclusions((prev) => [...prev, newExclusion]);
      setShowCreateModal(false);
      setCreateForm({ adId: '', creativeName: '', reason: '', expiresAt: '' });
    } catch (err) {
      setError(err instanceof Error ? err.message : '除外設定の作成に失敗しました');
    } finally {
      setIsCreating(false);
    }
  };

  // 更新
  const handleUpdate = async () => {
    if (!editingExclusion) return;

    setIsUpdating(true);
    setError(null);

    try {
      const updated = await updateBudgetExclusion(editingExclusion.id, {
        reason: editForm.reason || undefined,
        enabled: editForm.enabled,
        expiresAt: editForm.expiresAt || null,
      });

      setExclusions((prev) =>
        prev.map((ex) => (ex.id === editingExclusion.id ? updated : ex))
      );
      setEditingExclusion(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : '除外設定の更新に失敗しました');
    } finally {
      setIsUpdating(false);
    }
  };

  // 削除
  const handleDelete = async (id: string) => {
    setIsDeleting(true);
    setError(null);

    try {
      await deleteBudgetExclusion(id);
      setExclusions((prev) => prev.filter((ex) => ex.id !== id));
      setDeletingExclusionId(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : '除外設定の削除に失敗しました');
    } finally {
      setIsDeleting(false);
    }
  };

  // 有効/無効トグル
  const toggleEnabled = async (exclusion: BudgetOptimizationExclusion) => {
    try {
      const updated = await updateBudgetExclusion(exclusion.id, { enabled: !exclusion.enabled });
      setExclusions((prev) =>
        prev.map((ex) => (ex.id === exclusion.id ? updated : ex))
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : '更新に失敗しました');
    }
  };

  // 編集モーダルを開く
  const openEditModal = (exclusion: BudgetOptimizationExclusion) => {
    setEditingExclusion(exclusion);
    setEditForm({
      reason: exclusion.reason || '',
      enabled: exclusion.enabled,
      expiresAt: exclusion.expiresAt ? exclusion.expiresAt.split('T')[0] : '',
    });
  };

  // 新規作成モーダルを開く
  const openCreateModal = () => {
    setShowCreateModal(true);
    setCreateForm({ adId: '', creativeName: '', reason: '', expiresAt: '' });
    fetchAds();
  };

  // 日付フォーマット
  const formatDate = (dateString: string | null | undefined) => {
    if (!dateString) return '-';
    return new Date(dateString).toLocaleDateString('ja-JP');
  };

  // 有効期限のステータス判定
  const isExpired = (expiresAt: string | null) => {
    if (!expiresAt) return false;
    return new Date(expiresAt) < new Date();
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
                <h1 className="text-2xl font-bold text-gray-900">CR除外設定</h1>
                <p className="text-sm text-gray-600 mt-1">
                  特定のCRを予算調整V2の全判定（増額・停止・予算減額）から除外できます
                </p>
              </div>
              <button
                onClick={openCreateModal}
                disabled={!selectedAdvertiserId}
                className="flex items-center gap-2 px-4 py-2 bg-gray-900 text-white rounded-lg hover:bg-gray-800 disabled:bg-gray-300 transition-colors"
              >
                <Plus className="w-4 h-4" />
                新規追加
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
          ) : exclusions.length === 0 ? (
            <div className="bg-white rounded-lg border border-gray-200 p-12 text-center">
              <ShieldOff className="w-12 h-12 text-gray-400 mx-auto mb-4" />
              <p className="text-gray-600">CR除外設定がありません</p>
              <p className="text-sm text-gray-500 mt-2">
                「新規追加」ボタンから除外するCRを設定できます
              </p>
              <button
                onClick={openCreateModal}
                className="mt-4 inline-flex items-center gap-2 px-4 py-2 bg-gray-900 text-white rounded-lg hover:bg-gray-800 transition-colors"
              >
                <Plus className="w-4 h-4" />
                新規追加
              </button>
            </div>
          ) : (
            /* 除外設定一覧 */
            <div className="bg-white rounded-lg border border-gray-200 overflow-hidden">
              <div className="overflow-x-auto">
                <table className="min-w-full divide-y divide-gray-200">
                  <thead className="bg-gray-50">
                    <tr>
                      <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                        CR名
                      </th>
                      <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                        除外理由
                      </th>
                      <th className="px-4 py-3 text-center text-xs font-medium text-gray-500 uppercase tracking-wider">
                        有効期限
                      </th>
                      <th className="px-4 py-3 text-center text-xs font-medium text-gray-500 uppercase tracking-wider">
                        対象
                      </th>
                      <th className="px-4 py-3 text-center text-xs font-medium text-gray-500 uppercase tracking-wider">
                        ステータス
                      </th>
                      <th className="px-4 py-3 text-center text-xs font-medium text-gray-500 uppercase tracking-wider">
                        操作
                      </th>
                    </tr>
                  </thead>
                  <tbody className="bg-white divide-y divide-gray-200">
                    {exclusions.map((exclusion) => {
                      const expired = isExpired(exclusion.expiresAt);
                      return (
                        <tr key={exclusion.id} className="hover:bg-gray-50">
                          <td className="px-4 py-4">
                            <p className="text-sm font-medium text-gray-900">
                              {exclusion.creativeName}
                            </p>
                          </td>
                          <td className="px-4 py-4">
                            <p className="text-sm text-gray-600">
                              {exclusion.reason || <span className="text-gray-400">-</span>}
                            </p>
                          </td>
                          <td className="px-4 py-4 text-center text-sm">
                            {exclusion.expiresAt ? (
                              <span className={expired ? 'text-red-600' : 'text-gray-600'}>
                                {formatDate(exclusion.expiresAt)}
                                {expired && ' (期限切れ)'}
                              </span>
                            ) : (
                              <span className="text-gray-400">無期限</span>
                            )}
                          </td>
                          <td className="px-4 py-4 text-center text-sm">
                            <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium ${
                              exclusion.advertiserId
                                ? 'bg-blue-100 text-blue-800'
                                : 'bg-purple-100 text-purple-800'
                            }`}>
                              {exclusion.advertiserId
                                ? advertisers.find((a) => a.tiktokAdvertiserId === exclusion.advertiserId)?.name || 'アカウント指定'
                                : '全アカウント'}
                            </span>
                          </td>
                          <td className="px-4 py-4 text-center">
                            <button
                              onClick={() => toggleEnabled(exclusion)}
                              className={`inline-flex items-center gap-1 px-3 py-1 rounded-full text-xs font-medium transition-colors ${
                                exclusion.enabled && !expired
                                  ? 'bg-green-100 text-green-800 hover:bg-green-200'
                                  : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
                              }`}
                            >
                              <Power className="w-3 h-3" />
                              {expired ? '期限切れ' : exclusion.enabled ? '有効' : '無効'}
                            </button>
                          </td>
                          <td className="px-4 py-4 text-center">
                            <div className="flex items-center justify-center gap-2">
                              <button
                                onClick={() => openEditModal(exclusion)}
                                className="p-2 text-gray-600 hover:text-blue-600 hover:bg-blue-50 rounded-lg transition-colors"
                                title="編集"
                              >
                                <Edit2 className="w-4 h-4" />
                              </button>
                              <button
                                onClick={() => setDeletingExclusionId(exclusion.id)}
                                className="p-2 text-gray-600 hover:text-red-600 hover:bg-red-50 rounded-lg transition-colors"
                                title="削除"
                              >
                                <Trash2 className="w-4 h-4" />
                              </button>
                            </div>
                          </td>
                        </tr>
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
              CR除外について
            </h3>
            <ul className="text-sm text-blue-800 space-y-1 list-disc list-inside">
              <li>除外されたCRは予算調整V2の全判定（増額・停止・予算減額）の対象外になります</li>
              <li>CR名は広告名の「YYMMDD/制作者名/<strong>CR名</strong>/LP名」から抽出されます</li>
              <li>同じCR名の広告が複数あっても、1つの除外設定で全てカバーされます</li>
              <li>有効期限を設定すると、その日を過ぎると自動的に除外が無効になります</li>
              <li>アカウントを指定して除外すると、そのアカウントの広告のみが対象になります</li>
            </ul>
          </div>
        </main>

        {/* 新規作成モーダル */}
        {showCreateModal && (
          <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
            <div className="bg-white rounded-lg w-full max-w-md">
              <div className="flex items-center justify-between p-4 border-b border-gray-200">
                <h3 className="text-lg font-semibold text-gray-900">
                  CR除外を新規追加
                </h3>
                <button
                  onClick={() => setShowCreateModal(false)}
                  className="text-gray-400 hover:text-gray-600"
                >
                  <X className="w-5 h-5" />
                </button>
              </div>

              <div className="p-4 space-y-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    配信中の広告から選択
                  </label>
                  {isLoadingAds ? (
                    <div className="flex items-center gap-2 text-gray-500">
                      <Loader2 className="w-4 h-4 animate-spin" />
                      読み込み中...
                    </div>
                  ) : (
                    <select
                      value={createForm.adId}
                      onChange={(e) => handleAdSelect(e.target.value)}
                      className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                    >
                      <option value="">広告を選択してください</option>
                      {availableAds.map((ad) => (
                        <option key={ad.id} value={ad.id}>
                          {ad.name}
                        </option>
                      ))}
                    </select>
                  )}
                  {ads.length > 0 && availableAds.length === 0 && !isLoadingAds && (
                    <p className="text-xs text-gray-500 mt-1">
                      全ての配信中広告のCRが既に除外設定済みです
                    </p>
                  )}
                </div>

                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    CR名
                  </label>
                  <input
                    type="text"
                    value={createForm.creativeName}
                    onChange={(e) => setCreateForm((prev) => ({ ...prev, creativeName: e.target.value }))}
                    placeholder="広告選択で自動入力、または手動入力"
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                  />
                  <p className="text-xs text-gray-500 mt-1">
                    広告名から自動抽出されます。必要に応じて手動で編集できます。
                  </p>
                </div>

                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    除外理由（任意）
                  </label>
                  <input
                    type="text"
                    value={createForm.reason}
                    onChange={(e) => setCreateForm((prev) => ({ ...prev, reason: e.target.value }))}
                    placeholder="例: テスト中、手動管理、クライアント指定"
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                  />
                </div>

                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    有効期限（任意）
                  </label>
                  <input
                    type="date"
                    value={createForm.expiresAt}
                    onChange={(e) => setCreateForm((prev) => ({ ...prev, expiresAt: e.target.value }))}
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                  />
                  <p className="text-xs text-gray-500 mt-1">
                    空の場合は無期限で除外されます
                  </p>
                </div>
              </div>

              <div className="flex gap-3 p-4 border-t border-gray-200">
                <button
                  onClick={() => setShowCreateModal(false)}
                  className="flex-1 px-4 py-2 text-gray-700 bg-gray-100 rounded-lg hover:bg-gray-200 transition-colors"
                >
                  キャンセル
                </button>
                <button
                  onClick={handleCreate}
                  disabled={isCreating || !createForm.creativeName.trim()}
                  className="flex-1 flex items-center justify-center gap-2 px-4 py-2 bg-gray-900 text-white rounded-lg hover:bg-gray-800 disabled:bg-gray-300 transition-colors"
                >
                  {isCreating ? (
                    <Loader2 className="w-4 h-4 animate-spin" />
                  ) : (
                    <Check className="w-4 h-4" />
                  )}
                  追加
                </button>
              </div>
            </div>
          </div>
        )}

        {/* 編集モーダル */}
        {editingExclusion && (
          <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
            <div className="bg-white rounded-lg w-full max-w-md">
              <div className="flex items-center justify-between p-4 border-b border-gray-200">
                <h3 className="text-lg font-semibold text-gray-900">
                  CR除外設定を編集
                </h3>
                <button
                  onClick={() => setEditingExclusion(null)}
                  className="text-gray-400 hover:text-gray-600"
                >
                  <X className="w-5 h-5" />
                </button>
              </div>

              <div className="p-4 space-y-4">
                <div className="bg-gray-50 rounded-lg p-3">
                  <p className="text-sm text-gray-600">CR名</p>
                  <p className="font-medium text-gray-900">{editingExclusion.creativeName}</p>
                </div>

                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    除外理由（任意）
                  </label>
                  <input
                    type="text"
                    value={editForm.reason}
                    onChange={(e) => setEditForm((prev) => ({ ...prev, reason: e.target.value }))}
                    placeholder="例: テスト中、手動管理、クライアント指定"
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                  />
                </div>

                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    有効期限（任意）
                  </label>
                  <input
                    type="date"
                    value={editForm.expiresAt}
                    onChange={(e) => setEditForm((prev) => ({ ...prev, expiresAt: e.target.value }))}
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                  />
                  <p className="text-xs text-gray-500 mt-1">
                    空の場合は無期限で除外されます
                  </p>
                </div>

                <div>
                  <label className="flex items-center gap-2 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={editForm.enabled}
                      onChange={(e) => setEditForm((prev) => ({ ...prev, enabled: e.target.checked }))}
                      className="w-4 h-4 text-blue-600 border-gray-300 rounded focus:ring-blue-500"
                    />
                    <span className="text-sm text-gray-700">有効にする</span>
                  </label>
                </div>
              </div>

              <div className="flex gap-3 p-4 border-t border-gray-200">
                <button
                  onClick={() => setEditingExclusion(null)}
                  className="flex-1 px-4 py-2 text-gray-700 bg-gray-100 rounded-lg hover:bg-gray-200 transition-colors"
                >
                  キャンセル
                </button>
                <button
                  onClick={handleUpdate}
                  disabled={isUpdating}
                  className="flex-1 flex items-center justify-center gap-2 px-4 py-2 bg-gray-900 text-white rounded-lg hover:bg-gray-800 disabled:bg-gray-300 transition-colors"
                >
                  {isUpdating ? (
                    <Loader2 className="w-4 h-4 animate-spin" />
                  ) : (
                    <Check className="w-4 h-4" />
                  )}
                  更新
                </button>
              </div>
            </div>
          </div>
        )}

        {/* 削除確認モーダル */}
        {deletingExclusionId && (
          <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
            <div className="bg-white rounded-lg w-full max-w-sm">
              <div className="p-4">
                <h3 className="text-lg font-semibold text-gray-900 mb-2">
                  削除の確認
                </h3>
                <p className="text-sm text-gray-600">
                  この除外設定を削除しますか？削除するとこのCRは予算調整V2の判定対象に戻ります。
                </p>
              </div>

              <div className="flex gap-3 p-4 border-t border-gray-200">
                <button
                  onClick={() => setDeletingExclusionId(null)}
                  className="flex-1 px-4 py-2 text-gray-700 bg-gray-100 rounded-lg hover:bg-gray-200 transition-colors"
                >
                  キャンセル
                </button>
                <button
                  onClick={() => handleDelete(deletingExclusionId)}
                  disabled={isDeleting}
                  className="flex-1 flex items-center justify-center gap-2 px-4 py-2 bg-red-600 text-white rounded-lg hover:bg-red-700 disabled:bg-gray-300 transition-colors"
                >
                  {isDeleting ? (
                    <Loader2 className="w-4 h-4 animate-spin" />
                  ) : (
                    <Trash2 className="w-4 h-4" />
                  )}
                  削除
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    </AppLayout>
  );
}

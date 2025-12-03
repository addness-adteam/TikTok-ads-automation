'use client';

import { useState, useEffect } from 'react';
import { Loader2, AlertCircle, Plus, Edit2, Trash2, Check, X, DollarSign, Calendar, Power } from 'lucide-react';
import { AppLayout } from '@/components/layout/AppLayout';
import { useAuth } from '@/lib/context/AuthContext';
import {
  getAdBudgetCaps,
  createAdBudgetCap,
  updateAdBudgetCap,
  deleteAdBudgetCap,
  AdBudgetCap,
} from '@/lib/api';

// API URLを取得
const getApiUrl = () => {
  if (typeof window === 'undefined') return 'http://localhost:4000';
  return window.location.hostname === 'localhost'
    ? 'http://localhost:4000'
    : 'https://tik-tok-ads-automation-backend.vercel.app';
};

interface Ad {
  id: string;
  name: string;
  status: string;
}

export default function BudgetCapsPage() {
  const { advertiserId } = useAuth();
  const [budgetCaps, setBudgetCaps] = useState<AdBudgetCap[]>([]);
  const [ads, setAds] = useState<Ad[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isLoadingAds, setIsLoadingAds] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // 新規作成モーダル
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [createForm, setCreateForm] = useState({
    adId: '',
    maxDailyBudget: 10000,
    startDate: '',
    endDate: '',
  });
  const [isCreating, setIsCreating] = useState(false);

  // 編集モーダル
  const [editingCap, setEditingCap] = useState<AdBudgetCap | null>(null);
  const [editForm, setEditForm] = useState({
    maxDailyBudget: 0,
    enabled: true,
    startDate: '',
    endDate: '',
  });
  const [isUpdating, setIsUpdating] = useState(false);

  // 削除確認
  const [deletingCapId, setDeletingCapId] = useState<string | null>(null);
  const [isDeleting, setIsDeleting] = useState(false);

  // データ取得
  const fetchBudgetCaps = async () => {
    if (!advertiserId) return;

    setIsLoading(true);
    setError(null);

    try {
      const data = await getAdBudgetCaps(advertiserId);
      setBudgetCaps(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : '予算上限の取得に失敗しました');
    } finally {
      setIsLoading(false);
    }
  };

  // 広告一覧取得
  const fetchAds = async () => {
    if (!advertiserId) return;

    setIsLoadingAds(true);
    try {
      const response = await fetch(`${getApiUrl()}/api/advertisers/${advertiserId}/ads`);
      if (!response.ok) throw new Error('Failed to fetch ads');
      const result = await response.json();
      setAds(result.data || []);
    } catch (err) {
      console.error('Failed to fetch ads:', err);
    } finally {
      setIsLoadingAds(false);
    }
  };

  useEffect(() => {
    fetchBudgetCaps();
  }, [advertiserId]);

  // 新規作成
  const handleCreate = async () => {
    if (!advertiserId || !createForm.adId || createForm.maxDailyBudget <= 0) {
      setError('広告と予算上限を入力してください');
      return;
    }

    setIsCreating(true);
    setError(null);

    try {
      const newCap = await createAdBudgetCap({
        adId: createForm.adId,
        advertiserId,
        maxDailyBudget: createForm.maxDailyBudget,
        startDate: createForm.startDate || undefined,
        endDate: createForm.endDate || undefined,
      });

      setBudgetCaps((prev) => [...prev, newCap]);
      setShowCreateModal(false);
      setCreateForm({ adId: '', maxDailyBudget: 10000, startDate: '', endDate: '' });
    } catch (err) {
      setError(err instanceof Error ? err.message : '予算上限の作成に失敗しました');
    } finally {
      setIsCreating(false);
    }
  };

  // 更新
  const handleUpdate = async () => {
    if (!editingCap) return;

    setIsUpdating(true);
    setError(null);

    try {
      const updatedCap = await updateAdBudgetCap(editingCap.id, {
        maxDailyBudget: editForm.maxDailyBudget,
        enabled: editForm.enabled,
        startDate: editForm.startDate || null,
        endDate: editForm.endDate || null,
      });

      setBudgetCaps((prev) =>
        prev.map((cap) => (cap.id === editingCap.id ? updatedCap : cap))
      );
      setEditingCap(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : '予算上限の更新に失敗しました');
    } finally {
      setIsUpdating(false);
    }
  };

  // 削除
  const handleDelete = async (id: string) => {
    setIsDeleting(true);
    setError(null);

    try {
      await deleteAdBudgetCap(id);
      setBudgetCaps((prev) => prev.filter((cap) => cap.id !== id));
      setDeletingCapId(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : '予算上限の削除に失敗しました');
    } finally {
      setIsDeleting(false);
    }
  };

  // 有効/無効トグル
  const toggleEnabled = async (cap: AdBudgetCap) => {
    try {
      const updatedCap = await updateAdBudgetCap(cap.id, { enabled: !cap.enabled });
      setBudgetCaps((prev) =>
        prev.map((c) => (c.id === cap.id ? updatedCap : c))
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : '更新に失敗しました');
    }
  };

  // 編集モーダルを開く
  const openEditModal = (cap: AdBudgetCap) => {
    setEditingCap(cap);
    setEditForm({
      maxDailyBudget: cap.maxDailyBudget,
      enabled: cap.enabled,
      startDate: cap.startDate ? cap.startDate.split('T')[0] : '',
      endDate: cap.endDate ? cap.endDate.split('T')[0] : '',
    });
  };

  // 新規作成モーダルを開く
  const openCreateModal = () => {
    setShowCreateModal(true);
    fetchAds();
  };

  // 数値フォーマット
  const formatCurrency = (num: number) => {
    return `¥${new Intl.NumberFormat('ja-JP').format(Math.round(num))}`;
  };

  // 日付フォーマット
  const formatDate = (dateString: string | undefined) => {
    if (!dateString) return '-';
    return new Date(dateString).toLocaleDateString('ja-JP');
  };

  // 予算上限を持っていない広告をフィルタ
  const availableAds = ads.filter(
    (ad) => !budgetCaps.some((cap) => cap.adId === ad.id)
  );

  if (!advertiserId) {
    return (
      <AppLayout>
        <div className="min-h-screen bg-gray-50 flex items-center justify-center">
          <div className="text-center">
            <AlertCircle className="w-12 h-12 text-gray-400 mx-auto mb-4" />
            <p className="text-gray-600">広告アカウントを選択してください</p>
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
                <h1 className="text-2xl font-bold text-gray-900">上限日予算設定</h1>
                <p className="text-sm text-gray-600 mt-1">
                  広告ごとに1日あたりの予算上限を設定できます
                </p>
              </div>
              <button
                onClick={openCreateModal}
                className="flex items-center gap-2 px-4 py-2 bg-gray-900 text-white rounded-lg hover:bg-gray-800 transition-colors"
              >
                <Plus className="w-4 h-4" />
                新規作成
              </button>
            </div>
          </div>
        </header>

        <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
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
          ) : budgetCaps.length === 0 ? (
            <div className="bg-white rounded-lg border border-gray-200 p-12 text-center">
              <DollarSign className="w-12 h-12 text-gray-400 mx-auto mb-4" />
              <p className="text-gray-600">上限日予算が設定されていません</p>
              <p className="text-sm text-gray-500 mt-2">
                「新規作成」ボタンから広告の予算上限を設定できます
              </p>
              <button
                onClick={openCreateModal}
                className="mt-4 inline-flex items-center gap-2 px-4 py-2 bg-gray-900 text-white rounded-lg hover:bg-gray-800 transition-colors"
              >
                <Plus className="w-4 h-4" />
                新規作成
              </button>
            </div>
          ) : (
            /* 予算上限一覧 */
            <div className="bg-white rounded-lg border border-gray-200 overflow-hidden">
              <div className="overflow-x-auto">
                <table className="min-w-full divide-y divide-gray-200">
                  <thead className="bg-gray-50">
                    <tr>
                      <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                        広告名
                      </th>
                      <th className="px-4 py-3 text-right text-xs font-medium text-gray-500 uppercase tracking-wider">
                        上限日予算
                      </th>
                      <th className="px-4 py-3 text-center text-xs font-medium text-gray-500 uppercase tracking-wider">
                        有効期間
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
                    {budgetCaps.map((cap) => (
                      <tr key={cap.id} className="hover:bg-gray-50">
                        <td className="px-4 py-4">
                          <div>
                            <p className="text-sm font-medium text-gray-900 truncate max-w-xs">
                              {cap.ad?.name || '広告名不明'}
                            </p>
                            <p className="text-xs text-gray-500">
                              {cap.ad?.status || '-'}
                            </p>
                          </div>
                        </td>
                        <td className="px-4 py-4 text-right">
                          <span className="text-lg font-semibold text-gray-900">
                            {formatCurrency(cap.maxDailyBudget)}
                          </span>
                          <span className="text-xs text-gray-500 ml-1">/日</span>
                        </td>
                        <td className="px-4 py-4 text-center text-sm text-gray-600">
                          {cap.startDate || cap.endDate ? (
                            <span>
                              {formatDate(cap.startDate)} 〜 {formatDate(cap.endDate)}
                            </span>
                          ) : (
                            <span className="text-gray-400">無期限</span>
                          )}
                        </td>
                        <td className="px-4 py-4 text-center">
                          <button
                            onClick={() => toggleEnabled(cap)}
                            className={`inline-flex items-center gap-1 px-3 py-1 rounded-full text-xs font-medium transition-colors ${
                              cap.enabled
                                ? 'bg-green-100 text-green-800 hover:bg-green-200'
                                : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
                            }`}
                          >
                            <Power className="w-3 h-3" />
                            {cap.enabled ? '有効' : '無効'}
                          </button>
                        </td>
                        <td className="px-4 py-4 text-center">
                          <div className="flex items-center justify-center gap-2">
                            <button
                              onClick={() => openEditModal(cap)}
                              className="p-2 text-gray-600 hover:text-blue-600 hover:bg-blue-50 rounded-lg transition-colors"
                              title="編集"
                            >
                              <Edit2 className="w-4 h-4" />
                            </button>
                            <button
                              onClick={() => setDeletingCapId(cap.id)}
                              className="p-2 text-gray-600 hover:text-red-600 hover:bg-red-50 rounded-lg transition-colors"
                              title="削除"
                            >
                              <Trash2 className="w-4 h-4" />
                            </button>
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {/* 説明セクション */}
          <div className="mt-6 bg-blue-50 border border-blue-200 rounded-lg p-6">
            <h3 className="text-sm font-semibold text-blue-900 mb-2">
              上限日予算について
            </h3>
            <ul className="text-sm text-blue-800 space-y-1 list-disc list-inside">
              <li>広告ごとに1日の予算上限を設定できます</li>
              <li>予算調整時に、この上限を超えないように制御されます</li>
              <li>同一広告セット内の複数広告に上限がある場合、最小値が適用されます</li>
              <li>有効期間を設定すると、その期間のみ上限が適用されます</li>
            </ul>
          </div>
        </main>

        {/* 新規作成モーダル */}
        {showCreateModal && (
          <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
            <div className="bg-white rounded-lg w-full max-w-md">
              <div className="flex items-center justify-between p-4 border-b border-gray-200">
                <h3 className="text-lg font-semibold text-gray-900">
                  上限日予算を新規作成
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
                    広告を選択
                  </label>
                  {isLoadingAds ? (
                    <div className="flex items-center gap-2 text-gray-500">
                      <Loader2 className="w-4 h-4 animate-spin" />
                      読み込み中...
                    </div>
                  ) : (
                    <select
                      value={createForm.adId}
                      onChange={(e) => setCreateForm((prev) => ({ ...prev, adId: e.target.value }))}
                      className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                    >
                      <option value="">選択してください</option>
                      {availableAds.map((ad) => (
                        <option key={ad.id} value={ad.id}>
                          {ad.name}
                        </option>
                      ))}
                    </select>
                  )}
                </div>

                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    上限日予算 (円)
                  </label>
                  <div className="relative">
                    <span className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-500">¥</span>
                    <input
                      type="number"
                      value={createForm.maxDailyBudget}
                      onChange={(e) => setCreateForm((prev) => ({ ...prev, maxDailyBudget: Number(e.target.value) }))}
                      className="w-full pl-8 pr-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                      min={1}
                    />
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">
                      開始日 (任意)
                    </label>
                    <input
                      type="date"
                      value={createForm.startDate}
                      onChange={(e) => setCreateForm((prev) => ({ ...prev, startDate: e.target.value }))}
                      className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">
                      終了日 (任意)
                    </label>
                    <input
                      type="date"
                      value={createForm.endDate}
                      onChange={(e) => setCreateForm((prev) => ({ ...prev, endDate: e.target.value }))}
                      className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                    />
                  </div>
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
                  disabled={isCreating || !createForm.adId || createForm.maxDailyBudget <= 0}
                  className="flex-1 flex items-center justify-center gap-2 px-4 py-2 bg-gray-900 text-white rounded-lg hover:bg-gray-800 disabled:bg-gray-300 transition-colors"
                >
                  {isCreating ? (
                    <Loader2 className="w-4 h-4 animate-spin" />
                  ) : (
                    <Check className="w-4 h-4" />
                  )}
                  作成
                </button>
              </div>
            </div>
          </div>
        )}

        {/* 編集モーダル */}
        {editingCap && (
          <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
            <div className="bg-white rounded-lg w-full max-w-md">
              <div className="flex items-center justify-between p-4 border-b border-gray-200">
                <h3 className="text-lg font-semibold text-gray-900">
                  上限日予算を編集
                </h3>
                <button
                  onClick={() => setEditingCap(null)}
                  className="text-gray-400 hover:text-gray-600"
                >
                  <X className="w-5 h-5" />
                </button>
              </div>

              <div className="p-4 space-y-4">
                <div className="bg-gray-50 rounded-lg p-3">
                  <p className="text-sm text-gray-600">広告</p>
                  <p className="font-medium text-gray-900">{editingCap.ad?.name || '広告名不明'}</p>
                </div>

                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    上限日予算 (円)
                  </label>
                  <div className="relative">
                    <span className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-500">¥</span>
                    <input
                      type="number"
                      value={editForm.maxDailyBudget}
                      onChange={(e) => setEditForm((prev) => ({ ...prev, maxDailyBudget: Number(e.target.value) }))}
                      className="w-full pl-8 pr-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                      min={1}
                    />
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">
                      開始日 (任意)
                    </label>
                    <input
                      type="date"
                      value={editForm.startDate}
                      onChange={(e) => setEditForm((prev) => ({ ...prev, startDate: e.target.value }))}
                      className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">
                      終了日 (任意)
                    </label>
                    <input
                      type="date"
                      value={editForm.endDate}
                      onChange={(e) => setEditForm((prev) => ({ ...prev, endDate: e.target.value }))}
                      className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                    />
                  </div>
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
                  onClick={() => setEditingCap(null)}
                  className="flex-1 px-4 py-2 text-gray-700 bg-gray-100 rounded-lg hover:bg-gray-200 transition-colors"
                >
                  キャンセル
                </button>
                <button
                  onClick={handleUpdate}
                  disabled={isUpdating || editForm.maxDailyBudget <= 0}
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
        {deletingCapId && (
          <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
            <div className="bg-white rounded-lg w-full max-w-sm">
              <div className="p-4">
                <h3 className="text-lg font-semibold text-gray-900 mb-2">
                  削除の確認
                </h3>
                <p className="text-sm text-gray-600">
                  この上限日予算設定を削除しますか？この操作は元に戻せません。
                </p>
              </div>

              <div className="flex gap-3 p-4 border-t border-gray-200">
                <button
                  onClick={() => setDeletingCapId(null)}
                  className="flex-1 px-4 py-2 text-gray-700 bg-gray-100 rounded-lg hover:bg-gray-200 transition-colors"
                >
                  キャンセル
                </button>
                <button
                  onClick={() => handleDelete(deletingCapId)}
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

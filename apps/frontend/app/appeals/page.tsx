'use client';

import { useState, useEffect } from 'react';
import { AppLayout } from '@/components/layout/AppLayout';
import { Plus, Edit2, Trash2, Loader2, AlertCircle, Save, X } from 'lucide-react';

// API URLを取得（本番環境では固定URL、開発環境ではlocalhost）
const getApiUrl = () => {
  if (typeof window === 'undefined') return 'http://localhost:4000';
  return window.location.hostname === 'localhost'
    ? 'http://localhost:4000'
    : 'https://tik-tok-ads-automation-backend.vercel.app';
};

interface Appeal {
  id: string;
  name: string;
  targetCPA: number | null;
  allowableCPA: number | null;
  targetFrontCPO: number | null;
  allowableFrontCPO: number | null;
  allowableIndividualReservationCPO: number | null;
  cvSpreadsheetUrl: string | null;
  frontSpreadsheetUrl: string | null;
  advertisers: { id: string; name: string }[];
}

interface Advertiser {
  id: string;
  name: string;
  appealId: string | null;
}

export default function AppealsPage() {
  const [appeals, setAppeals] = useState<Appeal[]>([]);
  const [advertisers, setAdvertisers] = useState<Advertiser[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [isEditModalOpen, setIsEditModalOpen] = useState(false);
  const [editingAppeal, setEditingAppeal] = useState<Partial<Appeal> | null>(null);

  // 訴求一覧を取得
  useEffect(() => {
    fetchAppeals();
    fetchAdvertisers();
  }, []);

  const fetchAppeals = async () => {
    try {
      setIsLoading(true);
      const response = await fetch(`${getApiUrl()}/api/appeals`);
      if (!response.ok) throw new Error('訴求の取得に失敗しました');
      const result = await response.json();

      // レスポンス形式を確認して適切にデータをセット
      if (result.success && result.data) {
        setAppeals(result.data);
      } else if (Array.isArray(result)) {
        // 旧形式（配列）にも対応
        setAppeals(result);
      } else {
        throw new Error(result.error || '訴求の取得に失敗しました');
      }

      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : '訴求の取得に失敗しました');
    } finally {
      setIsLoading(false);
    }
  };

  const fetchAdvertisers = async () => {
    try {
      const response = await fetch(`${getApiUrl()}/api/advertisers`);
      if (!response.ok) throw new Error('広告アカウントの取得に失敗しました');
      const result = await response.json();

      // レスポンス形式を確認して適切にデータをセット
      if (result.success && result.data) {
        setAdvertisers(result.data);
      } else if (Array.isArray(result)) {
        // 旧形式（配列）にも対応
        setAdvertisers(result);
      } else {
        console.error('広告アカウントの取得に失敗:', result.error);
      }
    } catch (err) {
      console.error('広告アカウントの取得に失敗:', err);
    }
  };

  const handleCreate = () => {
    setEditingAppeal({
      name: '',
      targetCPA: null,
      allowableCPA: null,
      targetFrontCPO: null,
      allowableFrontCPO: null,
      allowableIndividualReservationCPO: null,
    });
    setIsEditModalOpen(true);
  };

  const handleEdit = (appeal: Appeal) => {
    setEditingAppeal(appeal);
    setIsEditModalOpen(true);
  };

  const handleSave = async () => {
    if (!editingAppeal || !editingAppeal.name) {
      alert('訴求名を入力してください');
      return;
    }

    try {
      const url = editingAppeal.id
        ? `${getApiUrl()}/api/appeals/${editingAppeal.id}`
        : `${getApiUrl()}/api/appeals`;

      const method = editingAppeal.id ? 'PATCH' : 'POST';

      const response = await fetch(url, {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(editingAppeal),
      });

      if (!response.ok) throw new Error('保存に失敗しました');

      await fetchAppeals();
      setIsEditModalOpen(false);
      setEditingAppeal(null);
    } catch (err) {
      alert(err instanceof Error ? err.message : '保存に失敗しました');
    }
  };

  const handleDelete = async (id: string) => {
    if (!confirm('この訴求を削除しますか？')) return;

    try {
      const response = await fetch(`${getApiUrl()}/api/appeals/${id}`, {
        method: 'DELETE',
      });

      if (!response.ok) throw new Error('削除に失敗しました');

      await fetchAppeals();
    } catch (err) {
      alert(err instanceof Error ? err.message : '削除に失敗しました');
    }
  };

  const handleAssignAdvertiser = async (advertiserId: string, appealId: string | null) => {
    try {
      const response = await fetch(`${getApiUrl()}/api/advertisers/${advertiserId}/appeal`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ appealId }),
      });

      if (!response.ok) throw new Error('広告アカウントの紐付けに失敗しました');

      await fetchAdvertisers();
      await fetchAppeals();
    } catch (err) {
      alert(err instanceof Error ? err.message : '広告アカウントの紐付けに失敗しました');
    }
  };

  if (isLoading) {
    return (
      <AppLayout>
        <div className="min-h-screen flex items-center justify-center">
          <div className="text-center">
            <Loader2 className="w-12 h-12 text-blue-600 animate-spin mx-auto mb-4" />
            <p className="text-gray-600">読み込み中...</p>
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
          <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-4 flex justify-between items-center">
            <div>
              <h1 className="text-2xl font-bold text-gray-900">KPI設定管理</h1>
              <p className="text-sm text-gray-600 mt-1">訴求ごとのKPI目標設定と広告アカウントの紐付け</p>
            </div>
            <button
              onClick={handleCreate}
              className="flex items-center gap-2 px-4 py-2 bg-gray-900 text-white rounded-lg hover:bg-gray-800 transition-colors"
            >
              <Plus className="w-4 h-4" />
              新規作成
            </button>
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

          {/* 訴求一覧 */}
          <div className="space-y-6">
            {appeals.map((appeal) => (
              <div key={appeal.id} className="bg-white rounded-lg border border-gray-200 p-6">
                <div className="flex justify-between items-start mb-4">
                  <div>
                    <h3 className="text-lg font-bold text-gray-900">{appeal.name}</h3>
                    <p className="text-sm text-gray-500 mt-1">
                      紐付けアカウント数: {appeal.advertisers.length}件
                    </p>
                  </div>
                  <div className="flex gap-2">
                    <button
                      onClick={() => handleEdit(appeal)}
                      className="p-2 text-gray-600 hover:bg-gray-100 rounded-lg transition-colors"
                    >
                      <Edit2 className="w-4 h-4" />
                    </button>
                    <button
                      onClick={() => handleDelete(appeal.id)}
                      className="p-2 text-red-600 hover:bg-red-50 rounded-lg transition-colors"
                    >
                      <Trash2 className="w-4 h-4" />
                    </button>
                  </div>
                </div>

                {/* KPI指標 */}
                <div className="grid grid-cols-2 md:grid-cols-5 gap-4 mb-4">
                  <div className="bg-gray-50 rounded-lg p-3">
                    <p className="text-xs text-gray-500 mb-1">目標CPA</p>
                    <p className="text-lg font-semibold text-gray-900">
                      {appeal.targetCPA ? `¥${appeal.targetCPA.toLocaleString()}` : '未設定'}
                    </p>
                  </div>
                  <div className="bg-gray-50 rounded-lg p-3">
                    <p className="text-xs text-gray-500 mb-1">許容CPA</p>
                    <p className="text-lg font-semibold text-gray-900">
                      {appeal.allowableCPA ? `¥${appeal.allowableCPA.toLocaleString()}` : '未設定'}
                    </p>
                  </div>
                  <div className="bg-gray-50 rounded-lg p-3">
                    <p className="text-xs text-gray-500 mb-1">目標フロントCPO</p>
                    <p className="text-lg font-semibold text-gray-900">
                      {appeal.targetFrontCPO ? `¥${appeal.targetFrontCPO.toLocaleString()}` : '未設定'}
                    </p>
                  </div>
                  <div className="bg-gray-50 rounded-lg p-3">
                    <p className="text-xs text-gray-500 mb-1">許容フロントCPO</p>
                    <p className="text-lg font-semibold text-gray-900">
                      {appeal.allowableFrontCPO ? `¥${appeal.allowableFrontCPO.toLocaleString()}` : '未設定'}
                    </p>
                  </div>
                  <div className="bg-gray-50 rounded-lg p-3">
                    <p className="text-xs text-gray-500 mb-1">許容個別予約CPO</p>
                    <p className="text-lg font-semibold text-gray-900">
                      {appeal.allowableIndividualReservationCPO ? `¥${appeal.allowableIndividualReservationCPO.toLocaleString()}` : '未設定'}
                    </p>
                  </div>
                </div>

                {/* スプレッドシートURL - ユーザーから非表示 */}
                {/* <div className="space-y-2 mb-4">
                  {appeal.cvSpreadsheetUrl && (
                    <div className="text-sm">
                      <span className="text-gray-500">CV集計シート: </span>
                      <a href={appeal.cvSpreadsheetUrl} target="_blank" rel="noopener noreferrer" className="text-blue-600 hover:underline break-all">
                        {appeal.cvSpreadsheetUrl}
                      </a>
                    </div>
                  )}
                  {appeal.frontSpreadsheetUrl && (
                    <div className="text-sm">
                      <span className="text-gray-500">フロント集計シート: </span>
                      <a href={appeal.frontSpreadsheetUrl} target="_blank" rel="noopener noreferrer" className="text-blue-600 hover:underline break-all">
                        {appeal.frontSpreadsheetUrl}
                      </a>
                    </div>
                  )}
                </div> */}

                {/* 紐付けアカウント */}
                {appeal.advertisers.length > 0 && (
                  <div>
                    <p className="text-sm font-medium text-gray-700 mb-2">紐付け広告アカウント</p>
                    <div className="flex flex-wrap gap-2">
                      {appeal.advertisers.map((adv) => (
                        <span key={adv.id} className="px-3 py-1 bg-blue-50 text-blue-700 text-sm rounded-full">
                          {adv.name}
                        </span>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            ))}

            {appeals.length === 0 && !error && (
              <div className="text-center py-12 bg-white rounded-lg border border-gray-200">
                <p className="text-gray-500">訴求が登録されていません</p>
                <button
                  onClick={handleCreate}
                  className="mt-4 text-blue-600 hover:text-blue-700 font-medium"
                >
                  最初の訴求を作成する
                </button>
              </div>
            )}
          </div>

          {/* 広告アカウント紐付けセクション */}
          {advertisers.length > 0 && (
            <div className="mt-8">
              <h2 className="text-lg font-bold text-gray-900 mb-4">広告アカウントと訴求の紐付け</h2>
              <div className="bg-white rounded-lg border border-gray-200 overflow-hidden">
                <table className="min-w-full divide-y divide-gray-200">
                  <thead className="bg-gray-50">
                    <tr>
                      <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">
                        広告アカウント名
                      </th>
                      <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">
                        紐付け訴求
                      </th>
                    </tr>
                  </thead>
                  <tbody className="bg-white divide-y divide-gray-200">
                    {advertisers.map((advertiser) => (
                      <tr key={advertiser.id}>
                        <td className="px-6 py-4 whitespace-nowrap text-sm font-medium text-gray-900">
                          {advertiser.name}
                        </td>
                        <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
                          <select
                            value={advertiser.appealId || ''}
                            onChange={(e) => handleAssignAdvertiser(advertiser.id, e.target.value || null)}
                            className="block w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-blue-500 focus:border-blue-500"
                          >
                            <option value="">未設定</option>
                            {appeals.map((appeal) => (
                              <option key={appeal.id} value={appeal.id}>
                                {appeal.name}
                              </option>
                            ))}
                          </select>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </main>
      </div>

      {/* 編集モーダル */}
      {isEditModalOpen && editingAppeal && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-lg max-w-2xl w-full max-h-[90vh] overflow-y-auto">
            <div className="p-6 border-b border-gray-200 flex justify-between items-center">
              <h2 className="text-xl font-bold text-gray-900">
                {editingAppeal.id ? '訴求を編集' : '新規訴求を作成'}
              </h2>
              <button
                onClick={() => setIsEditModalOpen(false)}
                className="text-gray-400 hover:text-gray-600"
              >
                <X className="w-6 h-6" />
              </button>
            </div>

            <div className="p-6 space-y-4">
              {/* 訴求名 */}
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  訴求名 <span className="text-red-500">*</span>
                </label>
                <input
                  type="text"
                  value={editingAppeal.name || ''}
                  onChange={(e) => setEditingAppeal({ ...editingAppeal, name: e.target.value })}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                  placeholder="例: SNS、AI、デザジュク"
                />
              </div>

              {/* KPI指標 */}
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">目標CPA (円)</label>
                  <input
                    type="number"
                    value={editingAppeal.targetCPA || ''}
                    onChange={(e) => setEditingAppeal({ ...editingAppeal, targetCPA: e.target.value ? Number(e.target.value) : null })}
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                    placeholder="例: 5000"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">許容CPA (円)</label>
                  <input
                    type="number"
                    value={editingAppeal.allowableCPA || ''}
                    onChange={(e) => setEditingAppeal({ ...editingAppeal, allowableCPA: e.target.value ? Number(e.target.value) : null })}
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                    placeholder="例: 8000"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">目標フロントCPO (円)</label>
                  <input
                    type="number"
                    value={editingAppeal.targetFrontCPO || ''}
                    onChange={(e) => setEditingAppeal({ ...editingAppeal, targetFrontCPO: e.target.value ? Number(e.target.value) : null })}
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                    placeholder="例: 3000"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">許容フロントCPO (円)</label>
                  <input
                    type="number"
                    value={editingAppeal.allowableFrontCPO || ''}
                    onChange={(e) => setEditingAppeal({ ...editingAppeal, allowableFrontCPO: e.target.value ? Number(e.target.value) : null })}
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                    placeholder="例: 5000"
                  />
                </div>
                <div className="col-span-2">
                  <label className="block text-sm font-medium text-gray-700 mb-2">許容個別予約CPO (円)</label>
                  <input
                    type="number"
                    value={editingAppeal.allowableIndividualReservationCPO || ''}
                    onChange={(e) => setEditingAppeal({ ...editingAppeal, allowableIndividualReservationCPO: e.target.value ? Number(e.target.value) : null })}
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                    placeholder="例: 50000"
                  />
                </div>
              </div>

              {/* スプレッドシートURLは自動設定されることを説明 */}
              <div className="bg-blue-50 border border-blue-200 rounded-lg p-4">
                <p className="text-sm text-blue-800">
                  <strong>スプレッドシートURL</strong>は訴求名に基づいて自動的に設定されます。
                </p>
                <ul className="text-xs text-blue-700 mt-2 space-y-1">
                  <li>• SNS訴求: SNSのCV集計・フロント集計シートを使用</li>
                  <li>• AI訴求: AIのCV集計・フロント集計シートを使用</li>
                  <li>• デザジュク訴求: デザジュクのCV集計・フロント集計シートを使用</li>
                </ul>
              </div>
            </div>

            <div className="p-6 border-t border-gray-200 flex justify-end gap-3">
              <button
                onClick={() => setIsEditModalOpen(false)}
                className="px-4 py-2 text-gray-700 border border-gray-300 rounded-lg hover:bg-gray-50"
              >
                キャンセル
              </button>
              <button
                onClick={handleSave}
                className="flex items-center gap-2 px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700"
              >
                <Save className="w-4 h-4" />
                保存
              </button>
            </div>
          </div>
        </div>
      )}
    </AppLayout>
  );
}

'use client';

import { useState, useEffect } from 'react';
import { AppLayout } from '@/components/layout/AppLayout';
import { Loader2, AlertCircle, CheckCircle, Plus, X, Rocket } from 'lucide-react';

interface Advertiser {
  id: string;
  name: string;
  advertiserId: string;
  appealId: string | null;
  appeal?: {
    name: string;
  };
}

interface Creative {
  id: string;
  name: string;
  type: 'VIDEO' | 'IMAGE';
  url: string;
  tiktokVideoId?: string;
  tiktokImageId?: string;
}

interface Pixel {
  pixel_id: string;
  pixel_name: string;
  pixel_code?: string;
}

interface AdTextTemplate {
  id: string;
  name: string;
  text: string;
  appealId: string;
}

type CampaignPattern = 'NON_TARGETING' | 'LOOKALIKE';

export default function CampaignBuilderPage() {
  const [advertisers, setAdvertisers] = useState<Advertiser[]>([]);
  const [creatives, setCreatives] = useState<Creative[]>([]);
  const [pixels, setPixels] = useState<Pixel[]>([]);
  const [adTextTemplates, setAdTextTemplates] = useState<AdTextTemplate[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isLoadingPixels, setIsLoadingPixels] = useState(false);
  const [isLoadingTemplates, setIsLoadingTemplates] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);
  const [showTemplateModal, setShowTemplateModal] = useState(false);
  const [newTemplateName, setNewTemplateName] = useState('');
  const [newTemplateText, setNewTemplateText] = useState('');

  // フォームの状態
  const [pattern, setPattern] = useState<CampaignPattern>('NON_TARGETING');
  const [selectedAdvertiserId, setSelectedAdvertiserId] = useState('');
  const [selectedPixelId, setSelectedPixelId] = useState('');
  const [dailyBudget, setDailyBudget] = useState<number>(5000);
  const [campaignName, setCampaignName] = useState('');
  const [adTexts, setAdTexts] = useState<string[]>(['']);
  const [adNames, setAdNames] = useState<string[]>(['']);
  const [landingPageUrl, setLandingPageUrl] = useState('');
  const [lpName, setLpName] = useState('');
  const [selectedCreativeIds, setSelectedCreativeIds] = useState<string[]>([]);

  useEffect(() => {
    fetchData();
  }, []);

  const fetchData = async () => {
    try {
      setIsLoading(true);
      const apiUrl = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:4000';
      const [advertisersRes, creativesRes] = await Promise.all([
        fetch(`${apiUrl}/api/advertisers`),
        fetch(`${apiUrl}/api/creatives`),
      ]);

      if (!advertisersRes.ok || !creativesRes.ok) {
        throw new Error('データの取得に失敗しました');
      }

      const advertisersData = await advertisersRes.json();
      const creativesData = await creativesRes.json();

      setAdvertisers(advertisersData.data || advertisersData);
      setCreatives(creativesData.data || creativesData);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'データの取得に失敗しました');
    } finally {
      setIsLoading(false);
    }
  };

  const fetchPixels = async (advertiserId: string) => {
    try {
      setIsLoadingPixels(true);
      const apiUrl = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:4000';
      const response = await fetch(`${apiUrl}/api/pixels?advertiserId=${advertiserId}`);

      if (!response.ok) {
        throw new Error('Pixelの取得に失敗しました');
      }

      const result = await response.json();
      setPixels(result.data || []);

      // 最初のPixelを自動選択
      if (result.data && result.data.length > 0) {
        setSelectedPixelId(result.data[0].pixel_id);
      }

      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Pixelの取得に失敗しました');
      setPixels([]);
    } finally {
      setIsLoadingPixels(false);
    }
  };

  const fetchAdTextTemplates = async (advertiserId: string) => {
    try {
      setIsLoadingTemplates(true);

      // 広告アカウントからappealIdを取得
      const advertiser = advertisers.find(a => a.id === advertiserId);
      if (!advertiser || !advertiser.appealId) {
        setAdTextTemplates([]);
        return;
      }

      const apiUrl = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:4000';
      const response = await fetch(`${apiUrl}/api/appeals/${advertiser.appealId}/ad-text-templates`);

      if (!response.ok) {
        throw new Error('広告文テンプレートの取得に失敗しました');
      }

      const result = await response.json();
      setAdTextTemplates(result.data || []);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : '広告文テンプレートの取得に失敗しました');
      setAdTextTemplates([]);
    } finally {
      setIsLoadingTemplates(false);
    }
  };

  const handleAdvertiserChange = (advertiserId: string) => {
    setSelectedAdvertiserId(advertiserId);
    setSelectedPixelId('');
    setPixels([]);
    setAdTextTemplates([]);

    if (advertiserId) {
      fetchPixels(advertiserId);
      fetchAdTextTemplates(advertiserId);
    }
  };

  const handleAddAdText = () => {
    if (adTexts.length < 5) {
      setAdTexts([...adTexts, '']);
      setAdNames([...adNames, '']);
    }
  };

  const handleRemoveAdText = (index: number) => {
    setAdTexts(adTexts.filter((_, i) => i !== index));
    setAdNames(adNames.filter((_, i) => i !== index));
  };

  const handleAdTextChange = (index: number, value: string) => {
    const newTexts = [...adTexts];
    newTexts[index] = value;
    setAdTexts(newTexts);
  };

  const handleAdNameChange = (index: number, value: string) => {
    const newNames = [...adNames];
    newNames[index] = value;
    setAdNames(newNames);
  };

  const handleTemplateSelect = (index: number, templateId: string) => {
    const template = adTextTemplates.find(t => t.id === templateId);
    if (template) {
      const newTexts = [...adTexts];
      newTexts[index] = template.text;
      setAdTexts(newTexts);
    }
  };

  const handleCreateTemplate = async () => {
    try {
      const advertiser = advertisers.find(a => a.id === selectedAdvertiserId);
      if (!advertiser || !advertiser.appealId) {
        alert('広告アカウントを選択してください');
        return;
      }

      if (!newTemplateName.trim() || !newTemplateText.trim()) {
        alert('テンプレート名と広告文を入力してください');
        return;
      }

      const apiUrl = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:4000';
      const response = await fetch(`${apiUrl}/api/appeals/${advertiser.appealId}/ad-text-templates`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          name: newTemplateName,
          text: newTemplateText,
        }),
      });

      if (!response.ok) {
        throw new Error('テンプレートの作成に失敗しました');
      }

      const result = await response.json();

      // テンプレートリストを更新
      setAdTextTemplates([result.data, ...adTextTemplates]);

      // モーダルを閉じる
      setShowTemplateModal(false);
      setNewTemplateName('');
      setNewTemplateText('');

      alert('テンプレートを作成しました');
    } catch (err) {
      alert(err instanceof Error ? err.message : 'テンプレートの作成に失敗しました');
    }
  };

  const toggleCreative = (creativeId: string) => {
    if (selectedCreativeIds.includes(creativeId)) {
      setSelectedCreativeIds(selectedCreativeIds.filter(id => id !== creativeId));
    } else {
      setSelectedCreativeIds([...selectedCreativeIds, creativeId]);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    // バリデーション
    if (!selectedAdvertiserId) {
      alert('広告アカウントを選択してください');
      return;
    }
    if (!selectedPixelId) {
      alert('Pixelを選択してください');
      return;
    }
    if (!dailyBudget || dailyBudget <= 0) {
      alert('日予算を入力してください');
      return;
    }
    if (!campaignName) {
      alert('キャンペーン名を入力してください');
      return;
    }
    if (adTexts.filter(text => text.trim()).length === 0) {
      alert('広告文を少なくとも1つ入力してください');
      return;
    }
    if (adNames.filter(name => name.trim()).length === 0) {
      alert('広告名を少なくとも1つ入力してください');
      return;
    }
    if (adTexts.filter(text => text.trim()).length !== adNames.filter(name => name.trim()).length) {
      alert('広告文と広告名の数を一致させてください');
      return;
    }
    if (!landingPageUrl) {
      alert('Landing PageのURLを入力してください');
      return;
    }
    if (!lpName) {
      alert('LP名を入力してください');
      return;
    }
    if (selectedCreativeIds.length === 0) {
      alert('Creativeを少なくとも1つ選択してください');
      return;
    }

    setIsSubmitting(true);
    setError(null);
    setSuccessMessage(null);

    try {
      const apiUrl = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:4000';
      const response = await fetch(`${apiUrl}/api/campaign-builder/create`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          advertiserId: selectedAdvertiserId,
          pixelId: selectedPixelId,
          dailyBudget,
          campaignName,
          pattern,
          adTexts: adTexts.filter(text => text.trim()),
          adNames: adNames.filter(name => name.trim()),
          landingPageUrl,
          lpName,
          creativeIds: selectedCreativeIds,
        }),
      });

      const result = await response.json();

      if (!response.ok || !result.success) {
        throw new Error(result.error || 'キャンペーンの作成に失敗しました');
      }

      setSuccessMessage('キャンペーンの作成に成功しました！');

      // フォームをリセット
      setCampaignName('');
      setAdTexts(['']);
      setLandingPageUrl('');
      setLpName('');
      setSelectedCreativeIds([]);
      setDailyBudget(5000);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'キャンペーンの作成に失敗しました');
    } finally {
      setIsSubmitting(false);
    }
  };

  const selectedAdvertiser = advertisers.find(adv => adv.id === selectedAdvertiserId);

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
          <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-4">
            <h1 className="text-2xl font-bold text-gray-900">キャンペーン作成</h1>
            <p className="text-sm text-gray-600 mt-1">ノンタゲまたは類似オーディエンスのキャンペーンを作成</p>
          </div>
        </header>

        <main className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
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

          {/* 成功メッセージ */}
          {successMessage && (
            <div className="mb-6 bg-green-50 border border-green-200 rounded-lg p-4 flex items-start gap-3">
              <CheckCircle className="w-5 h-5 text-green-600 flex-shrink-0 mt-0.5" />
              <div>
                <h3 className="text-sm font-semibold text-green-900 mb-1">成功</h3>
                <p className="text-sm text-green-700">{successMessage}</p>
              </div>
            </div>
          )}

          <form onSubmit={handleSubmit} className="space-y-6">
            {/* パターン選択 */}
            <div className="bg-white rounded-lg border border-gray-200 p-6">
              <h2 className="text-lg font-bold text-gray-900 mb-4">キャンペーンパターン</h2>
              <div className="grid grid-cols-2 gap-4">
                <button
                  type="button"
                  onClick={() => setPattern('NON_TARGETING')}
                  className={`p-4 border-2 rounded-lg transition-all ${
                    pattern === 'NON_TARGETING'
                      ? 'border-blue-600 bg-blue-50'
                      : 'border-gray-300 hover:border-gray-400'
                  }`}
                >
                  <div className="text-center">
                    <p className="font-bold text-gray-900 mb-1">ノンタゲ</p>
                    <p className="text-xs text-gray-600">ターゲティングなしで広範囲にリーチ</p>
                  </div>
                </button>
                <button
                  type="button"
                  onClick={() => setPattern('LOOKALIKE')}
                  className={`p-4 border-2 rounded-lg transition-all ${
                    pattern === 'LOOKALIKE'
                      ? 'border-blue-600 bg-blue-50'
                      : 'border-gray-300 hover:border-gray-400'
                  }`}
                >
                  <div className="text-center">
                    <p className="font-bold text-gray-900 mb-1">類似オーディエンス</p>
                    <p className="text-xs text-gray-600">既存顧客に似たユーザーに配信</p>
                  </div>
                </button>
              </div>
            </div>

            {/* 広告アカウント選択 */}
            <div className="bg-white rounded-lg border border-gray-200 p-6">
              <h2 className="text-lg font-bold text-gray-900 mb-4">
                広告アカウント <span className="text-red-500">*</span>
              </h2>
              <select
                value={selectedAdvertiserId}
                onChange={(e) => handleAdvertiserChange(e.target.value)}
                className="w-full px-4 py-3 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
              >
                <option value="">広告アカウントを選択してください</option>
                {advertisers.map((advertiser) => (
                  <option key={advertiser.id} value={advertiser.id}>
                    {advertiser.name}
                    {advertiser.appeal && ` (訴求: ${advertiser.appeal.name})`}
                  </option>
                ))}
              </select>
              {selectedAdvertiser?.appeal && (
                <p className="mt-2 text-sm text-gray-600">
                  訴求: <span className="font-medium text-gray-900">{selectedAdvertiser.appeal.name}</span>
                </p>
              )}
            </div>

            {/* Pixel選択 */}
            {selectedAdvertiserId && (
              <div className="bg-white rounded-lg border border-gray-200 p-6">
                <h2 className="text-lg font-bold text-gray-900 mb-4">
                  Pixel選択 <span className="text-red-500">*</span>
                </h2>
                {isLoadingPixels ? (
                  <div className="flex items-center justify-center py-4">
                    <Loader2 className="w-6 h-6 text-blue-600 animate-spin mr-2" />
                    <p className="text-gray-600">Pixel読み込み中...</p>
                  </div>
                ) : pixels.length > 0 ? (
                  <>
                    <select
                      value={selectedPixelId}
                      onChange={(e) => setSelectedPixelId(e.target.value)}
                      className="w-full px-4 py-3 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                    >
                      <option value="">Pixelを選択してください</option>
                      {pixels.map((pixel) => (
                        <option key={pixel.pixel_id} value={pixel.pixel_id}>
                          {pixel.pixel_name} (ID: {pixel.pixel_id})
                        </option>
                      ))}
                    </select>
                    <p className="mt-2 text-xs text-gray-500">
                      コンバージョン計測に使用するPixelを選択してください
                    </p>
                  </>
                ) : (
                  <p className="text-gray-500 text-center py-4">
                    この広告アカウントにPixelが登録されていません
                  </p>
                )}
              </div>
            )}

            {/* 日予算 */}
            {selectedAdvertiserId && (
              <div className="bg-white rounded-lg border border-gray-200 p-6">
                <h2 className="text-lg font-bold text-gray-900 mb-4">
                  日予算 <span className="text-red-500">*</span>
                </h2>
                <div className="flex items-center gap-2">
                  <input
                    type="number"
                    value={dailyBudget}
                    onChange={(e) => setDailyBudget(Number(e.target.value))}
                    className="w-full px-4 py-3 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                    placeholder="5000"
                    min="0"
                    step="100"
                  />
                  <span className="text-gray-700 font-medium whitespace-nowrap">円</span>
                </div>
                <p className="mt-2 text-xs text-gray-500">
                  1日あたりの広告予算を入力してください（推奨: 5,000円以上）
                </p>
              </div>
            )}

            {/* キャンペーン名 */}
            <div className="bg-white rounded-lg border border-gray-200 p-6">
              <h2 className="text-lg font-bold text-gray-900 mb-4">
                キャンペーン名 <span className="text-red-500">*</span>
              </h2>
              <input
                type="text"
                value={campaignName}
                onChange={(e) => setCampaignName(e.target.value)}
                className="w-full px-4 py-3 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                placeholder="例: 2025年春キャンペーン"
              />
            </div>

            {/* 広告文 */}
            <div className="bg-white rounded-lg border border-gray-200 p-6">
              <div className="flex justify-between items-center mb-4">
                <h2 className="text-lg font-bold text-gray-900">
                  広告文 <span className="text-red-500">*</span>
                </h2>
                <div className="flex gap-2">
                  {selectedAdvertiserId && adTextTemplates.length >= 0 && (
                    <button
                      type="button"
                      onClick={() => setShowTemplateModal(true)}
                      className="flex items-center gap-1 text-sm text-green-600 hover:text-green-700"
                    >
                      <Plus className="w-4 h-4" />
                      新しいテンプレート作成
                    </button>
                  )}
                  {adTexts.length < 5 && (
                    <button
                      type="button"
                      onClick={handleAddAdText}
                      className="flex items-center gap-1 text-sm text-blue-600 hover:text-blue-700"
                    >
                      <Plus className="w-4 h-4" />
                      広告文を追加
                    </button>
                  )}
                </div>
              </div>
              <div className="space-y-3">
                {adTexts.map((text, index) => (
                  <div key={index} className="space-y-2">
                    <div className="flex gap-2 items-start">
                      <div className="flex-1 space-y-2">
                        {/* テンプレート選択 */}
                        {adTextTemplates.length > 0 && (
                          <select
                            onChange={(e) => {
                              if (e.target.value) {
                                handleTemplateSelect(index, e.target.value);
                              }
                            }}
                            className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 text-sm"
                          >
                            <option value="">テンプレートから選択（オプション）</option>
                            {adTextTemplates.map((template) => (
                              <option key={template.id} value={template.id}>
                                {template.name}: {template.text.substring(0, 30)}...
                              </option>
                            ))}
                          </select>
                        )}
                        {/* 手動入力 */}
                        <input
                          type="text"
                          value={text}
                          onChange={(e) => handleAdTextChange(index, e.target.value)}
                          className="w-full px-4 py-3 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                          placeholder={`広告文 ${index + 1}（手動入力 or テンプレート選択）`}
                        />
                      </div>
                      {adTexts.length > 1 && (
                        <button
                          type="button"
                          onClick={() => handleRemoveAdText(index)}
                          className="p-3 text-red-600 hover:bg-red-50 rounded-lg transition-colors"
                        >
                          <X className="w-5 h-5" />
                        </button>
                      )}
                    </div>
                  </div>
                ))}
              </div>
              <p className="mt-2 text-xs text-gray-500">
                最大5個まで追加できます。テンプレートから選択するか、直接入力してください。
              </p>
            </div>

            {/* 広告名 */}
            <div className="bg-white rounded-lg border border-gray-200 p-6">
              <h2 className="text-lg font-bold text-gray-900 mb-2">
                広告名 <span className="text-red-500">*</span>
              </h2>
              <p className="text-sm text-gray-600 mb-4">
                記入ルール：日付（6桁）/CR制作者名/CR名/テスト変数/LP種類-CR番号（5桁）<br />
                <span className="text-gray-500">例: 251104/鈴木織大/これまだ言ってない/奇行/LP1-CR00055</span>
              </p>
              <div className="space-y-3">
                {adNames.map((name, index) => (
                  <div key={index} className="flex gap-2">
                    <input
                      type="text"
                      value={name}
                      onChange={(e) => handleAdNameChange(index, e.target.value)}
                      className="flex-1 px-4 py-3 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                      placeholder={`広告名 ${index + 1} (例: 251104/鈴木織大/これまだ言ってない/奇行/LP1-CR00055)`}
                    />
                  </div>
                ))}
              </div>
              <p className="mt-2 text-xs text-gray-500">※ 広告文と同じ数の広告名を入力してください</p>
            </div>

            {/* Landing Page */}
            <div className="bg-white rounded-lg border border-gray-200 p-6">
              <h2 className="text-lg font-bold text-gray-900 mb-4">Landing Page</h2>
              <div className="space-y-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">
                    URL <span className="text-red-500">*</span>
                  </label>
                  <input
                    type="url"
                    value={landingPageUrl}
                    onChange={(e) => setLandingPageUrl(e.target.value)}
                    className="w-full px-4 py-3 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                    placeholder="https://example.com/landing"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">
                    LP名 <span className="text-red-500">*</span>
                  </label>
                  <input
                    type="text"
                    value={lpName}
                    onChange={(e) => setLpName(e.target.value)}
                    className="w-full px-4 py-3 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                    placeholder="例: LP01"
                  />
                  <p className="mt-2 text-xs text-gray-500">
                    登録経路に使用されます（例: TikTok広告-{selectedAdvertiser?.appeal?.name || '訴求'}-{lpName || 'LP名'}）
                  </p>
                </div>
              </div>
            </div>

            {/* Creative選択 */}
            <div className="bg-white rounded-lg border border-gray-200 p-6">
              <h2 className="text-lg font-bold text-gray-900 mb-4">
                Creative選択 <span className="text-red-500">*</span>
              </h2>
              {creatives.length > 0 ? (
                <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
                  {creatives.map((creative) => (
                    <button
                      key={creative.id}
                      type="button"
                      onClick={() => toggleCreative(creative.id)}
                      className={`relative p-4 border-2 rounded-lg transition-all ${
                        selectedCreativeIds.includes(creative.id)
                          ? 'border-blue-600 bg-blue-50'
                          : 'border-gray-300 hover:border-gray-400'
                      }`}
                    >
                      {creative.type === 'VIDEO' ? (
                        <video src={creative.url} className="w-full h-32 object-cover rounded mb-2" />
                      ) : (
                        <img src={creative.url} alt={creative.name} className="w-full h-32 object-cover rounded mb-2" />
                      )}
                      <p className="text-sm font-medium text-gray-900 truncate">{creative.name}</p>
                      <p className="text-xs text-gray-500">{creative.type}</p>
                      {selectedCreativeIds.includes(creative.id) && (
                        <div className="absolute top-2 right-2 bg-blue-600 text-white rounded-full p-1">
                          <CheckCircle className="w-4 h-4" />
                        </div>
                      )}
                    </button>
                  ))}
                </div>
              ) : (
                <p className="text-gray-500 text-center py-8">
                  Creativeが登録されていません。先にCreative管理画面からアップロードしてください。
                </p>
              )}
              <p className="mt-4 text-sm text-gray-600">
                選択済み: {selectedCreativeIds.length}個
              </p>
            </div>

            {/* 送信ボタン */}
            <div className="flex justify-end gap-3">
              <button
                type="submit"
                disabled={isSubmitting}
                className="flex items-center gap-2 px-6 py-3 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:bg-gray-400 disabled:cursor-not-allowed transition-colors"
              >
                {isSubmitting ? (
                  <>
                    <Loader2 className="w-5 h-5 animate-spin" />
                    作成中...
                  </>
                ) : (
                  <>
                    <Rocket className="w-5 h-5" />
                    キャンペーンを作成
                  </>
                )}
              </button>
            </div>
          </form>
        </main>
      </div>

      {/* テンプレート作成モーダル */}
      {showTemplateModal && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
          <div className="bg-white rounded-lg p-6 w-full max-w-md">
            <h3 className="text-lg font-bold text-gray-900 mb-4">新しい広告文テンプレートを作成</h3>

            <div className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  テンプレート名 <span className="text-red-500">*</span>
                </label>
                <input
                  type="text"
                  value={newTemplateName}
                  onChange={(e) => setNewTemplateName(e.target.value)}
                  className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                  placeholder="例: 新春セール"
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  広告文 <span className="text-red-500">*</span>
                </label>
                <textarea
                  value={newTemplateText}
                  onChange={(e) => setNewTemplateText(e.target.value)}
                  className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 h-24"
                  placeholder="広告文を入力してください"
                />
              </div>
            </div>

            <div className="flex justify-end gap-3 mt-6">
              <button
                type="button"
                onClick={() => {
                  setShowTemplateModal(false);
                  setNewTemplateName('');
                  setNewTemplateText('');
                }}
                className="px-4 py-2 text-gray-700 hover:bg-gray-100 rounded-lg transition-colors"
              >
                キャンセル
              </button>
              <button
                type="button"
                onClick={handleCreateTemplate}
                className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors"
              >
                作成して使用
              </button>
            </div>
          </div>
        </div>
      )}
    </AppLayout>
  );
}

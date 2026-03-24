'use client';

import { useState, useEffect } from 'react';
import { AppLayout } from '@/components/layout/AppLayout';
import { Loader2, AlertCircle, CheckCircle, Plus, X, Zap, Upload, Eye } from 'lucide-react';

interface Advertiser {
  id: string;
  name: string;
  advertiserId: string;       // mapped from tiktokAdvertiserId
  appealId: string | null;
  appeal?: { name: string };
}

interface CustomAudience {
  custom_audience_id: string; // mapped from audience_id
  name: string;
}

interface GigafileFile {
  url: string;
  filename: string;
}

interface DeployResult {
  status: 'SUCCESS' | 'FAILED';
  adName?: string;
  adId?: string;
  campaignId?: string;
  crNumber?: number;
  error?: string;
  failedStep?: string;
}

type Step = 'settings' | 'videos' | 'preview' | 'deploy';

// 導線マッピング
const APPEAL_MAP: Record<string, string> = {
  '7468288053866561553': 'AI',
  '7523128243466551303': 'AI',
  '7543540647266074641': 'AI',
  '7580666710525493255': 'AI',
  '7247073333517238273': 'SNS',
  '7543540100849156112': 'SNS',
  '7543540381615800337': 'SNS',
  '7474920444831875080': 'スキルプラス',
  '7592868952431362066': 'スキルプラス',
};

const DEFAULT_BUDGETS: Record<string, number> = {
  'AI': 3000,
  'SNS': 3000,
  'スキルプラス': 5000,
};

const AD_TEXTS: Record<string, string> = {
  'SNS': 'SNS副業するなら学んでおきたい本質のSNSマーケ特商法（https://skill.addness.co.jp/tokushoho）',
  'AI': 'AIで独立するなら学んでおきたい本質のAI活用術特商法（https://skill.addness.co.jp/tokushoho）',
  'スキルプラス': '【大好評！】スキル習得セミナー AIは教えてくれない、会社に依存しない生き方です。',
};

export default function StreamlinedCreatorPage() {
  const [step, setStep] = useState<Step>('settings');
  const [advertisers, setAdvertisers] = useState<Advertiser[]>([]);
  const [customAudiences, setCustomAudiences] = useState<CustomAudience[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isLoadingAudiences, setIsLoadingAudiences] = useState(false);
  const [isPreviewing, setIsPreviewing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // 基本設定
  const [selectedAdvertiserId, setSelectedAdvertiserId] = useState('');
  const [appeal, setAppeal] = useState('');
  const [lpNumber, setLpNumber] = useState(1);
  const [dailyBudget, setDailyBudget] = useState(3000);
  const [creatorName, setCreatorName] = useState('');
  const [crName, setCrName] = useState('');
  const [adText, setAdText] = useState('');
  const [excludedAudienceIds, setExcludedAudienceIds] = useState<string[]>([]);

  // ギガファイル便URL
  const [gigafileUrls, setGigafileUrls] = useState<string[]>(['']);
  const [previewFiles, setPreviewFiles] = useState<GigafileFile[]>([]);

  // 出稿結果
  const [deployResults, setDeployResults] = useState<DeployResult[]>([]);
  const [currentDeployIndex, setCurrentDeployIndex] = useState(-1);
  const [isDeploying, setIsDeploying] = useState(false);

  const apiUrl = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:4000';

  useEffect(() => {
    fetchAdvertisers();
  }, []);

  // アカウント変更時に導線・予算・広告文を自動設定
  useEffect(() => {
    if (selectedAdvertiserId) {
      const detectedAppeal = APPEAL_MAP[selectedAdvertiserId] || '';
      setAppeal(detectedAppeal);
      setDailyBudget(DEFAULT_BUDGETS[detectedAppeal] || 3000);
      setAdText(AD_TEXTS[detectedAppeal] || '');
      fetchCustomAudiences(selectedAdvertiserId);
    }
  }, [selectedAdvertiserId]);

  const fetchAdvertisers = async () => {
    try {
      setIsLoading(true);
      const res = await fetch(`${apiUrl}/api/advertisers`);
      const json = await res.json();
      const list = Array.isArray(json) ? json : json.data || [];
      setAdvertisers(list.map((a: any) => ({
        ...a,
        advertiserId: a.advertiserId || a.tiktokAdvertiserId,
      })));
    } catch (err) {
      setError('アカウント一覧の取得に失敗しました');
    } finally {
      setIsLoading(false);
    }
  };

  const fetchCustomAudiences = async (advertiserId: string) => {
    try {
      setIsLoadingAudiences(true);
      const res = await fetch(`${apiUrl}/api/streamlined-creator/custom-audiences?advertiserId=${advertiserId}`);
      const data = await res.json();
      const audiences = Array.isArray(data) ? data : data.data || [];
      setCustomAudiences(audiences.map((a: any) => ({
        ...a,
        custom_audience_id: a.custom_audience_id || a.audience_id,
      })));
    } catch {
      setCustomAudiences([]);
    } finally {
      setIsLoadingAudiences(false);
    }
  };

  const handlePreview = async () => {
    const validUrls = gigafileUrls.filter(u => u.trim());
    if (validUrls.length === 0) {
      setError('ギガファイル便URLを入力してください');
      return;
    }

    try {
      setIsPreviewing(true);
      setError(null);
      const res = await fetch(`${apiUrl}/api/streamlined-creator/preview`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ gigafileUrls: validUrls }),
      });
      const data = await res.json();
      setPreviewFiles(data.files || []);
      setStep('preview');
    } catch (err) {
      setError('プレビューに失敗しました');
    } finally {
      setIsPreviewing(false);
    }
  };

  const handleDeploy = async () => {
    const validUrls = gigafileUrls.filter(u => u.trim());
    if (validUrls.length === 0) return;

    setIsDeploying(true);
    setStep('deploy');
    setDeployResults([]);
    setError(null);

    for (let i = 0; i < validUrls.length; i++) {
      setCurrentDeployIndex(i);
      try {
        const res = await fetch(`${apiUrl}/api/streamlined-creator/create-single`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            gigafileUrl: validUrls[i],
            advertiserId: selectedAdvertiserId,
            appeal,
            lpNumber,
            creatorName,
            crName,
            dailyBudget,
            excludedAudienceIds: excludedAudienceIds.length > 0 ? excludedAudienceIds : undefined,
            adText,
          }),
        });
        const result = await res.json();
        setDeployResults(prev => [...prev, result]);
      } catch (err) {
        setDeployResults(prev => [...prev, {
          status: 'FAILED' as const,
          error: err instanceof Error ? err.message : '通信エラー',
          failedStep: 'NETWORK',
        }]);
      }
    }

    setCurrentDeployIndex(-1);
    setIsDeploying(false);
  };

  const addUrlField = () => setGigafileUrls(prev => [...prev, '']);
  const removeUrlField = (index: number) => {
    setGigafileUrls(prev => prev.filter((_, i) => i !== index));
  };
  const updateUrl = (index: number, value: string) => {
    setGigafileUrls(prev => prev.map((u, i) => (i === index ? value : u)));
  };

  const toggleAudience = (id: string) => {
    setExcludedAudienceIds(prev =>
      prev.includes(id) ? prev.filter(a => a !== id) : [...prev, id]
    );
  };

  const canProceedToVideos = selectedAdvertiserId && creatorName && crName && lpNumber > 0;
  const canProceedToPreview = gigafileUrls.some(u => u.trim());

  if (isLoading) {
    return (
      <AppLayout>
        <div className="flex items-center justify-center h-64">
          <Loader2 className="w-8 h-8 animate-spin text-blue-500" />
        </div>
      </AppLayout>
    );
  }

  return (
    <AppLayout>
      <div className="max-w-4xl mx-auto">
        <div className="flex items-center gap-3 mb-6">
          <Zap className="w-7 h-7 text-yellow-400" />
          <h1 className="text-2xl font-bold text-white">ワンストップ出稿</h1>
        </div>

        {error && (
          <div className="bg-red-500/10 border border-red-500/30 rounded-lg p-4 mb-6 flex items-center gap-2">
            <AlertCircle className="w-5 h-5 text-red-400 shrink-0" />
            <p className="text-red-300 text-sm">{error}</p>
          </div>
        )}

        {/* ステップインジケーター */}
        <div className="flex items-center gap-2 mb-8">
          {(['settings', 'videos', 'preview', 'deploy'] as Step[]).map((s, i) => {
            const labels = ['基本設定', '動画URL', 'プレビュー', '出稿実行'];
            const isActive = s === step;
            const isPast = ['settings', 'videos', 'preview', 'deploy'].indexOf(s) < ['settings', 'videos', 'preview', 'deploy'].indexOf(step);
            return (
              <div key={s} className="flex items-center gap-2">
                <div className={`flex items-center gap-2 px-3 py-1.5 rounded-full text-sm ${
                  isActive ? 'bg-blue-600 text-white' : isPast ? 'bg-gray-700 text-gray-300' : 'bg-gray-800 text-gray-500'
                }`}>
                  <span className="font-medium">{i + 1}</span>
                  <span>{labels[i]}</span>
                </div>
                {i < 3 && <div className="w-6 h-px bg-gray-700" />}
              </div>
            );
          })}
        </div>

        {/* Step 1: 基本設定 */}
        {step === 'settings' && (
          <div className="space-y-6">
            <div className="bg-gray-900 border border-gray-800 rounded-lg p-6 space-y-4">
              <h2 className="text-lg font-semibold text-white">基本設定</h2>

              {/* アカウント選択 */}
              <div>
                <label className="block text-sm text-gray-400 mb-1">出稿アカウント</label>
                <select
                  value={selectedAdvertiserId}
                  onChange={e => setSelectedAdvertiserId(e.target.value)}
                  className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-white"
                >
                  <option value="">選択してください</option>
                  {advertisers.map(a => (
                    <option key={a.id} value={a.advertiserId}>
                      {a.name} ({a.advertiserId})
                    </option>
                  ))}
                </select>
              </div>

              {appeal && (
                <div className="text-sm text-gray-400">
                  導線: <span className="text-white font-medium">{appeal}</span>
                </div>
              )}

              {/* LP番号 */}
              <div>
                <label className="block text-sm text-gray-400 mb-1">LP番号</label>
                <input
                  type="number"
                  min={1}
                  value={lpNumber}
                  onChange={e => setLpNumber(parseInt(e.target.value) || 1)}
                  className="w-32 bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-white"
                />
              </div>

              {/* 制作者名 */}
              <div>
                <label className="block text-sm text-gray-400 mb-1">CR制作者名</label>
                <input
                  type="text"
                  value={creatorName}
                  onChange={e => setCreatorName(e.target.value)}
                  placeholder="例: 田中"
                  className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-white"
                />
              </div>

              {/* CR名 */}
              <div>
                <label className="block text-sm text-gray-400 mb-1">CR名</label>
                <input
                  type="text"
                  value={crName}
                  onChange={e => setCrName(e.target.value)}
                  placeholder="例: 新春CR"
                  className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-white"
                />
              </div>

              {/* 日予算 */}
              <div>
                <label className="block text-sm text-gray-400 mb-1">日予算 (円)</label>
                <input
                  type="number"
                  min={1000}
                  step={1000}
                  value={dailyBudget}
                  onChange={e => setDailyBudget(parseInt(e.target.value) || 3000)}
                  className="w-40 bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-white"
                />
              </div>

              {/* 広告文 */}
              <div>
                <label className="block text-sm text-gray-400 mb-1">広告文</label>
                <textarea
                  value={adText}
                  onChange={e => setAdText(e.target.value)}
                  rows={3}
                  className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-white text-sm"
                />
              </div>

              {/* 除外オーディエンス */}
              <div>
                <label className="block text-sm text-gray-400 mb-1">
                  除外オーディエンス
                  {isLoadingAudiences && <Loader2 className="w-3 h-3 animate-spin inline ml-2" />}
                </label>
                {customAudiences.length > 0 ? (
                  <div className="space-y-2 max-h-40 overflow-y-auto">
                    {customAudiences.map(a => (
                      <label key={a.custom_audience_id} className="flex items-center gap-2 text-sm text-gray-300">
                        <input
                          type="checkbox"
                          checked={excludedAudienceIds.includes(a.custom_audience_id)}
                          onChange={() => toggleAudience(a.custom_audience_id)}
                          className="rounded bg-gray-700 border-gray-600"
                        />
                        {a.name}
                      </label>
                    ))}
                  </div>
                ) : selectedAdvertiserId ? (
                  <p className="text-sm text-gray-500">カスタムオーディエンスがありません</p>
                ) : (
                  <p className="text-sm text-gray-500">アカウントを選択してください</p>
                )}
              </div>
            </div>

            <div className="flex justify-end">
              <button
                onClick={() => setStep('videos')}
                disabled={!canProceedToVideos}
                className="px-6 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed"
              >
                次へ: 動画URL入力
              </button>
            </div>
          </div>
        )}

        {/* Step 2: ギガファイル便URL入力 */}
        {step === 'videos' && (
          <div className="space-y-6">
            <div className="bg-gray-900 border border-gray-800 rounded-lg p-6 space-y-4">
              <h2 className="text-lg font-semibold text-white">ギガファイル便URL</h2>
              <p className="text-sm text-gray-400">動画ごとにURLを入力してください。1動画 = 1キャンペーンで作成されます。</p>

              {gigafileUrls.map((url, i) => (
                <div key={i} className="flex items-center gap-2">
                  <span className="text-gray-500 text-sm w-8">{i + 1}.</span>
                  <input
                    type="text"
                    value={url}
                    onChange={e => updateUrl(i, e.target.value)}
                    placeholder="https://xx.gigafile.nu/..."
                    className="flex-1 bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-white text-sm"
                  />
                  {gigafileUrls.length > 1 && (
                    <button
                      onClick={() => removeUrlField(i)}
                      className="p-2 text-gray-500 hover:text-red-400"
                    >
                      <X className="w-4 h-4" />
                    </button>
                  )}
                </div>
              ))}

              <button
                onClick={addUrlField}
                className="flex items-center gap-2 text-sm text-blue-400 hover:text-blue-300"
              >
                <Plus className="w-4 h-4" />
                URLを追加
              </button>
            </div>

            <div className="flex justify-between">
              <button
                onClick={() => setStep('settings')}
                className="px-6 py-2 bg-gray-700 text-white rounded-lg hover:bg-gray-600"
              >
                戻る
              </button>
              <button
                onClick={handlePreview}
                disabled={!canProceedToPreview || isPreviewing}
                className="flex items-center gap-2 px-6 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {isPreviewing ? (
                  <Loader2 className="w-4 h-4 animate-spin" />
                ) : (
                  <Eye className="w-4 h-4" />
                )}
                プレビュー
              </button>
            </div>
          </div>
        )}

        {/* Step 3: プレビュー */}
        {step === 'preview' && (
          <div className="space-y-6">
            <div className="bg-gray-900 border border-gray-800 rounded-lg p-6 space-y-4">
              <h2 className="text-lg font-semibold text-white">出稿プレビュー</h2>

              <div className="space-y-3">
                <div className="grid grid-cols-2 gap-4 text-sm">
                  <div>
                    <span className="text-gray-400">アカウント:</span>
                    <span className="text-white ml-2">
                      {advertisers.find(a => a.advertiserId === selectedAdvertiserId)?.name}
                    </span>
                  </div>
                  <div>
                    <span className="text-gray-400">導線:</span>
                    <span className="text-white ml-2">{appeal}</span>
                  </div>
                  <div>
                    <span className="text-gray-400">LP番号:</span>
                    <span className="text-white ml-2">LP{lpNumber}</span>
                  </div>
                  <div>
                    <span className="text-gray-400">日予算:</span>
                    <span className="text-white ml-2">¥{dailyBudget.toLocaleString()}</span>
                  </div>
                  <div className="col-span-2">
                    <span className="text-gray-400">広告名形式:</span>
                    <span className="text-white ml-2">YYMMDD/{creatorName}/{crName}/LP{lpNumber}-CR*****</span>
                  </div>
                  <div className="col-span-2">
                    <span className="text-gray-400">広告文:</span>
                    <span className="text-white ml-2 text-xs">{adText}</span>
                  </div>
                  {excludedAudienceIds.length > 0 && (
                    <div className="col-span-2">
                      <span className="text-gray-400">除外オーディエンス:</span>
                      <span className="text-white ml-2">{excludedAudienceIds.length}件選択</span>
                    </div>
                  )}
                </div>
              </div>

              <hr className="border-gray-800" />

              <h3 className="text-sm font-semibold text-gray-300">動画ファイル ({previewFiles.length}本)</h3>
              <div className="space-y-2">
                {previewFiles.map((f, i) => (
                  <div key={i} className="flex items-center gap-3 bg-gray-800 rounded-lg px-4 py-3">
                    <Upload className="w-4 h-4 text-gray-400" />
                    <div className="flex-1">
                      <p className="text-white text-sm">{f.filename}</p>
                      <p className="text-gray-500 text-xs truncate">{f.url}</p>
                    </div>
                  </div>
                ))}
              </div>
            </div>

            <div className="flex justify-between">
              <button
                onClick={() => setStep('videos')}
                className="px-6 py-2 bg-gray-700 text-white rounded-lg hover:bg-gray-600"
              >
                戻る
              </button>
              <button
                onClick={handleDeploy}
                className="flex items-center gap-2 px-6 py-2 bg-green-600 text-white rounded-lg hover:bg-green-700 font-medium"
              >
                <Zap className="w-4 h-4" />
                出稿開始 ({previewFiles.length}本)
              </button>
            </div>
          </div>
        )}

        {/* Step 4: 出稿実行 */}
        {step === 'deploy' && (
          <div className="space-y-6">
            <div className="bg-gray-900 border border-gray-800 rounded-lg p-6 space-y-4">
              <h2 className="text-lg font-semibold text-white">
                {isDeploying ? '出稿中...' : '出稿完了'}
              </h2>

              <div className="space-y-3">
                {gigafileUrls.filter(u => u.trim()).map((url, i) => {
                  const result = deployResults[i];
                  const isCurrent = i === currentDeployIndex;

                  return (
                    <div key={i} className={`rounded-lg px-4 py-3 ${
                      result?.status === 'SUCCESS'
                        ? 'bg-green-500/10 border border-green-500/30'
                        : result?.status === 'FAILED'
                          ? 'bg-red-500/10 border border-red-500/30'
                          : isCurrent
                            ? 'bg-blue-500/10 border border-blue-500/30'
                            : 'bg-gray-800 border border-gray-700'
                    }`}>
                      <div className="flex items-center gap-3">
                        {result?.status === 'SUCCESS' ? (
                          <CheckCircle className="w-5 h-5 text-green-400 shrink-0" />
                        ) : result?.status === 'FAILED' ? (
                          <AlertCircle className="w-5 h-5 text-red-400 shrink-0" />
                        ) : isCurrent ? (
                          <Loader2 className="w-5 h-5 text-blue-400 animate-spin shrink-0" />
                        ) : (
                          <div className="w-5 h-5 rounded-full border border-gray-600 shrink-0" />
                        )}
                        <div className="flex-1 min-w-0">
                          <p className="text-white text-sm font-medium">
                            動画 {i + 1}: {previewFiles[i]?.filename || url.substring(0, 50)}
                          </p>
                          {result?.status === 'SUCCESS' && (
                            <div className="text-green-300 text-xs mt-1">
                              {result.adName} (広告ID: {result.adId})
                            </div>
                          )}
                          {result?.status === 'FAILED' && (
                            <div className="text-red-300 text-xs mt-1">
                              失敗 ({result.failedStep}): {result.error}
                            </div>
                          )}
                          {isCurrent && (
                            <div className="text-blue-300 text-xs mt-1">処理中...</div>
                          )}
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>

              {!isDeploying && deployResults.length > 0 && (
                <div className="mt-4 pt-4 border-t border-gray-800">
                  <p className="text-sm text-gray-300">
                    成功: {deployResults.filter(r => r.status === 'SUCCESS').length} / {deployResults.length}本
                  </p>
                </div>
              )}
            </div>

            {!isDeploying && (
              <div className="flex justify-between">
                <button
                  onClick={() => {
                    setStep('settings');
                    setDeployResults([]);
                    setPreviewFiles([]);
                    setGigafileUrls(['']);
                  }}
                  className="px-6 py-2 bg-gray-700 text-white rounded-lg hover:bg-gray-600"
                >
                  新しい出稿を開始
                </button>
              </div>
            )}
          </div>
        )}
      </div>
    </AppLayout>
  );
}

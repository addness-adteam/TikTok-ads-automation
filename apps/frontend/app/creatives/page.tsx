'use client';

import { useState, useEffect, useRef } from 'react';
import { AppLayout } from '@/components/layout/AppLayout';
import { Upload, Loader2, AlertCircle, CheckCircle, Trash2, Video, Image as ImageIcon } from 'lucide-react';
import SparkMD5 from 'spark-md5';

interface Creative {
  id: string;
  name: string;
  type: 'VIDEO' | 'IMAGE';
  url: string;
  tiktokVideoId?: string;
  tiktokImageId?: string;
  advertiserId: string;
  advertiser?: {
    name: string;
  };
  createdAt: string;
}

interface Advertiser {
  id: string;
  name: string;
  advertiserId: string;
}

export default function CreativesPage() {
  const [creatives, setCreatives] = useState<Creative[]>([]);
  const [advertisers, setAdvertisers] = useState<Advertiser[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isUploading, setIsUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);

  // アップロードフォームの状態
  const [selectedAdvertiserId, setSelectedAdvertiserId] = useState('');
  const [file, setFile] = useState<File | null>(null);
  const [creativeName, setCreativeName] = useState('');
  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    fetchData();
  }, []);

  const fetchData = async () => {
    try {
      setIsLoading(true);
      const apiUrl = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:4000';
      const [creativesRes, advertisersRes] = await Promise.all([
        fetch(`${apiUrl}/api/creatives`),
        fetch(`${apiUrl}/api/advertisers`),
      ]);

      if (!creativesRes.ok || !advertisersRes.ok) {
        throw new Error('データの取得に失敗しました');
      }

      const creativesData = await creativesRes.json();
      const advertisersData = await advertisersRes.json();

      setCreatives(creativesData.data || creativesData);
      setAdvertisers(advertisersData.data || advertisersData);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'データの取得に失敗しました');
    } finally {
      setIsLoading(false);
    }
  };

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const selectedFile = e.target.files?.[0];
    if (selectedFile) {
      setFile(selectedFile);
      // ファイル名から拡張子を除いた名前をデフォルトのCreative名にする
      const nameWithoutExt = selectedFile.name.replace(/\.[^/.]+$/, '');
      setCreativeName(nameWithoutExt);
    }
  };

  // MD5ハッシュ計算
  const calculateMD5 = async (file: File): Promise<string> => {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = (e) => {
        const spark = new SparkMD5.ArrayBuffer();
        spark.append(e.target?.result as ArrayBuffer);
        const hash = spark.end();
        resolve(hash);
      };
      reader.onerror = () => reject(new Error('ファイルの読み込みに失敗しました'));
      reader.readAsArrayBuffer(file);
    });
  };

  const handleUpload = async (e: React.FormEvent) => {
    e.preventDefault();

    // バリデーション
    if (!selectedAdvertiserId) {
      alert('広告アカウントを選択してください');
      return;
    }
    if (!file) {
      alert('ファイルを選択してください');
      return;
    }
    if (!creativeName) {
      alert('Creative名を入力してください');
      return;
    }

    setIsUploading(true);
    setError(null);
    setSuccessMessage(null);

    try {
      const apiUrl = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:4000';

      // ステップ1: アクセストークンとAPI情報を取得
      const tokenResponse = await fetch(`${apiUrl}/api/creatives/upload-token?advertiserId=${selectedAdvertiserId}`);
      const tokenResult = await tokenResponse.json();

      if (!tokenResponse.ok || !tokenResult.success) {
        throw new Error(tokenResult.error || 'アクセストークンの取得に失敗しました');
      }

      const { accessToken, tiktokAdvertiserId, apiBaseUrl } = tokenResult.data;

      // ファイルタイプを判定
      const isVideo = file.type.startsWith('video/');
      const isImage = file.type.startsWith('image/');

      if (!isVideo && !isImage) {
        throw new Error('動画または画像ファイルのみアップロード可能です');
      }

      let tiktokVideoId: string | undefined;
      let tiktokImageId: string | undefined;

      if (isVideo) {
        // ステップ2: TikTok APIに動画を直接アップロード
        const md5Hash = await calculateMD5(file);

        // 日本語ファイル名の文字化けを防ぐため、英数字のファイル名を生成
        const ext = file.name.split('.').pop() || 'mp4';
        const sanitizedFilename = `video_${Date.now()}_${md5Hash.substring(0, 8)}.${ext}`;

        const videoFormData = new FormData();
        videoFormData.append('advertiser_id', tiktokAdvertiserId);
        videoFormData.append('upload_type', 'UPLOAD_BY_FILE');
        videoFormData.append('video_signature', md5Hash);
        videoFormData.append('video_file', file, sanitizedFilename);

        const videoResponse = await fetch(`${apiBaseUrl}/v1.3/file/video/ad/upload/`, {
          method: 'POST',
          headers: {
            'Access-Token': accessToken,
          },
          body: videoFormData,
        });

        const videoResult = await videoResponse.json();

        if (!videoResponse.ok || videoResult.code !== 0) {
          throw new Error(videoResult.message || 'TikTokへの動画アップロードに失敗しました');
        }

        // TikTok API v1.3 returns data as an array
        const videoData = Array.isArray(videoResult.data) ? videoResult.data[0] : videoResult.data;
        tiktokVideoId = videoData.video_id;

        if (!tiktokVideoId) {
          throw new Error('TikTok Video IDの取得に失敗しました');
        }

        // 動画のカバー画像を取得してサムネイル用の画像IDを作成
        try {
          const videoInfoResponse = await fetch(
            `${apiBaseUrl}/v1.3/file/video/ad/info/?advertiser_id=${tiktokAdvertiserId}&video_ids=${JSON.stringify([tiktokVideoId])}`,
            {
              headers: {
                'Access-Token': accessToken,
              },
            }
          );

          const videoInfoResult = await videoInfoResponse.json();
          const videoInfo = videoInfoResult.data?.list?.[0];
          const videoCoverUrl = videoInfo?.video_cover_url;

          if (videoCoverUrl) {
            // カバー画像をTikTokに画像としてアップロード
            const imageResponse = await fetch(`${apiBaseUrl}/v1.3/file/image/ad/upload/`, {
              method: 'POST',
              headers: {
                'Access-Token': accessToken,
                'Content-Type': 'application/json',
              },
              body: JSON.stringify({
                advertiser_id: tiktokAdvertiserId,
                image_url: videoCoverUrl,
                upload_type: 'UPLOAD_BY_URL',
              }),
            });

            const imageResult = await imageResponse.json();
            if (imageResult.code === 0) {
              tiktokImageId = imageResult.data?.image_id;
            }
          }
        } catch (err) {
          console.warn('サムネイル画像の取得に失敗しましたが、処理を続行します', err);
        }
      } else {
        // 画像の場合は実装が必要（将来的に追加）
        throw new Error('画像アップロードは現在対応していません');
      }

      // ステップ3: バックエンドのDBに登録
      const registerResponse = await fetch(`${apiUrl}/api/creatives/register`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          advertiserId: selectedAdvertiserId,
          name: creativeName,
          type: isVideo ? 'VIDEO' : 'IMAGE',
          tiktokVideoId,
          tiktokImageId,
          filename: file.name,
          fileSize: file.size,
        }),
      });

      const registerResult = await registerResponse.json();

      if (!registerResponse.ok || !registerResult.success) {
        throw new Error(registerResult.error || 'DB登録に失敗しました');
      }

      setSuccessMessage('Creativeのアップロードに成功しました！');

      // フォームをリセット
      setFile(null);
      setCreativeName('');
      if (fileInputRef.current) {
        fileInputRef.current.value = '';
      }

      // Creativeリストを再取得
      await fetchData();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'アップロードに失敗しました');
    } finally {
      setIsUploading(false);
    }
  };

  const handleDelete = async (id: string) => {
    if (!confirm('このCreativeを削除しますか？')) return;

    try {
      const apiUrl = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:4000';
      const response = await fetch(`${apiUrl}/api/creatives/${id}`, {
        method: 'DELETE',
      });

      if (!response.ok) throw new Error('削除に失敗しました');

      await fetchData();
      setSuccessMessage('Creativeを削除しました');
    } catch (err) {
      setError(err instanceof Error ? err.message : '削除に失敗しました');
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
          <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-4">
            <h1 className="text-2xl font-bold text-gray-900">Creative管理</h1>
            <p className="text-sm text-gray-600 mt-1">動画・画像の管理とTikTokへのアップロード</p>
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

          {/* アップロードフォーム */}
          <div className="bg-white rounded-lg border border-gray-200 p-6 mb-8">
            <h2 className="text-lg font-bold text-gray-900 mb-4">新規Creative アップロード</h2>
            <form onSubmit={handleUpload} className="space-y-4">
              {/* 広告アカウント選択 */}
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  広告アカウント <span className="text-red-500">*</span>
                </label>
                <select
                  value={selectedAdvertiserId}
                  onChange={(e) => setSelectedAdvertiserId(e.target.value)}
                  className="w-full px-4 py-3 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                  disabled={isUploading}
                >
                  <option value="">広告アカウントを選択してください</option>
                  {advertisers.map((advertiser) => (
                    <option key={advertiser.id} value={advertiser.id}>
                      {advertiser.name}
                    </option>
                  ))}
                </select>
              </div>

              {/* ファイル選択 */}
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  ファイル（動画/画像） <span className="text-red-500">*</span>
                </label>
                <div className="flex items-center gap-4">
                  <label className="flex-1 cursor-pointer">
                    <div className="flex items-center justify-center gap-2 px-4 py-3 border-2 border-dashed border-gray-300 rounded-lg hover:border-blue-500 transition-colors">
                      <Upload className="w-5 h-5 text-gray-400" />
                      <span className="text-sm text-gray-600">
                        {file ? file.name : 'ファイルを選択'}
                      </span>
                    </div>
                    <input
                      ref={fileInputRef}
                      type="file"
                      accept="video/*,image/*"
                      onChange={handleFileChange}
                      className="hidden"
                      disabled={isUploading}
                    />
                  </label>
                </div>
                <p className="mt-2 text-xs text-gray-500">
                  対応形式: MP4, MOV (動画) / JPG, PNG (画像)
                </p>
              </div>

              {/* Creative名 */}
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  Creative名 <span className="text-red-500">*</span>
                </label>
                <input
                  type="text"
                  value={creativeName}
                  onChange={(e) => setCreativeName(e.target.value)}
                  className="w-full px-4 py-3 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                  placeholder="例: 春キャンペーン動画01"
                  disabled={isUploading}
                />
              </div>

              {/* アップロードボタン */}
              <div className="flex justify-end">
                <button
                  type="submit"
                  disabled={isUploading}
                  className="flex items-center gap-2 px-6 py-3 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:bg-gray-400 disabled:cursor-not-allowed transition-colors"
                >
                  {isUploading ? (
                    <>
                      <Loader2 className="w-5 h-5 animate-spin" />
                      アップロード中...
                    </>
                  ) : (
                    <>
                      <Upload className="w-5 h-5" />
                      アップロード
                    </>
                  )}
                </button>
              </div>
            </form>
          </div>

          {/* Creative一覧 */}
          <div>
            <h2 className="text-lg font-bold text-gray-900 mb-4">Creative一覧</h2>
            {creatives.length > 0 ? (
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
                {creatives.map((creative) => (
                  <div key={creative.id} className="bg-white rounded-lg border border-gray-200 overflow-hidden">
                    {/* メディア表示 */}
                    <div className="relative aspect-video bg-gray-100">
                      {creative.type === 'VIDEO' ? (
                        <video
                          src={creative.url}
                          controls
                          className="w-full h-full object-cover"
                        />
                      ) : (
                        <img
                          src={creative.url}
                          alt={creative.name}
                          className="w-full h-full object-cover"
                        />
                      )}
                      <div className="absolute top-2 left-2 px-2 py-1 bg-black bg-opacity-70 rounded text-white text-xs flex items-center gap-1">
                        {creative.type === 'VIDEO' ? (
                          <>
                            <Video className="w-3 h-3" />
                            動画
                          </>
                        ) : (
                          <>
                            <ImageIcon className="w-3 h-3" />
                            画像
                          </>
                        )}
                      </div>
                    </div>

                    {/* 情報 */}
                    <div className="p-4">
                      <h3 className="font-bold text-gray-900 mb-2 truncate">{creative.name}</h3>
                      <div className="space-y-1 text-sm text-gray-600 mb-3">
                        <p>アカウント: {creative.advertiser?.name || '不明'}</p>
                        {(creative.tiktokVideoId || creative.tiktokImageId) && (
                          <p className="text-xs text-green-600">TikTok ID: {creative.tiktokVideoId || creative.tiktokImageId}</p>
                        )}
                        <p className="text-xs text-gray-500">
                          {new Date(creative.createdAt).toLocaleDateString('ja-JP')}
                        </p>
                      </div>

                      {/* 削除ボタン */}
                      <button
                        onClick={() => handleDelete(creative.id)}
                        className="w-full flex items-center justify-center gap-2 px-3 py-2 text-red-600 border border-red-200 rounded-lg hover:bg-red-50 transition-colors"
                      >
                        <Trash2 className="w-4 h-4" />
                        削除
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <div className="text-center py-12 bg-white rounded-lg border border-gray-200">
                <p className="text-gray-500">Creativeが登録されていません</p>
              </div>
            )}
          </div>
        </main>
      </div>
    </AppLayout>
  );
}

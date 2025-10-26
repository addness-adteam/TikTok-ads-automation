'use client';

import { useEffect, useState, Suspense } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { useAuth } from '@/lib/context/AuthContext';
import { Loader2, CheckCircle, XCircle } from 'lucide-react';

function AboutContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { login } = useAuth();
  const [status, setStatus] = useState<'processing' | 'success' | 'error' | 'about'>('about');
  const [message, setMessage] = useState('');

  useEffect(() => {
    // OAuth callbackの処理（auth_codeが存在する場合）
    const authCode = searchParams.get('auth_code');
    const error = searchParams.get('error');

    if (authCode || error) {
      handleOAuthCallback(authCode, error);
    }
  }, [searchParams]);

  const handleOAuthCallback = async (authCode: string | null, error: string | null) => {
    setStatus('processing');
    setMessage('認証情報を処理中...');

    try {
      if (error) {
        setStatus('error');
        setMessage(`認証エラー: ${error}`);
        return;
      }

      if (!authCode) {
        setStatus('error');
        setMessage('認証コードが取得できませんでした');
        return;
      }

      setMessage('アクセストークンを取得中...');

      // バックエンドにauth_codeを送信してトークンを取得
      const response = await fetch(`${process.env.NEXT_PUBLIC_API_URL}/auth/tiktok/token`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ authCode }),
      });

      const data = await response.json();

      if (!data.success) {
        setStatus('error');
        setMessage(data.error?.message || '認証に失敗しました');
        return;
      }

      const tokenData = data.data.data;
      const accessToken = tokenData.access_token;
      const advertiserIds = tokenData.advertiser_ids || [];

      if (!accessToken || advertiserIds.length === 0) {
        setStatus('error');
        setMessage('有効な認証情報を取得できませんでした');
        return;
      }

      // 認証情報を保存
      login(accessToken, advertiserIds);

      setStatus('success');
      setMessage('ログイン成功！ダッシュボードに移動します...');

      // ダッシュボードにリダイレクト
      setTimeout(() => {
        router.push('/dashboard');
      }, 1500);
    } catch (error) {
      console.error('Callback error:', error);
      setStatus('error');
      setMessage('認証処理中にエラーが発生しました');
    }
  };

  // OAuth処理中の表示
  if (status !== 'about') {
    return (
      <div className="min-h-screen bg-gradient-to-br from-blue-50 to-indigo-100 flex items-center justify-center p-4">
        <div className="max-w-md w-full bg-white rounded-2xl shadow-xl p-8 text-center">
          {status === 'processing' && (
            <>
              <Loader2 className="w-16 h-16 text-blue-600 animate-spin mx-auto mb-4" />
              <h2 className="text-2xl font-bold text-gray-900 mb-2">処理中...</h2>
              <p className="text-gray-600">{message}</p>
            </>
          )}

          {status === 'success' && (
            <>
              <CheckCircle className="w-16 h-16 text-green-600 mx-auto mb-4" />
              <h2 className="text-2xl font-bold text-gray-900 mb-2">ログイン成功！</h2>
              <p className="text-gray-600">{message}</p>
            </>
          )}

          {status === 'error' && (
            <>
              <XCircle className="w-16 h-16 text-red-600 mx-auto mb-4" />
              <h2 className="text-2xl font-bold text-gray-900 mb-2">エラーが発生しました</h2>
              <p className="text-red-600 mb-6">{message}</p>
              <button
                onClick={() => router.push('/login')}
                className="bg-blue-600 text-white font-semibold py-3 px-6 rounded-lg hover:bg-blue-700 transition-colors"
              >
                ログインページに戻る
              </button>
            </>
          )}
        </div>
      </div>
    );
  }

  // 通常のAboutページ表示（auth_codeがない場合）
  return (
    <div className="min-h-screen bg-gradient-to-br from-blue-50 to-indigo-100 py-12 px-4">
      <div className="max-w-4xl mx-auto">
        <div className="bg-white rounded-2xl shadow-xl p-8">
          <h1 className="text-4xl font-bold text-gray-900 mb-6">TikTok広告運用自動化システムについて</h1>

          <div className="prose max-w-none">
            <h2 className="text-2xl font-semibold text-gray-800 mt-8 mb-4">概要</h2>
            <p className="text-gray-600 mb-4">
              このシステムは、TikTok広告の運用を自動化し、効率的な広告配信を実現するプラットフォームです。
            </p>

            <h2 className="text-2xl font-semibold text-gray-800 mt-8 mb-4">主な機能</h2>
            <ul className="list-disc list-inside text-gray-600 space-y-2 mb-4">
              <li>キャンペーンの自動作成・管理</li>
              <li>リアルタイムパフォーマンス分析</li>
              <li>自動最適化エンジン</li>
              <li>詳細なレポート機能</li>
            </ul>

            <h2 className="text-2xl font-semibold text-gray-800 mt-8 mb-4">技術スタック</h2>
            <ul className="list-disc list-inside text-gray-600 space-y-2 mb-4">
              <li>フロントエンド: Next.js 15 + React 19 + TypeScript</li>
              <li>バックエンド: NestJS + Prisma</li>
              <li>データベース: PostgreSQL (Neon)</li>
              <li>デプロイ: Vercel</li>
            </ul>

            <div className="mt-8">
              <button
                onClick={() => router.push('/')}
                className="bg-blue-600 text-white font-semibold py-3 px-6 rounded-lg hover:bg-blue-700 transition-colors"
              >
                ホームに戻る
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

export default function AboutPage() {
  return (
    <Suspense fallback={
      <div className="min-h-screen bg-gradient-to-br from-blue-50 to-indigo-100 flex items-center justify-center">
        <Loader2 className="w-12 h-12 text-blue-600 animate-spin" />
      </div>
    }>
      <AboutContent />
    </Suspense>
  );
}

'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/lib/context/AuthContext';
import { LogIn, Loader2 } from 'lucide-react';

export default function LoginPage() {
  const router = useRouter();
  const { isAuthenticated, isLoading } = useAuth();
  const [isRedirecting, setIsRedirecting] = useState(false);

  useEffect(() => {
    if (isAuthenticated && !isLoading) {
      router.push('/dashboard');
    }
  }, [isAuthenticated, isLoading, router]);

  const handleLogin = async () => {
    try {
      setIsRedirecting(true);

      // バックエンドから認証URLを取得
      const response = await fetch(`${process.env.NEXT_PUBLIC_API_URL}/auth/tiktok/url`);
      const data = await response.json();

      if (data.authUrl) {
        // TikTok認証ページへリダイレクト
        window.location.href = data.authUrl;
      } else {
        alert('認証URLの取得に失敗しました');
        setIsRedirecting(false);
      }
    } catch (error) {
      console.error('Login error:', error);
      alert('ログインに失敗しました');
      setIsRedirecting(false);
    }
  };

  if (isLoading) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-blue-50 to-indigo-100 flex items-center justify-center">
        <Loader2 className="w-12 h-12 text-blue-600 animate-spin" />
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-blue-50 to-indigo-100 flex items-center justify-center p-4">
      <div className="max-w-md w-full">
        <div className="bg-white rounded-2xl shadow-xl p-8">
          {/* ヘッダー */}
          <div className="text-center mb-8">
            <div className="inline-flex items-center justify-center w-16 h-16 bg-blue-100 rounded-full mb-4">
              <LogIn className="w-8 h-8 text-blue-600" />
            </div>
            <h1 className="text-3xl font-bold text-gray-900 mb-2">
              TikTok広告運用自動化
            </h1>
            <p className="text-gray-600">
              TikTokアカウントでログインしてください
            </p>
          </div>

          {/* ログインボタン */}
          <button
            onClick={handleLogin}
            disabled={isRedirecting}
            className="w-full bg-gradient-to-r from-blue-600 to-indigo-600 text-white font-semibold py-4 px-6 rounded-lg hover:from-blue-700 hover:to-indigo-700 transition-all transform hover:scale-105 disabled:opacity-50 disabled:cursor-not-allowed disabled:transform-none flex items-center justify-center gap-3 shadow-lg"
          >
            {isRedirecting ? (
              <>
                <Loader2 className="w-5 h-5 animate-spin" />
                TikTokにリダイレクト中...
              </>
            ) : (
              <>
                <LogIn className="w-5 h-5" />
                TikTokでログイン
              </>
            )}
          </button>

          {/* 説明 */}
          <div className="mt-6 p-4 bg-gray-50 rounded-lg">
            <h3 className="text-sm font-semibold text-gray-900 mb-2">
              ログイン後にできること:
            </h3>
            <ul className="text-sm text-gray-600 space-y-1">
              <li>• 広告キャンペーンのパフォーマンス確認</li>
              <li>• リアルタイムKPI表示</li>
              <li>• 自動最適化レポート</li>
              <li>• Campaign作成・管理</li>
            </ul>
          </div>

          {/* フッター */}
          <p className="mt-6 text-center text-xs text-gray-500">
            TikTok for Businessアカウントが必要です
          </p>
        </div>

        {/* セキュリティ情報 */}
        <div className="mt-4 text-center text-xs text-gray-600">
          <p>🔒 OAuth 2.0による安全な認証</p>
        </div>
      </div>
    </div>
  );
}

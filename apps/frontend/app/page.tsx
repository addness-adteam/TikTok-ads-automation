'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';

export default function Home() {
  const router = useRouter();

  // 常にダッシュボードにリダイレクト（OAuth認証不要）
  useEffect(() => {
    router.push('/dashboard');
  }, [router]);
  return (
    <div className="min-h-screen bg-gradient-to-br from-blue-50 to-indigo-100 flex items-center justify-center p-8">
      <div className="max-w-4xl w-full">
        <div className="text-center mb-12">
          <h1 className="text-5xl font-bold text-gray-900 mb-4">
            TikTok広告運用自動化システム
          </h1>
          <p className="text-xl text-gray-600">
            誰でも最適運用できる環境を提供
          </p>
        </div>

        <div className="grid md:grid-cols-2 gap-6 mb-12">
          <div className="bg-white rounded-lg shadow-lg p-8 hover:shadow-xl transition-shadow">
            <h2 className="text-2xl font-bold text-gray-900 mb-4">📊 ダッシュボード</h2>
            <p className="text-gray-600 mb-6">
              広告パフォーマンスをリアルタイムで確認。KPI、グラフ、Campaign一覧を表示。
            </p>
            <Link
              href="/login"
              className="inline-block w-full text-center bg-blue-600 text-white font-semibold py-3 px-6 rounded-lg hover:bg-blue-700 transition-colors"
            >
              ログインして始める
            </Link>
          </div>

          <div className="bg-white rounded-lg shadow-lg p-8 hover:shadow-xl transition-shadow">
            <h2 className="text-2xl font-bold text-gray-900 mb-4">🚀 主要機能</h2>
            <ul className="text-gray-600 space-y-2 mb-6">
              <li>✅ OAuth 2.0 認証フロー</li>
              <li>✅ Campaign 作成・管理</li>
              <li>✅ Reporting API 連携</li>
              <li>✅ KPI可視化</li>
            </ul>
          </div>
        </div>

        <div className="bg-white rounded-lg shadow-lg p-8">
          <h2 className="text-2xl font-bold text-gray-900 mb-4">📦 技術スタック</h2>
          <div className="grid md:grid-cols-2 gap-4 text-gray-600">
            <div>
              <h3 className="font-semibold mb-2">フロントエンド</h3>
              <ul className="space-y-1 text-sm">
                <li>• Next.js 15 (App Router)</li>
                <li>• React 19</li>
                <li>• TypeScript</li>
                <li>• Tailwind CSS</li>
                <li>• Recharts</li>
              </ul>
            </div>
            <div>
              <h3 className="font-semibold mb-2">バックエンド</h3>
              <ul className="space-y-1 text-sm">
                <li>• NestJS</li>
                <li>• Prisma ORM</li>
                <li>• PostgreSQL (Supabase)</li>
                <li>• Redis (Upstash)</li>
                <li>• TikTok Business API v1.3</li>
              </ul>
            </div>
          </div>
        </div>

        <div className="text-center mt-8 text-gray-600 text-sm">
          <p>Phase 0 (PoC) - Week 1-4 🚧</p>
        </div>
      </div>
    </div>
  );
}

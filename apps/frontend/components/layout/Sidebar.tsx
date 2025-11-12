'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { LayoutDashboard, Target, Megaphone, Image, Settings, Sliders } from 'lucide-react';

const menuItems = [
  {
    name: 'ダッシュボード',
    href: '/dashboard',
    icon: LayoutDashboard,
  },
  {
    name: 'KPI設定',
    href: '/appeals',
    icon: Target,
  },
  {
    name: 'キャンペーン作成',
    href: '/campaign-builder',
    icon: Megaphone,
  },
  {
    name: 'Creative管理',
    href: '/creatives',
    icon: Image,
  },
  {
    name: '予算調整',
    href: '/optimization',
    icon: Sliders,
  },
];

export function Sidebar() {
  const pathname = usePathname();

  return (
    <aside className="w-64 bg-black border-r border-gray-800 min-h-screen">
      <div className="p-6">
        <h2 className="text-xl font-bold text-white">TikTok広告</h2>
        <p className="text-xs text-gray-300 mt-1">運用自動化システム</p>
      </div>

      <nav className="px-3">
        {menuItems.map((item) => {
          const isActive = pathname === item.href;
          const Icon = item.icon;

          return (
            <Link
              key={item.href}
              href={item.href}
              className={`
                flex items-center gap-3 px-3 py-2.5 rounded-lg mb-1 transition-colors
                ${isActive
                  ? 'bg-gray-800 text-white font-medium'
                  : 'text-white hover:bg-gray-800'
                }
              `}
            >
              <Icon className="w-5 h-5" />
              <span>{item.name}</span>
            </Link>
          );
        })}
      </nav>
    </aside>
  );
}

'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { LayoutDashboard, Target, Megaphone, Image, Sliders, TrendingUp, DollarSign, ChevronDown } from 'lucide-react';
import { useAuth } from '@/lib/context/AuthContext';
import { NotificationPanel } from '@/components/notifications/NotificationPanel';
import { useState } from 'react';

interface MenuItem {
  name: string;
  href: string;
  icon: React.ComponentType<{ className?: string }>;
  subItems?: { name: string; href: string }[];
}

const menuItems: MenuItem[] = [
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
  {
    name: '広告パフォーマンス',
    href: '/ad-performance',
    icon: TrendingUp,
    subItems: [
      { name: 'パフォーマンス一覧', href: '/ad-performance' },
      { name: '上限日予算設定', href: '/ad-performance/budget-caps' },
    ],
  },
];

export function Sidebar() {
  const pathname = usePathname();
  const { advertiserId } = useAuth();
  const [expandedItems, setExpandedItems] = useState<string[]>([]);

  // サブメニューを持つアイテムが選択されている場合、自動的に展開
  const isExpanded = (item: MenuItem) => {
    if (expandedItems.includes(item.href)) return true;
    if (item.subItems && pathname?.startsWith(item.href)) return true;
    return false;
  };

  const toggleExpand = (href: string) => {
    setExpandedItems((prev) =>
      prev.includes(href) ? prev.filter((h) => h !== href) : [...prev, href]
    );
  };

  return (
    <aside className="w-64 bg-black border-r border-gray-800 min-h-screen flex flex-col">
      <div className="p-6 flex items-center justify-between">
        <div>
          <h2 className="text-xl font-bold text-white">TikTok広告</h2>
          <p className="text-xs text-gray-300 mt-1">運用自動化システム</p>
        </div>
        {advertiserId && <NotificationPanel advertiserId={advertiserId} />}
      </div>

      <nav className="px-3 flex-1">
        {menuItems.map((item) => {
          const isActive = pathname === item.href;
          const isInSubMenu = item.subItems && pathname?.startsWith(item.href);
          const Icon = item.icon;
          const hasSubItems = item.subItems && item.subItems.length > 0;
          const expanded = isExpanded(item);

          if (hasSubItems) {
            return (
              <div key={item.href}>
                <button
                  onClick={() => toggleExpand(item.href)}
                  className={`
                    w-full flex items-center justify-between gap-3 px-3 py-2.5 rounded-lg mb-1 transition-colors
                    ${isInSubMenu
                      ? 'bg-gray-800 text-white font-medium'
                      : 'text-white hover:bg-gray-800'
                    }
                  `}
                >
                  <div className="flex items-center gap-3">
                    <Icon className="w-5 h-5" />
                    <span>{item.name}</span>
                  </div>
                  <ChevronDown
                    className={`w-4 h-4 transition-transform ${expanded ? 'rotate-180' : ''}`}
                  />
                </button>
                {expanded && (
                  <div className="ml-8 space-y-1">
                    {item.subItems!.map((subItem) => {
                      const isSubActive = pathname === subItem.href;
                      return (
                        <Link
                          key={subItem.href}
                          href={subItem.href}
                          className={`
                            block px-3 py-2 rounded-lg text-sm transition-colors
                            ${isSubActive
                              ? 'bg-gray-700 text-white font-medium'
                              : 'text-gray-300 hover:bg-gray-800 hover:text-white'
                            }
                          `}
                        >
                          {subItem.name}
                        </Link>
                      );
                    })}
                  </div>
                )}
              </div>
            );
          }

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

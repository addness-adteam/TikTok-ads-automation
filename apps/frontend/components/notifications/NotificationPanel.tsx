'use client';

import { useState, useEffect } from 'react';
import { Bell, X, Check, AlertTriangle, AlertCircle, Info } from 'lucide-react';
import {
  Notification,
  getNotifications,
  getUnreadCount,
  markNotificationAsRead,
  markAllNotificationsAsRead,
  deleteNotification,
} from '@/lib/api';

interface NotificationPanelProps {
  advertiserId: string;
}

export function NotificationPanel({ advertiserId }: NotificationPanelProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [notifications, setNotifications] = useState<Notification[]>([]);
  const [unreadCount, setUnreadCount] = useState(0);
  const [isLoading, setIsLoading] = useState(false);
  const [selectedNotification, setSelectedNotification] = useState<Notification | null>(null);

  // 通知を取得
  const fetchNotifications = async () => {
    if (!advertiserId) return;
    setIsLoading(true);
    try {
      const response = await getNotifications(advertiserId, { limit: 20 });
      setNotifications(response.notifications);
      setUnreadCount(response.unreadCount);
    } catch (error) {
      console.error('Failed to fetch notifications:', error);
    } finally {
      setIsLoading(false);
    }
  };

  // 未読数を取得
  const fetchUnreadCount = async () => {
    if (!advertiserId) return;
    try {
      const response = await getUnreadCount(advertiserId);
      setUnreadCount(response.unreadCount);
    } catch (error) {
      console.error('Failed to fetch unread count:', error);
    }
  };

  useEffect(() => {
    fetchUnreadCount();
    // 30秒ごとに未読数を更新
    const interval = setInterval(fetchUnreadCount, 30000);
    return () => clearInterval(interval);
  }, [advertiserId]);

  useEffect(() => {
    if (isOpen) {
      fetchNotifications();
    }
  }, [isOpen, advertiserId]);

  // 通知をクリックして詳細表示
  const handleNotificationClick = async (notification: Notification) => {
    setSelectedNotification(notification);
    if (notification.status === 'UNREAD') {
      try {
        await markNotificationAsRead(notification.id);
        setNotifications((prev) =>
          prev.map((n) => (n.id === notification.id ? { ...n, status: 'READ' } : n))
        );
        setUnreadCount((prev) => Math.max(0, prev - 1));
      } catch (error) {
        console.error('Failed to mark notification as read:', error);
      }
    }
  };

  // すべて既読
  const handleMarkAllAsRead = async () => {
    try {
      await markAllNotificationsAsRead(advertiserId);
      setNotifications((prev) => prev.map((n) => ({ ...n, status: 'READ' })));
      setUnreadCount(0);
    } catch (error) {
      console.error('Failed to mark all as read:', error);
    }
  };

  // 対応済み（削除）
  const handleDelete = async (notificationId: string) => {
    try {
      await deleteNotification(notificationId);
      setNotifications((prev) => prev.filter((n) => n.id !== notificationId));
      if (selectedNotification?.id === notificationId) {
        setSelectedNotification(null);
      }
    } catch (error) {
      console.error('Failed to delete notification:', error);
    }
  };

  // 重要度に応じたアイコン
  const getSeverityIcon = (severity: string) => {
    switch (severity) {
      case 'CRITICAL':
        return <AlertCircle className="w-5 h-5 text-red-500" />;
      case 'WARNING':
        return <AlertTriangle className="w-5 h-5 text-yellow-500" />;
      default:
        return <Info className="w-5 h-5 text-blue-500" />;
    }
  };

  // 重要度に応じた背景色
  const getSeverityBgColor = (severity: string, isUnread: boolean) => {
    if (!isUnread) return 'bg-gray-800';
    switch (severity) {
      case 'CRITICAL':
        return 'bg-red-900/30 border-l-4 border-red-500';
      case 'WARNING':
        return 'bg-yellow-900/30 border-l-4 border-yellow-500';
      default:
        return 'bg-blue-900/30 border-l-4 border-blue-500';
    }
  };

  // 日付フォーマット
  const formatDate = (dateString: string) => {
    const date = new Date(dateString);
    return date.toLocaleString('ja-JP', {
      month: 'numeric',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });
  };

  return (
    <div className="relative">
      {/* 通知ベルアイコン */}
      <button
        onClick={() => setIsOpen(!isOpen)}
        className="relative p-2 text-gray-400 hover:text-white transition-colors"
      >
        <Bell className="w-6 h-6" />
        {unreadCount > 0 && (
          <span className="absolute -top-1 -right-1 bg-red-500 text-white text-xs font-bold rounded-full w-5 h-5 flex items-center justify-center">
            {unreadCount > 9 ? '9+' : unreadCount}
          </span>
        )}
      </button>

      {/* 通知パネル */}
      {isOpen && (
        <div className="absolute right-0 top-12 w-96 bg-gray-900 border border-gray-700 rounded-lg shadow-xl z-50 max-h-[80vh] overflow-hidden flex flex-col">
          {/* ヘッダー */}
          <div className="flex items-center justify-between p-4 border-b border-gray-700">
            <h3 className="text-lg font-semibold text-white">
              通知 {unreadCount > 0 && `(${unreadCount}件の未読)`}
            </h3>
            <div className="flex items-center gap-2">
              {unreadCount > 0 && (
                <button
                  onClick={handleMarkAllAsRead}
                  className="text-sm text-blue-400 hover:text-blue-300"
                >
                  すべて既読
                </button>
              )}
              <button onClick={() => setIsOpen(false)} className="text-gray-400 hover:text-white">
                <X className="w-5 h-5" />
              </button>
            </div>
          </div>

          {/* 通知リスト */}
          <div className="flex-1 overflow-y-auto">
            {isLoading ? (
              <div className="p-8 text-center text-gray-400">読み込み中...</div>
            ) : notifications.length === 0 ? (
              <div className="p-8 text-center text-gray-400">通知はありません</div>
            ) : (
              <div className="divide-y divide-gray-700">
                {notifications.map((notification) => (
                  <div
                    key={notification.id}
                    className={`p-4 cursor-pointer hover:bg-gray-800/50 transition-colors ${getSeverityBgColor(
                      notification.severity,
                      notification.status === 'UNREAD'
                    )}`}
                    onClick={() => handleNotificationClick(notification)}
                  >
                    <div className="flex items-start gap-3">
                      {getSeverityIcon(notification.severity)}
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center justify-between">
                          <span className="text-xs text-gray-400">
                            {formatDate(notification.createdAt)}
                          </span>
                          <span
                            className={`text-xs px-2 py-0.5 rounded ${
                              notification.severity === 'CRITICAL'
                                ? 'bg-red-500/20 text-red-400'
                                : notification.severity === 'WARNING'
                                ? 'bg-yellow-500/20 text-yellow-400'
                                : 'bg-blue-500/20 text-blue-400'
                            }`}
                          >
                            {notification.severity}
                          </span>
                        </div>
                        <h4
                          className={`text-sm mt-1 ${
                            notification.status === 'UNREAD' ? 'text-white font-medium' : 'text-gray-300'
                          }`}
                        >
                          {notification.title}
                        </h4>
                        <p className="text-xs text-gray-400 mt-1 line-clamp-2">
                          {notification.message.split('\n')[0]}
                        </p>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      )}

      {/* 通知詳細モーダル */}
      {selectedNotification && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
          <div className="bg-gray-900 border border-gray-700 rounded-lg w-full max-w-lg mx-4 max-h-[80vh] overflow-hidden flex flex-col">
            <div className="flex items-center justify-between p-4 border-b border-gray-700">
              <div className="flex items-center gap-2">
                {getSeverityIcon(selectedNotification.severity)}
                <h3 className="text-lg font-semibold text-white">{selectedNotification.title}</h3>
              </div>
              <button
                onClick={() => setSelectedNotification(null)}
                className="text-gray-400 hover:text-white"
              >
                <X className="w-5 h-5" />
              </button>
            </div>
            <div className="flex-1 overflow-y-auto p-4">
              <div className="text-xs text-gray-400 mb-4">
                {new Date(selectedNotification.createdAt).toLocaleString('ja-JP')}
              </div>
              <pre className="text-sm text-gray-300 whitespace-pre-wrap font-sans">
                {selectedNotification.message}
              </pre>
            </div>
            <div className="p-4 border-t border-gray-700 flex justify-end">
              <button
                onClick={() => {
                  handleDelete(selectedNotification.id);
                }}
                className="flex items-center gap-2 px-4 py-2 bg-green-600 hover:bg-green-700 text-white rounded-lg transition-colors"
              >
                <Check className="w-4 h-4" />
                対応済み
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

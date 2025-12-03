import axios from 'axios';

// API Base URL
const API_BASE_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:4000';

// Axios インスタンス作成
export const apiClient = axios.create({
  baseURL: API_BASE_URL,
  timeout: 30000,
  headers: {
    'Content-Type': 'application/json',
  },
});

// Campaign取得
export async function getCampaigns(advertiserId: string, accessToken: string, campaignIds?: string[]) {
  const response = await apiClient.post('/auth/tiktok/campaigns', {
    advertiserId,
    accessToken,
    campaignIds,
  });
  return response.data;
}

// Campaign作成
export async function createCampaign(
  advertiserId: string,
  accessToken: string,
  campaignName: string,
  objectiveType: string,
  budgetMode?: string,
  budget?: number,
) {
  const response = await apiClient.post('/auth/tiktok/campaign/create', {
    advertiserId,
    accessToken,
    campaignName,
    objectiveType,
    budgetMode,
    budget,
  });
  return response.data;
}

// レポート取得
export async function getReport(
  advertiserId: string,
  accessToken: string,
  dataLevel: 'AUCTION_CAMPAIGN' | 'AUCTION_ADGROUP' | 'AUCTION_AD',
  startDate: string,
  endDate: string,
) {
  const response = await apiClient.post('/auth/tiktok/report', {
    advertiserId,
    accessToken,
    dataLevel,
    startDate,
    endDate,
  });
  return response.data;
}

// レポート取得 + DB保存
export async function fetchAndSaveReport(
  advertiserId: string,
  accessToken: string,
  dataLevel: 'AUCTION_CAMPAIGN' | 'AUCTION_ADGROUP' | 'AUCTION_AD',
  startDate: string,
  endDate: string,
) {
  const response = await apiClient.post('/auth/tiktok/report/fetch-and-save', {
    advertiserId,
    accessToken,
    dataLevel,
    startDate,
    endDate,
  });
  return response.data;
}

// 型定義
export interface Campaign {
  id: string;
  tiktokId: string;
  advertiserId: string;
  name: string;
  objectiveType: string;
  budgetMode?: string;
  budget?: number;
  status: string;
  createdAt: string;
  updatedAt: string;
}

export interface Metric {
  id: string;
  campaignId: string;
  statDate: string;
  impressions: number;
  clicks: number;
  spend: number;
  conversions: number;
  ctr: number;
  cpc: number;
  cpm: number;
  cpa: number;
}

// ============================================================================
// 通知API
// ============================================================================

export interface Notification {
  id: string;
  type: string;
  severity: 'INFO' | 'WARNING' | 'CRITICAL';
  advertiserId: string;
  entityType?: string;
  entityId?: string;
  title: string;
  message: string;
  metadata?: Record<string, any>;
  status: 'UNREAD' | 'READ';
  readAt?: string;
  createdAt: string;
}

export interface NotificationsResponse {
  notifications: Notification[];
  total: number;
  unreadCount: number;
}

// 通知一覧取得
export async function getNotifications(
  advertiserId: string,
  options?: {
    status?: string[];
    type?: string[];
    severity?: string[];
    limit?: number;
    offset?: number;
  }
): Promise<NotificationsResponse> {
  const params = new URLSearchParams({ advertiserId });
  if (options?.status) params.append('status', options.status.join(','));
  if (options?.type) params.append('type', options.type.join(','));
  if (options?.severity) params.append('severity', options.severity.join(','));
  if (options?.limit) params.append('limit', String(options.limit));
  if (options?.offset) params.append('offset', String(options.offset));

  const response = await apiClient.get(`/api/notifications?${params.toString()}`);
  return response.data;
}

// 未読通知数取得
export async function getUnreadCount(advertiserId: string): Promise<{ unreadCount: number }> {
  const response = await apiClient.get(`/api/notifications/unread-count?advertiserId=${advertiserId}`);
  return response.data;
}

// 通知を既読にする
export async function markNotificationAsRead(notificationId: string): Promise<void> {
  await apiClient.patch(`/api/notifications/${notificationId}/read`);
}

// 一括既読
export async function markAllNotificationsAsRead(
  advertiserId: string,
  notificationIds?: string[]
): Promise<void> {
  await apiClient.post('/api/notifications/mark-read', { advertiserId, notificationIds });
}

// 通知を削除（対応済み）
export async function deleteNotification(notificationId: string): Promise<void> {
  await apiClient.delete(`/api/notifications/${notificationId}`);
}

// ============================================================================
// 広告パフォーマンスAPI
// ============================================================================

export interface AdPerformance {
  id: string;
  adId: string;
  advertiserId: string;
  totalSpend: number;
  totalImpressions: number;
  totalClicks: number;
  totalConversions: number;
  totalFrontSales: number;
  bestCPA?: number;
  bestCPADate?: string;
  bestFrontCPO?: number;
  bestFrontCPODate?: string;
  bestCTR?: number;
  bestCTRDate?: string;
  spendAtLastReview: number;
  lastReviewDate?: string;
  reviewCount: number;
  impressionThresholdMet: boolean;
  impressionThresholdMetAt?: string;
  ad?: {
    id: string;
    name: string;
    status: string;
  };
}

export interface AdPerformancesResponse {
  performances: AdPerformance[];
  summary: {
    totalAds: number;
    adsWithDeviation: number;
    adsNeedingReview: number;
  };
}

// 広告パフォーマンス一覧取得
export async function getAdPerformances(
  advertiserId: string,
  options?: {
    impressionThresholdMet?: boolean;
    hasDeviation?: boolean;
  }
): Promise<AdPerformancesResponse> {
  const params = new URLSearchParams({ advertiserId });
  if (options?.impressionThresholdMet !== undefined) {
    params.append('impressionThresholdMet', String(options.impressionThresholdMet));
  }
  if (options?.hasDeviation !== undefined) {
    params.append('hasDeviation', String(options.hasDeviation));
  }

  const response = await apiClient.get(`/api/ad-performances?${params.toString()}`);
  return response.data;
}

// 広告パフォーマンス詳細取得
export async function getAdPerformanceDetail(adId: string): Promise<any> {
  const response = await apiClient.get(`/api/ad-performances/${adId}`);
  return response.data;
}

// ============================================================================
// 上限日予算API
// ============================================================================

export interface AdBudgetCap {
  id: string;
  adId: string;
  advertiserId: string;
  maxDailyBudget: number;
  enabled: boolean;
  startDate?: string;
  endDate?: string;
  createdAt: string;
  updatedAt: string;
  ad?: {
    id: string;
    name: string;
    status: string;
  };
}

// 上限日予算一覧取得
export async function getAdBudgetCaps(
  advertiserId: string,
  options?: { enabled?: boolean }
): Promise<AdBudgetCap[]> {
  const params = new URLSearchParams({ advertiserId });
  if (options?.enabled !== undefined) {
    params.append('enabled', String(options.enabled));
  }

  const response = await apiClient.get(`/api/ad-budget-caps?${params.toString()}`);
  return response.data;
}

// 上限日予算設定
export async function createAdBudgetCap(data: {
  adId: string;
  advertiserId: string;
  maxDailyBudget: number;
  enabled?: boolean;
  startDate?: string;
  endDate?: string;
}): Promise<AdBudgetCap> {
  const response = await apiClient.post('/api/ad-budget-caps', data);
  return response.data;
}

// 上限日予算更新
export async function updateAdBudgetCap(
  id: string,
  data: {
    maxDailyBudget?: number;
    enabled?: boolean;
    startDate?: string | null;
    endDate?: string | null;
  }
): Promise<AdBudgetCap> {
  const response = await apiClient.patch(`/api/ad-budget-caps/${id}`, data);
  return response.data;
}

// 上限日予算削除
export async function deleteAdBudgetCap(id: string): Promise<void> {
  await apiClient.delete(`/api/ad-budget-caps/${id}`);
}

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

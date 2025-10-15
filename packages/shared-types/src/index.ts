/**
 * 共有型定義
 * バックエンド・フロントエンド間で共有する型定義を集約
 */

// ============================================================================
// TikTok API 型定義
// ============================================================================

/**
 * TikTok Campaign Objective Types
 */
export enum CampaignObjectiveType {
  REACH = 'REACH',
  TRAFFIC = 'TRAFFIC',
  VIDEO_VIEW = 'VIDEO_VIEW',
  COMMUNITY_INTERACTION = 'COMMUNITY_INTERACTION',
  APP_PROMOTION = 'APP_PROMOTION',
  LEAD_GENERATION = 'LEAD_GENERATION',
  SALES = 'SALES',
}

/**
 * Budget Mode
 */
export enum BudgetMode {
  BUDGET_MODE_DAY = 'BUDGET_MODE_DAY',
  BUDGET_MODE_TOTAL = 'BUDGET_MODE_TOTAL',
  BUDGET_MODE_INFINITE = 'BUDGET_MODE_INFINITE',
}

/**
 * Campaign Status
 */
export enum CampaignStatus {
  ENABLE = 'ENABLE',
  DISABLE = 'DISABLE',
  DELETE = 'DELETE',
}

/**
 * Placement
 */
export enum Placement {
  PLACEMENT_TIKTOK = 'PLACEMENT_TIKTOK',
  PLACEMENT_PANGLE = 'PLACEMENT_PANGLE',
  PLACEMENT_AUTOMATIC = 'PLACEMENT_AUTOMATIC',
}

/**
 * Optimization Goal
 */
export enum OptimizationGoal {
  CLICK = 'CLICK',
  CONVERSION = 'CONVERSION',
  REACH = 'REACH',
  VIDEO_VIEW = 'VIDEO_VIEW',
  INSTALL = 'INSTALL',
}

/**
 * Bid Type
 */
export enum BidType {
  BID_TYPE_CUSTOM = 'BID_TYPE_CUSTOM',
  BID_TYPE_NO_BID = 'BID_TYPE_NO_BID',
}

/**
 * Ad Format
 */
export enum AdFormat {
  SINGLE_VIDEO = 'SINGLE_VIDEO',
  SINGLE_IMAGE = 'SINGLE_IMAGE',
}

/**
 * Ad Review Status
 */
export enum AdReviewStatus {
  PENDING = 'PENDING',
  APPROVED = 'APPROVED',
  REJECTED = 'REJECTED',
}

// ============================================================================
// データモデル型定義
// ============================================================================

/**
 * Advertiser (広告主アカウント)
 */
export interface Advertiser {
  id: string;
  name: string;
  advertiserId: string; // TikTok側ID
  status: string;
  timezone: string;
  createdAt: Date;
  updatedAt: Date;
}

/**
 * Campaign
 */
export interface Campaign {
  id: string;
  advertiserId: string;
  campaignId: string; // TikTok側ID
  name: string;
  objectiveType: CampaignObjectiveType;
  budgetMode: BudgetMode;
  budget: number;
  status: CampaignStatus;
  idempotencyKey: string;
  createdAt: Date;
  updatedAt: Date;
}

/**
 * AdGroup
 */
export interface AdGroup {
  id: string;
  campaignId: string;
  adgroupId: string; // TikTok側ID
  name: string;
  placement: Placement[];
  optimizationGoal: OptimizationGoal;
  bidType: BidType;
  bidPrice?: number;
  budget: number;
  scheduleStart: Date;
  scheduleEnd: Date;
  targeting: AdGroupTargeting;
  status: string;
  idempotencyKey: string;
  createdAt: Date;
  updatedAt: Date;
}

/**
 * AdGroup Targeting
 */
export interface AdGroupTargeting {
  locationIds?: number[];
  ageGroups?: string[];
  gender?: 'GENDER_MALE' | 'GENDER_FEMALE' | 'GENDER_UNLIMITED';
  interests?: string[];
  devices?: string[];
  languages?: string[];
}

/**
 * Ad
 */
export interface Ad {
  id: string;
  adgroupId: string;
  adId: string; // TikTok側ID
  name: string;
  adFormat: AdFormat;
  adText: string;
  displayName: string;
  callToAction: string;
  videoId?: string;
  imageIds?: string[];
  landingPageUrl: string;
  status: string;
  reviewStatus: AdReviewStatus;
  idempotencyKey: string;
  createdAt: Date;
  updatedAt: Date;
}

/**
 * Creative
 */
export interface Creative {
  id: string;
  advertiserId: string;
  creativeType: 'VIDEO' | 'IMAGE';
  tiktokVideoId?: string;
  tiktokImageId?: string;
  filePath: string;
  fileSize: number;
  duration?: number;
  width?: number;
  height?: number;
  metadata?: CreativeMetadata;
  qualityScore?: number;
  status: string;
  createdAt: Date;
  uploadedAt?: Date;
}

/**
 * Creative Metadata
 */
export interface CreativeMetadata {
  audio?: boolean;
  caption?: string;
  hookPoint?: number;
}

/**
 * Metrics
 */
export interface Metrics {
  id: string;
  dataLevel: 'CAMPAIGN' | 'ADGROUP' | 'AD';
  entityId: string;
  statDate: Date;
  impressions: number;
  clicks: number;
  spend: number;
  conversions: number;
  ctr: number;
  cpc: number;
  cpm: number;
  cvr: number;
  cpa: number;
  videoViews?: number;
  videoViewP25?: number;
  videoViewP50?: number;
  videoViewP75?: number;
  videoViewP100?: number;
  syncedAt: Date;
}

// ============================================================================
// API Request/Response型定義
// ============================================================================

/**
 * Campaign作成リクエスト
 */
export interface CreateCampaignRequest {
  advertiserId: string;
  campaignName: string;
  objectiveType: CampaignObjectiveType;
  budgetMode: BudgetMode;
  budget: number;
}

/**
 * Campaign作成レスポンス
 */
export interface CreateCampaignResponse {
  campaignId: string;
}

/**
 * Reporting APIリクエスト
 */
export interface ReportingRequest {
  advertiserId: string;
  dataLevel: 'AUCTION_CAMPAIGN' | 'AUCTION_ADGROUP' | 'AUCTION_AD';
  dimensions: string[];
  metrics: string[];
  startDate: string;
  endDate: string;
  page?: number;
  pageSize?: number;
}

/**
 * Reporting APIレスポンス
 */
export interface ReportingResponse {
  pageInfo: {
    totalNumber: number;
    page: number;
    pageSize: number;
    totalPage: number;
  };
  list: ReportingRow[];
}

/**
 * Reporting Row
 */
export interface ReportingRow {
  dimensions: Record<string, string>;
  metrics: Record<string, number>;
}

// ============================================================================
// ユーティリティ型
// ============================================================================

/**
 * API共通レスポンス
 */
export interface ApiResponse<T> {
  success: boolean;
  data?: T;
  error?: ApiError;
}

/**
 * APIエラー
 */
export interface ApiError {
  code: string;
  message: string;
  details?: unknown;
}

/**
 * ページネーション情報
 */
export interface PaginationInfo {
  page: number;
  pageSize: number;
  total: number;
  totalPages: number;
}

/**
 * ページネーション付きレスポンス
 */
export interface PaginatedResponse<T> {
  items: T[];
  pagination: PaginationInfo;
}

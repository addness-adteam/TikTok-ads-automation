import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

// 通知タイプ
export enum NotificationType {
  CPA_DEVIATION = 'CPA_DEVIATION',           // CPA乖離アラート（20%以上）
  AD_REVIEW = 'AD_REVIEW',                   // 広告定期見直し（10万円消化ごと）
  BUDGET_CAP_APPLIED = 'BUDGET_CAP_APPLIED', // 上限日予算適用通知
  BUDGET_CAP_REACHED = 'BUDGET_CAP_REACHED', // 上限日予算到達通知（増額スキップ）
  PERFORMANCE_DEGRADATION = 'PERFORMANCE_DEGRADATION', // パフォーマンス急激悪化（50%以上乖離）
}

// 重要度
export enum NotificationSeverity {
  INFO = 'INFO',
  WARNING = 'WARNING',
  CRITICAL = 'CRITICAL',
}

// 通知ステータス
export enum NotificationStatus {
  UNREAD = 'UNREAD',
  READ = 'READ',
}

// エンティティタイプ
export enum EntityType {
  AD = 'AD',
  ADGROUP = 'ADGROUP',
  CAMPAIGN = 'CAMPAIGN',
}

// 通知作成用DTO
export interface CreateNotificationDto {
  type: NotificationType;
  severity: NotificationSeverity;
  advertiserId: string;
  entityType?: EntityType;
  entityId?: string;
  title: string;
  message: string;
  metadata?: Record<string, any>;
}

// 通知一覧取得用オプション
export interface GetNotificationsOptions {
  advertiserId: string;
  status?: NotificationStatus[];
  type?: NotificationType[];
  severity?: NotificationSeverity[];
  limit?: number;
  offset?: number;
}

@Injectable()
export class NotificationService {
  private readonly logger = new Logger(NotificationService.name);

  constructor(private readonly prisma: PrismaService) {}

  /**
   * 通知を作成
   * 同一広告/同一タイプの通知が当日既に存在する場合は重複を防ぐ
   */
  async createNotification(dto: CreateNotificationDto): Promise<void> {
    try {
      // 当日の重複チェック（同一エンティティ・同一タイプ）
      if (dto.entityId) {
        const today = new Date();
        today.setHours(0, 0, 0, 0);

        const existingNotification = await this.prisma.notification.findFirst({
          where: {
            advertiserId: dto.advertiserId,
            type: dto.type,
            entityId: dto.entityId,
            createdAt: {
              gte: today,
            },
          },
        });

        if (existingNotification) {
          this.logger.log(
            `Duplicate notification skipped: ${dto.type} for entity ${dto.entityId}`,
          );
          return;
        }
      }

      await this.prisma.notification.create({
        data: {
          type: dto.type,
          severity: dto.severity,
          advertiserId: dto.advertiserId,
          entityType: dto.entityType,
          entityId: dto.entityId,
          title: dto.title,
          message: dto.message,
          metadata: dto.metadata,
          status: NotificationStatus.UNREAD,
        },
      });

      this.logger.log(
        `Notification created: ${dto.type} - ${dto.title} (advertiserId: ${dto.advertiserId})`,
      );
    } catch (error) {
      this.logger.error(`Failed to create notification: ${error.message}`, error);
      // 通知作成失敗は既存処理に影響させない
    }
  }

  /**
   * CPA乖離アラート通知を作成
   */
  async createCPADeviationNotification(
    advertiserId: string,
    adId: string,
    adName: string,
    bestCPA: number,
    currentCPA: number,
    totalSpend: number,
    totalImpressions: number,
  ): Promise<void> {
    const deviationRate = ((currentCPA - bestCPA) / bestCPA * 100).toFixed(1);
    const severity = parseFloat(deviationRate) >= 50
      ? NotificationSeverity.CRITICAL
      : NotificationSeverity.WARNING;
    const type = parseFloat(deviationRate) >= 50
      ? NotificationType.PERFORMANCE_DEGRADATION
      : NotificationType.CPA_DEVIATION;

    const message = `【CPA乖離アラート】
広告名: ${adName}
広告ID: ${adId}
過去最高CPA: ¥${bestCPA.toLocaleString()}
現在のCPA: ¥${currentCPA.toLocaleString()}
乖離率: ${deviationRate}%
累計消化額: ¥${totalSpend.toLocaleString()}
累計インプレッション数: ${totalImpressions.toLocaleString()}

推奨アクション:
- 別キャンペーンでの再配信を検討
- オーディエンス設定の見直し
- 配信面（Placement）の変更を検討`;

    await this.createNotification({
      type,
      severity,
      advertiserId,
      entityType: EntityType.AD,
      entityId: adId,
      title: `CPA乖離アラート: ${adName}`,
      message,
      metadata: {
        bestCPA,
        currentCPA,
        deviationRate: parseFloat(deviationRate),
        totalSpend,
        totalImpressions,
      },
    });
  }

  /**
   * 広告定期見直し通知を作成
   */
  async createAdReviewNotification(
    advertiserId: string,
    adId: string,
    adName: string,
    spendSinceLastReview: number,
    totalSpend: number,
    performanceSummary: {
      bestCPA?: number;
      currentCPA?: number;
      cpaDeviationRate?: number;
      bestFrontCPO?: number;
      currentFrontCPO?: number;
      frontCPODeviationRate?: number;
      bestCTR?: number;
      currentCTR?: number;
      ctrDeviationRate?: number;
    },
  ): Promise<void> {
    const summary = performanceSummary;

    let performanceTable = `パフォーマンスサマリー:
┌──────────────────┬────────────┬────────────┬──────────┐
│ 指標             │ 過去最高   │ 直近7日間  │ 乖離率   │
├──────────────────┼────────────┼────────────┼──────────┤`;

    if (summary.bestCPA && summary.currentCPA) {
      performanceTable += `
│ CPA              │ ¥${summary.bestCPA.toLocaleString().padStart(8)} │ ¥${summary.currentCPA.toLocaleString().padStart(8)} │ ${(summary.cpaDeviationRate || 0).toFixed(1).padStart(6)}%  │`;
    }
    if (summary.bestFrontCPO && summary.currentFrontCPO) {
      performanceTable += `
│ フロントCPO       │ ¥${summary.bestFrontCPO.toLocaleString().padStart(8)} │ ¥${summary.currentFrontCPO.toLocaleString().padStart(8)} │ ${(summary.frontCPODeviationRate || 0).toFixed(1).padStart(6)}%  │`;
    }
    if (summary.bestCTR && summary.currentCTR) {
      performanceTable += `
│ CTR              │ ${summary.bestCTR.toFixed(2).padStart(9)}% │ ${summary.currentCTR.toFixed(2).padStart(9)}% │ ${(summary.ctrDeviationRate || 0).toFixed(1).padStart(6)}%  │`;
    }

    performanceTable += `
└──────────────────┴────────────┴────────────┴──────────┘`;

    const message = `【広告定期見直し】
広告名: ${adName}
トリガー: 消化額 ¥${spendSinceLastReview.toLocaleString()} 到達（累計: ¥${totalSpend.toLocaleString()}）

${performanceTable}

推奨アクション:
- パフォーマンス傾向を確認し、必要に応じて配信設定を調整
- 乖離率が高い場合は別キャンペーンでの再配信を検討`;

    await this.createNotification({
      type: NotificationType.AD_REVIEW,
      severity: NotificationSeverity.INFO,
      advertiserId,
      entityType: EntityType.AD,
      entityId: adId,
      title: `広告定期見直し: ${adName}`,
      message,
      metadata: {
        spendSinceLastReview,
        totalSpend,
        ...performanceSummary,
      },
    });
  }

  /**
   * 上限日予算適用通知を作成
   */
  async createBudgetCapAppliedNotification(
    advertiserId: string,
    adgroupId: string,
    adName: string,
    adMaxBudget: number,
    originalNewBudget: number,
    appliedBudget: number,
  ): Promise<void> {
    const message = `【上限日予算適用】
広告セットID: ${adgroupId}
対象広告: ${adName}（上限: ¥${adMaxBudget.toLocaleString()}）
元の増額後予算: ¥${originalNewBudget.toLocaleString()}
適用された上限: ¥${adMaxBudget.toLocaleString()}
適用後予算: ¥${appliedBudget.toLocaleString()}
理由: 広告セット内の最小上限日予算を超過するため調整`;

    await this.createNotification({
      type: NotificationType.BUDGET_CAP_APPLIED,
      severity: NotificationSeverity.INFO,
      advertiserId,
      entityType: EntityType.ADGROUP,
      entityId: adgroupId,
      title: `上限日予算適用: ${adName}`,
      message,
      metadata: {
        adgroupId,
        adMaxBudget,
        originalNewBudget,
        appliedBudget,
      },
    });
  }

  /**
   * 上限日予算到達通知を作成（増額スキップ）
   */
  async createBudgetCapReachedNotification(
    advertiserId: string,
    adgroupId: string,
    adName: string,
    currentBudget: number,
    maxBudget: number,
  ): Promise<void> {
    const message = `【上限日予算到達】
広告セットID: ${adgroupId}
対象広告: ${adName}
現在の予算: ¥${currentBudget.toLocaleString()}
上限日予算: ¥${maxBudget.toLocaleString()}
アクション: 予算増額をスキップしました
理由: 現在の予算が上限日予算以上のため、これ以上の増額は行いません`;

    await this.createNotification({
      type: NotificationType.BUDGET_CAP_REACHED,
      severity: NotificationSeverity.WARNING,
      advertiserId,
      entityType: EntityType.ADGROUP,
      entityId: adgroupId,
      title: `上限日予算到達: ${adName}`,
      message,
      metadata: {
        adgroupId,
        currentBudget,
        maxBudget,
      },
    });
  }

  /**
   * 通知一覧を取得
   */
  async getNotifications(options: GetNotificationsOptions): Promise<{
    notifications: any[];
    total: number;
    unreadCount: number;
  }> {
    const { advertiserId, status, type, severity, limit = 50, offset = 0 } = options;

    const where: any = { advertiserId };

    if (status && status.length > 0) {
      where.status = { in: status };
    }
    if (type && type.length > 0) {
      where.type = { in: type };
    }
    if (severity && severity.length > 0) {
      where.severity = { in: severity };
    }

    const [notifications, total, unreadCount] = await Promise.all([
      this.prisma.notification.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        take: limit,
        skip: offset,
      }),
      this.prisma.notification.count({ where }),
      this.prisma.notification.count({
        where: {
          advertiserId,
          status: NotificationStatus.UNREAD,
        },
      }),
    ]);

    return { notifications, total, unreadCount };
  }

  /**
   * 通知を既読にする
   */
  async markAsRead(notificationId: string): Promise<void> {
    await this.prisma.notification.update({
      where: { id: notificationId },
      data: {
        status: NotificationStatus.READ,
        readAt: new Date(),
      },
    });
  }

  /**
   * 一括既読
   */
  async markAllAsRead(advertiserId: string, notificationIds?: string[]): Promise<void> {
    const where: any = {
      advertiserId,
      status: NotificationStatus.UNREAD,
    };

    if (notificationIds && notificationIds.length > 0) {
      where.id = { in: notificationIds };
    }

    await this.prisma.notification.updateMany({
      where,
      data: {
        status: NotificationStatus.READ,
        readAt: new Date(),
      },
    });
  }

  /**
   * 通知を削除（対応済み）
   */
  async deleteNotification(notificationId: string): Promise<void> {
    await this.prisma.notification.delete({
      where: { id: notificationId },
    });
  }

  /**
   * 未読通知数を取得
   */
  async getUnreadCount(advertiserId: string): Promise<number> {
    return this.prisma.notification.count({
      where: {
        advertiserId,
        status: NotificationStatus.UNREAD,
      },
    });
  }
}

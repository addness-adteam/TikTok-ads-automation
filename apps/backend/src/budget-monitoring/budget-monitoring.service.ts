import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { TiktokService } from '../tiktok/tiktok.service';

interface BudgetAnomaly {
  advertiserId: string;
  advertiserName: string;
  adgroupId: string;
  adName: string;
  currentBudget: number;
  lastKnownBudget: number | null;
  ratio: number | null;
  reason: string;
}

export interface MonitorResult {
  checkedAt: string;
  totalAdvertisers: number;
  totalAdgroups: number;
  totalAnomalies: number;
  anomalies: BudgetAnomaly[];
  dryRun: boolean;
}

// デフォルト予算（導線別）
const DEFAULT_BUDGETS = {
  AI: 3000,
  SNS: 3000,
  SEMINAR: 5000,
};

@Injectable()
export class BudgetMonitoringService {
  private readonly logger = new Logger(BudgetMonitoringService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly tiktokService: TiktokService,
  ) {}

  /**
   * 全対象アカウントの予算異常を検知
   */
  async monitorAllBudgets(
    accessToken: string,
    dryRun = false,
  ): Promise<MonitorResult> {
    const jstNow = new Date(Date.now() + 9 * 60 * 60 * 1000);
    this.logger.log(
      `[BudgetMonitor] 予算監視開始 (JST: ${jstNow.toISOString()}, dryRun: ${dryRun})`,
    );

    // 対象アカウント取得（V2と同じ: appealが設定されているアカウント）
    const advertisers = await this.prisma.advertiser.findMany({
      where: { appeal: { isNot: null } },
      select: { tiktokAdvertiserId: true, name: true },
    });

    this.logger.log(`[BudgetMonitor] 対象アカウント: ${advertisers.length}件`);

    const allAnomalies: BudgetAnomaly[] = [];
    let totalAdgroups = 0;

    for (const advertiser of advertisers) {
      try {
        const { anomalies, adgroupCount } = await this.checkAdvertiserBudgets(
          advertiser.tiktokAdvertiserId,
          advertiser.name,
          accessToken,
        );
        totalAdgroups += adgroupCount;
        allAnomalies.push(...anomalies);
      } catch (error) {
        this.logger.error(
          `[BudgetMonitor] ${advertiser.name}(${advertiser.tiktokAdvertiserId}) の監視失敗: ${error.message}`,
        );
      }
    }

    // 異常検知結果のログ出力
    if (allAnomalies.length > 0) {
      this.logger.warn(
        `[BudgetMonitor] ${allAnomalies.length}件の予算異常を検知!`,
      );
      for (const anomaly of allAnomalies) {
        this.logger.warn(
          `[BudgetMonitor] 異常: ${anomaly.advertiserName} | adgroup=${anomaly.adgroupId} | ` +
            `現在=\u00A5${anomaly.currentBudget} | 前回=\u00A5${anomaly.lastKnownBudget ?? 'N/A'} | ` +
            `比率=${anomaly.ratio?.toFixed(2) ?? 'N/A'} | ${anomaly.reason}`,
        );
      }

      if (!dryRun) {
        // ChangeLogに記録
        await this.saveAnomalies(allAnomalies);
        // Slack通知
        await this.sendSlackSummary(allAnomalies);
      }
    } else {
      this.logger.log(
        `[BudgetMonitor] 予算異常なし (チェック済みadgroup: ${totalAdgroups}件)`,
      );
    }

    return {
      checkedAt: jstNow.toISOString(),
      totalAdvertisers: advertisers.length,
      totalAdgroups,
      totalAnomalies: allAnomalies.length,
      anomalies: allAnomalies,
      dryRun,
    };
  }

  /**
   * 個別アカウントの予算異常チェック
   */
  private async checkAdvertiserBudgets(
    advertiserId: string,
    advertiserName: string,
    accessToken: string,
  ): Promise<{ anomalies: BudgetAnomaly[]; adgroupCount: number }> {
    const anomalies: BudgetAnomaly[] = [];

    // === Smart+広告を取得 ===
    let smartPlusRawAds: any[] = [];
    try {
      const response = await this.tiktokService.getSmartPlusAds(
        advertiserId,
        accessToken,
        undefined,
        'ENABLE',
      );
      smartPlusRawAds = response.data?.list || [];
      this.logger.log(
        `[BudgetMonitor] ${advertiserName}: Smart+ ads ${smartPlusRawAds.length}件`,
      );
    } catch (error) {
      this.logger.warn(
        `[BudgetMonitor] ${advertiserName}: Smart+ ads取得失敗: ${error.message}`,
      );
    }

    // === 通常広告を取得 ===
    let regularRawAds: any[] = [];
    try {
      const regularResponse = await this.tiktokService.getAds(
        advertiserId,
        accessToken,
        undefined,
        'ENABLE',
      );
      const allRegularAds = regularResponse.data?.list || [];
      // Smart+広告と重複するad_idを除外
      const smartPlusAdIds = new Set(
        smartPlusRawAds.map((ad: any) => ad.smart_plus_ad_id),
      );
      regularRawAds = allRegularAds.filter(
        (ad: any) => !smartPlusAdIds.has(ad.ad_id),
      );
      this.logger.log(
        `[BudgetMonitor] ${advertiserName}: Regular ads ${allRegularAds.length}件, dedup後 ${regularRawAds.length}件`,
      );
    } catch (error) {
      this.logger.error(
        `[BudgetMonitor] ${advertiserName}: Regular ads取得失敗: ${error.message}`,
      );
    }

    // === 全広告からcampaignIds/adgroupIdsを集約 ===
    const allAds = [...smartPlusRawAds, ...regularRawAds];
    if (allAds.length === 0) {
      return { anomalies: [], adgroupCount: 0 };
    }

    const campaignIds = [
      ...new Set(allAds.map((ad: any) => ad.campaign_id).filter(Boolean)),
    ] as string[];

    // adgroup_id → ad_name のマップ（レポート用）
    const adgroupAdNameMap = new Map<string, string>();
    for (const ad of allAds) {
      if (ad.adgroup_id) {
        adgroupAdNameMap.set(ad.adgroup_id, ad.ad_name || '不明');
      }
    }

    // === AdGroup予算をバッチ取得 ===
    const adgroupBudgetMap = new Map<string, number>();
    if (campaignIds.length > 0) {
      try {
        const adgroupResponse = await this.tiktokService.getAdGroups(
          advertiserId,
          accessToken,
          campaignIds,
        );
        const adgroups = adgroupResponse.data?.list || [];
        for (const ag of adgroups) {
          if (ag.adgroup_id && ag.budget) {
            adgroupBudgetMap.set(ag.adgroup_id, parseFloat(ag.budget));
          }
        }
        this.logger.log(
          `[BudgetMonitor] ${advertiserName}: AdGroup予算取得 ${adgroupBudgetMap.size}件`,
        );
      } catch (error) {
        this.logger.error(
          `[BudgetMonitor] ${advertiserName}: AdGroup予算取得失敗: ${error.message}`,
        );
      }
    }

    // === 各adgroupの予算をChangeLogと比較 ===
    for (const [adgroupId, currentBudget] of adgroupBudgetMap) {
      const adName = adgroupAdNameMap.get(adgroupId) || '不明';
      const anomaly = await this.detectAnomaly(
        advertiserId,
        advertiserName,
        adgroupId,
        adName,
        currentBudget,
      );
      if (anomaly) {
        anomalies.push(anomaly);
      }
    }

    return { anomalies, adgroupCount: adgroupBudgetMap.size };
  }

  /**
   * 個別adgroupの予算異常検知
   */
  private async detectAnomaly(
    advertiserId: string,
    advertiserName: string,
    adgroupId: string,
    adName: string,
    currentBudget: number,
  ): Promise<BudgetAnomaly | null> {
    // 最新のChangeLogを取得
    const lastChangeLog = await this.prisma.changeLog.findFirst({
      where: {
        entityId: adgroupId,
        entityType: 'ADGROUP',
      },
      orderBy: { createdAt: 'desc' },
    });

    const lastKnownBudget = lastChangeLog
      ? (lastChangeLog.afterData?.budget ??
        lastChangeLog.afterData?.newBudget ??
        null)
      : null;

    const reasons: string[] = [];

    // 検知ルール1: 予算 > ¥100,000 は無条件で異常
    if (currentBudget > 100000) {
      reasons.push(
        `予算が\u00A5100,000超 (現在\u00A5${currentBudget.toLocaleString()})`,
      );
    }

    // 検知ルール2: ChangeLogからの変動比率 > 1.5x
    let ratio: number | null = null;
    if (lastKnownBudget && lastKnownBudget > 0) {
      ratio = currentBudget / lastKnownBudget;
      if (ratio > 1.5) {
        reasons.push(
          `前回\u00A5${lastKnownBudget.toLocaleString()}から${ratio.toFixed(1)}倍に増加（V2上限1.3xを超過）`,
        );
      }
    }

    // 検知ルール3: ×100パターン検知（¥300,000 = ¥3,000×100, ¥500,000 = ¥5,000×100）
    for (const [line, defaultBudget] of Object.entries(DEFAULT_BUDGETS)) {
      if (currentBudget === defaultBudget * 100) {
        reasons.push(
          `${line}デフォルト\u00A5${defaultBudget.toLocaleString()}の×100パターン (\u00A5${currentBudget.toLocaleString()})`,
        );
        break;
      }
    }

    // 検知ルール4: ChangeLog履歴なしで予算がデフォルト超
    if (!lastChangeLog) {
      const maxDefault = Math.max(...Object.values(DEFAULT_BUDGETS));
      if (currentBudget > maxDefault) {
        reasons.push(
          `ChangeLog履歴なしで予算\u00A5${currentBudget.toLocaleString()} (デフォルト上限\u00A5${maxDefault.toLocaleString()}超)`,
        );
      }
    }

    if (reasons.length === 0) {
      return null;
    }

    return {
      advertiserId,
      advertiserName,
      adgroupId,
      adName,
      currentBudget,
      lastKnownBudget,
      ratio,
      reason: reasons.join(' / '),
    };
  }

  /**
   * 異常をChangeLogに記録
   */
  private async saveAnomalies(anomalies: BudgetAnomaly[]): Promise<void> {
    for (const anomaly of anomalies) {
      try {
        await this.prisma.changeLog.create({
          data: {
            entityType: 'ADGROUP',
            entityId: anomaly.adgroupId,
            action: 'BUDGET_ANOMALY_DETECTED',
            source: 'BUDGET_MONITOR',
            beforeData: {
              budget: anomaly.lastKnownBudget,
            },
            afterData: {
              budget: anomaly.currentBudget,
              ratio: anomaly.ratio,
              advertiserName: anomaly.advertiserName,
              adName: anomaly.adName,
            },
            reason: anomaly.reason,
          },
        });
      } catch (error) {
        this.logger.error(
          `[BudgetMonitor] ChangeLog保存失敗 (adgroup=${anomaly.adgroupId}): ${error.message}`,
        );
      }
    }
    this.logger.log(
      `[BudgetMonitor] ${anomalies.length}件の異常をChangeLogに記録`,
    );
  }

  /**
   * Slack通知を送信
   */
  private async sendSlackSummary(anomalies: BudgetAnomaly[]): Promise<void> {
    const lines = anomalies.map(
      (a) =>
        `- ${a.advertiserName} | ${a.adName} | adgroup=${a.adgroupId}\n` +
        `  現在: \u00A5${a.currentBudget.toLocaleString()} / 前回: \u00A5${a.lastKnownBudget?.toLocaleString() ?? 'N/A'}\n` +
        `  ${a.reason}`,
    );

    const message =
      `[予算異常検知] ${anomalies.length}件の異常を検知しました\n\n` +
      lines.join('\n\n');

    await this.sendSlackNotification(message);
  }

  /**
   * Slack Webhook通知
   */
  private async sendSlackNotification(message: string): Promise<void> {
    const webhookUrl = process.env.SLACK_WEBHOOK_URL;
    if (!webhookUrl) {
      this.logger.warn(
        '[BudgetMonitor] SLACK_WEBHOOK_URL未設定のためSlack通知をスキップ',
      );
      return;
    }

    try {
      const response = await fetch(webhookUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text: message }),
      });
      if (!response.ok) {
        this.logger.warn(
          `[BudgetMonitor] Slack通知失敗: HTTP ${response.status}`,
        );
      } else {
        this.logger.log('[BudgetMonitor] Slack通知送信完了');
      }
    } catch (error) {
      this.logger.warn(`[BudgetMonitor] Slack通知エラー: ${error.message}`);
    }
  }
}

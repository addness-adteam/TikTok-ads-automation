import { Injectable, Logger } from '@nestjs/common';

export interface AlertPayload {
  adName: string;
  advertiserName: string;
  deliveryStartDate: Date;
  deliveryDays: number;
  totalSpend: number;
  reservationCount: number;
  attendanceCount: number;
  actualCpo: number | null;
  allowableCpo: number;
  reason: 'CPO_EXCEEDED' | 'ZERO_ATTENDANCE_WITH_SPEND';
}

export interface LineNotifier {
  notify(payload: AlertPayload): Promise<void>;
}

/** AI秘書LINE通知（budget-optimization-v2のnotifyErrorと同じ仕組み） */
@Injectable()
export class AiSecretaryLineNotifier implements LineNotifier {
  private readonly logger = new Logger(AiSecretaryLineNotifier.name);

  async notify(payload: AlertPayload): Promise<void> {
    const token = process.env.LINE_CHANNEL_ACCESS_TOKEN;
    const userId = process.env.LINE_USER_ID;
    if (!token || !userId) {
      this.logger.warn('LINE_CHANNEL_ACCESS_TOKEN or LINE_USER_ID 未設定 → 通知スキップ');
      return;
    }

    const text = this.formatMessage(payload);
    try {
      const response = await fetch('https://api.line.me/v2/bot/message/push', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          to: userId,
          messages: [{ type: 'text', text }],
        }),
      });
      if (!response.ok) {
        const body = await response.text();
        this.logger.warn(`LINE push 失敗: HTTP ${response.status}: ${body.slice(0, 200)}`);
      }
    } catch (e: any) {
      this.logger.warn(`LINE push 例外: ${e.message}`);
    }
  }

  formatMessage(p: AlertPayload): string {
    const mmdd = (d: Date) => {
      const jst = new Date(d.getTime() + 9 * 3600 * 1000);
      return `${jst.getUTCMonth() + 1}/${jst.getUTCDate()}`;
    };
    const lines: string[] = [];
    lines.push('⚠️ セミナー着座CPOアラート');
    lines.push('');
    lines.push(`📢 広告: ${p.adName}`);
    lines.push(`🏢 アカウント: ${p.advertiserName}`);
    lines.push(`📅 配信期間: ${mmdd(p.deliveryStartDate)}開始 (${p.deliveryDays}日経過)`);
    lines.push(`💰 広告費: ¥${p.totalSpend.toLocaleString()}`);
    lines.push(`👥 予約: ${p.reservationCount}件`);
    lines.push(`🪑 着座: ${p.attendanceCount}件`);
    if (p.reason === 'CPO_EXCEEDED' && p.actualCpo != null) {
      const rate = Math.round((p.actualCpo / p.allowableCpo) * 1000) / 10;
      lines.push(`📊 実CPO: ¥${p.actualCpo.toLocaleString()}`);
      lines.push(`🎯 当月許容CPO: ¥${p.allowableCpo.toLocaleString()} (超過率 ${rate}%)`);
    } else {
      lines.push(`📊 実CPO: 着座0件（算出不能）`);
      lines.push(`🎯 当月許容CPO: ¥${p.allowableCpo.toLocaleString()}`);
      lines.push(`※ 許容CPO相当の予算を消化して1件も着座なし`);
    }
    lines.push('');
    lines.push('→ 手動で状況確認の上、停止判断を推奨');
    return lines.join('\n');
  }
}

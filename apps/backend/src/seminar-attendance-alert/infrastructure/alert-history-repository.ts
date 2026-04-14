import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { AlertReason } from '../domain/services/alert-rule-evaluator';

export interface AlertRecord {
  adTiktokId: string;
  adName: string;
  advertiserName: string;
  reason: AlertReason;
  deliveryDays: number;
  totalSpend: number;
  reservationCount: number;
  attendanceCount: number;
  actualCpo: number | null;
  allowableCpo: number;
  overageRate: number | null;
}

/** 通知済み広告の重複抑止リポジトリ */
export interface AlertHistoryRepository {
  isAlreadyAlerted(adTiktokId: string): Promise<boolean>;
  record(alert: AlertRecord): Promise<void>;
  loadAllAlertedIds(): Promise<Set<string>>;
}

@Injectable()
export class PrismaAlertHistoryRepository implements AlertHistoryRepository {
  constructor(private readonly prisma: PrismaService) {}

  async isAlreadyAlerted(adTiktokId: string): Promise<boolean> {
    const row = await this.prisma.seminarAttendanceAlert.findUnique({
      where: { adTiktokId },
      select: { id: true },
    });
    return row !== null;
  }

  async record(alert: AlertRecord): Promise<void> {
    await this.prisma.seminarAttendanceAlert.create({
      data: {
        adTiktokId: alert.adTiktokId,
        adName: alert.adName,
        advertiserName: alert.advertiserName,
        reason: alert.reason,
        deliveryDays: alert.deliveryDays,
        totalSpend: alert.totalSpend,
        reservationCount: alert.reservationCount,
        attendanceCount: alert.attendanceCount,
        actualCpo: alert.actualCpo,
        allowableCpo: alert.allowableCpo,
        overageRate: alert.overageRate,
      },
    });
  }

  async loadAllAlertedIds(): Promise<Set<string>> {
    const rows = await this.prisma.seminarAttendanceAlert.findMany({
      select: { adTiktokId: true },
    });
    return new Set(rows.map((r) => r.adTiktokId));
  }
}

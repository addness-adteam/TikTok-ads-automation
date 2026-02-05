import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { GoogleSheetsService } from '../google-sheets/google-sheets.service';

export interface RecordResult {
  targetDate: string;
  launchCount: number;
  pauseCount: number;
  sheetUpdated: boolean;
}

/** 対象アカウントのTikTok Advertiser ID */
const TARGET_ADVERTISER_IDS = [
  '7468288053866561553', // AI_1
  '7523128243466551303', // AI_2
  '7543540647266074641', // AI_3
  '7474920444831875080', // スキルプラス1
  '7592868952431362066', // スキルプラス2
];

/** 記録先スプレッドシート */
const SPREADSHEET_ID = '1lJ2mwmBhRiJKak9yoXPM93rC-WCglO2MSZVCdRxa-5Y';
const SHEET_NAME = 'TikTok広告';

@Injectable()
export class AdCountRecordingService {
  private readonly logger = new Logger(AdCountRecordingService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly googleSheetsService: GoogleSheetsService,
  ) {}

  /**
   * 指定日の出稿数・停止数を集計してGoogle Sheetsに記録する
   * @param targetDate 記録対象日（省略時は前日）
   */
  async recordDailyCounts(targetDate?: Date): Promise<RecordResult> {
    const target = targetDate ?? this.getYesterday();
    const dateStr = this.formatDateForSheet(target);
    const yymmdd = this.formatDateToYYMMDD(target);

    this.logger.log(`=== 日次出稿数・停止数記録 開始 (対象日: ${dateStr}) ===`);

    const launchCount = await this.countLaunchedAds(yymmdd);
    this.logger.log(`出稿数: ${launchCount}`);

    const pauseCount = await this.countPausedAds(target);
    this.logger.log(`停止数: ${pauseCount}`);

    await this.writeToSheet(dateStr, launchCount, pauseCount);

    this.logger.log(`=== 日次出稿数・停止数記録 完了 ===`);

    return {
      targetDate: target.toISOString().split('T')[0],
      launchCount,
      pauseCount,
      sheetUpdated: true,
    };
  }

  /**
   * 出稿数のカウント: 対象アカウントの広告名がYYMMDD/で始まるものを数える
   */
  private async countLaunchedAds(yymmdd: string): Promise<number> {
    const count = await this.prisma.ad.count({
      where: {
        name: { startsWith: yymmdd + '/' },
        adGroup: {
          campaign: {
            advertiser: {
              tiktokAdvertiserId: { in: TARGET_ADVERTISER_IDS },
            },
          },
        },
      },
    });
    return count;
  }

  /**
   * 停止数のカウント: 対象アカウントの予算最適化による停止数
   * ChangeLogの action=PAUSE, source=OPTIMIZATION をカウント
   */
  private async countPausedAds(targetDate: Date): Promise<number> {
    // JST基準で日付範囲を算出（JSTはUTC+9）
    const startOfDayJST = new Date(targetDate);
    startOfDayJST.setUTCHours(-9, 0, 0, 0); // JST 00:00 = UTC前日15:00
    const endOfDayJST = new Date(startOfDayJST);
    endOfDayJST.setUTCDate(endOfDayJST.getUTCDate() + 1);

    // 対象アカウントの広告TikTok IDリストを取得
    const targetAds = await this.prisma.ad.findMany({
      where: {
        adGroup: {
          campaign: {
            advertiser: {
              tiktokAdvertiserId: { in: TARGET_ADVERTISER_IDS },
            },
          },
        },
      },
      select: { tiktokId: true },
    });
    const targetAdIds = new Set(targetAds.map((a) => a.tiktokId));

    if (targetAdIds.size === 0) {
      return 0;
    }

    // ChangeLogから予算最適化によるPAUSEを取得
    const pauses = await this.prisma.changeLog.findMany({
      where: {
        action: 'PAUSE',
        source: 'OPTIMIZATION',
        createdAt: {
          gte: startOfDayJST,
          lt: endOfDayJST,
        },
      },
      select: { entityId: true },
    });

    // 対象アカウントの広告のみカウント
    const count = pauses.filter((p) => targetAdIds.has(p.entityId)).length;
    return count;
  }

  /**
   * Google Sheetsへ書き込み
   * A列の日付が一致する行があれば更新、なければ新規行を追加
   */
  private async writeToSheet(
    dateStr: string,
    launchCount: number,
    pauseCount: number,
  ): Promise<void> {
    const range = `${SHEET_NAME}!A:C`;

    // 現在のシートデータを取得
    const rows = await this.googleSheetsService.getValues(
      SPREADSHEET_ID,
      range,
    );

    // A列（2行目以降）から一致する日付の行番号を探す
    let matchRow: number | null = null;
    for (let i = 1; i < rows.length; i++) {
      const cellValue = (rows[i]?.[0] ?? '').toString().trim();
      if (cellValue === dateStr) {
        matchRow = i + 1; // シートの行番号は1始まり
        break;
      }
    }

    if (matchRow) {
      // 既存行を更新
      const updateRange = `${SHEET_NAME}!B${matchRow}:C${matchRow}`;
      await this.googleSheetsService.updateValues(SPREADSHEET_ID, updateRange, [
        [String(launchCount), String(pauseCount)],
      ]);
      this.logger.log(
        `シートの${matchRow}行目を更新: ${dateStr} | 出稿=${launchCount} | 停止=${pauseCount}`,
      );
    } else {
      // 新規行を追加
      await this.googleSheetsService.appendValues(SPREADSHEET_ID, range, [
        [dateStr, String(launchCount), String(pauseCount)],
      ]);
      this.logger.log(
        `シートに新規行を追加: ${dateStr} | 出稿=${launchCount} | 停止=${pauseCount}`,
      );
    }
  }

  /** 前日のDateオブジェクトを返す（JST基準） */
  private getYesterday(): Date {
    const now = new Date();
    // JST = UTC + 9
    const jstNow = new Date(now.getTime() + 9 * 60 * 60 * 1000);
    const yesterday = new Date(jstNow);
    yesterday.setUTCDate(yesterday.getUTCDate() - 1);
    // 日付のみ（時刻なし）を返す
    return new Date(
      Date.UTC(
        yesterday.getUTCFullYear(),
        yesterday.getUTCMonth(),
        yesterday.getUTCDate(),
      ),
    );
  }

  /** Date → "M/D" 形式（先頭ゼロなし） */
  private formatDateForSheet(date: Date): string {
    const month = date.getUTCMonth() + 1;
    const day = date.getUTCDate();
    return `${month}/${day}`;
  }

  /** Date → "YYMMDD" 形式 */
  private formatDateToYYMMDD(date: Date): string {
    const year = String(date.getUTCFullYear()).slice(2);
    const month = String(date.getUTCMonth() + 1).padStart(2, '0');
    const day = String(date.getUTCDate()).padStart(2, '0');
    return `${year}${month}${day}`;
  }
}

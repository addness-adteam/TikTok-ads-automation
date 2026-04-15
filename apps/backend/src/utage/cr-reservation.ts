/**
 * CR番号予約ユーティリティ（ローカルtsxスクリプト用）
 * 並行実行・反映ラグによる番号重複を、DBのユニーク制約で原子的に防ぐ。
 */
import type { PrismaClient } from '@prisma/client';

/**
 * UTAGE一覧全ページを走査してCR番号のmaxを返す。
 * 一覧は古い順に並ぶ前提。見つからなければ0。
 *
 * @param authedGet UTAGEセッション済みのGET関数（URL→{html}）
 */
export async function getUtageCrMax(
  authedGet: (url: string) => Promise<string | { html: string }>,
  utageBaseUrl: string,
  funnelId: string,
  appeal: string,
  lpNumber: number,
): Promise<number> {
  const trackingUrl = `${utageBaseUrl}/funnel/${funnelId}/tracking`;
  const pattern = new RegExp(
    `TikTok広告-${appeal}-LP${lpNumber}-CR(0\\d{4})`,
    'g',
  );
  const allNumbers: number[] = [];
  const MAX_PAGES = 30;

  for (let page = 1; page <= MAX_PAGES; page++) {
    const url = page === 1 ? trackingUrl : `${trackingUrl}?page=${page}`;
    const result = await authedGet(url);
    const html = typeof result === 'string' ? result : result.html;
    const matches = [...html.matchAll(pattern)];
    allNumbers.push(...matches.map((m) => parseInt(m[1])));
    if (!html.includes(`page=${page + 1}`)) break;
  }

  return allNumbers.length === 0 ? 0 : Math.max(...allNumbers);
}

/**
 * CR番号を原子的に予約する。UTAGE max と予約テーブル max の max+1 を候補にし、
 * ユニーク制約違反（P2002）なら+1してリトライ。
 */
export async function reserveNextCrNumber(
  prisma: PrismaClient,
  appeal: string,
  lpNumber: number,
  utageMax: number,
): Promise<number> {
  const dbAgg = await prisma.crNumberReservation.aggregate({
    where: { appeal, lpNumber },
    _max: { crNumber: true },
  });
  const dbMax = dbAgg._max.crNumber ?? 0;
  let candidate = Math.max(utageMax, dbMax) + 1;

  for (let i = 0; i < 100; i++) {
    try {
      await prisma.crNumberReservation.create({
        data: { appeal, lpNumber, crNumber: candidate },
      });
      console.log(
        `[CR予約] ${appeal} LP${lpNumber} CR${String(candidate).padStart(5, '0')} (utageMax=${utageMax}, dbMax=${dbMax})`,
      );
      return candidate;
    } catch (e: any) {
      if (e?.code === 'P2002') {
        candidate++;
        continue;
      }
      throw e;
    }
  }
  throw new Error(`CR番号予約リトライ上限超過: ${appeal} LP${lpNumber}`);
}

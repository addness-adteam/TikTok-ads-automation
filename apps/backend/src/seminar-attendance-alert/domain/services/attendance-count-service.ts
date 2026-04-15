/**
 * オプト × 予約 × 着座 の3ソースを突合し、
 * 広告LP-CR単位での {予約件数, 着座件数} を算出するドメインサービス
 *
 * 突合方針:
 *   - 予約 ↔ 着座 は LINE名 で突合（Lステップエクスポートにメアドが含まれないため）
 *   - 予約 ↔ オプト は メアド で突合して LP-CR を解決
 */

export interface ReservationRecord {
  email: string;
  lineName: string;
  reservedAt: Date;
}

export interface OptPathEntry {
  lpCr: string;
  timestamp: Date;
}

export interface LpCrCount {
  reservationCount: number;
  attendanceCount: number;
}

export class AttendanceCountService {
  /**
   * @param optPathMap email(lowercased) → 最新のLP-CR
   * @param reservations 予約者全員 (email + lineName)
   * @param attendedLineNames 着座者のLINE名集合（Lステップ由来）
   * @returns LP-CR → {予約数, 着座数}
   */
  countByLpCr(
    optPathMap: Map<string, OptPathEntry>,
    reservations: ReservationRecord[],
    attendedLineNames: Set<string>,
  ): Map<string, LpCrCount> {
    const normEmail = (s: string) => s.trim().toLowerCase();
    const normLine = (s: string) => s.trim();
    const attended = new Set<string>([...attendedLineNames].map(normLine));

    const result = new Map<string, LpCrCount>();
    for (const r of reservations) {
      const email = normEmail(r.email);
      const lineName = normLine(r.lineName);
      if (!email) continue;
      const opt = optPathMap.get(email);
      if (!opt) continue; // LP-CR不明はカウント対象外

      const lpCr = opt.lpCr.toUpperCase();
      const cur = result.get(lpCr) ?? {
        reservationCount: 0,
        attendanceCount: 0,
      };
      cur.reservationCount += 1;
      if (lineName && attended.has(lineName)) cur.attendanceCount += 1;
      result.set(lpCr, cur);
    }
    return result;
  }
}

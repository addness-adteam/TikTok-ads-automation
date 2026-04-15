/**
 * オプト × 予約 × 着座 の3ソースを突合し、
 * 広告LP-CR単位での {予約件数, 着座件数} を算出するドメインサービス
 */

export interface ReservationRecord {
  email: string;
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
   * @param optPathMap email → 最新のLP-CR
   * @param reservations 予約者全員のリスト
   * @param attendedEmails 着座者メアドの集合 (Lステップ由来)
   * @returns LP-CR → {予約数, 着座数}
   */
  countByLpCr(
    optPathMap: Map<string, OptPathEntry>,
    reservations: ReservationRecord[],
    attendedEmails: Set<string>,
  ): Map<string, LpCrCount> {
    const normalize = (s: string) => s.trim().toLowerCase();
    const attended = new Set<string>([...attendedEmails].map(normalize));

    const result = new Map<string, LpCrCount>();
    for (const r of reservations) {
      const email = normalize(r.email);
      if (!email) continue;
      const opt = optPathMap.get(email);
      if (!opt) continue; // LP-CR不明はカウント対象外

      const lpCr = opt.lpCr.toUpperCase();
      const cur = result.get(lpCr) ?? {
        reservationCount: 0,
        attendanceCount: 0,
      };
      cur.reservationCount += 1;
      if (attended.has(email)) cur.attendanceCount += 1;
      result.set(lpCr, cur);
    }
    return result;
  }
}

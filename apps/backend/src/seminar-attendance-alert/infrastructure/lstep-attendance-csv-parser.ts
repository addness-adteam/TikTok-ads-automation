/**
 * Lステップ友だちリストCSVから着座者メアドを抽出するパーサー
 *
 * CSVは「ID, 表示名, LINE登録名」＋ タグフィルタ「ウェビナー①_着座」で絞ったもの。
 * LステップCSVにはメールアドレス列が別途存在する（ユーザーの友だち追加時に入力される）
 * ※実CSVフォーマットの確認が必要（メアド列のヘッダー名）
 */
export class LstepAttendanceCsvParser {
  /**
   * @param csvText CSV生文字列（UTF-8 or CP932のどちらもあり得る。呼出側でUTF-8化しておく）
   * @returns 着座者メアドの集合（lowercase）
   */
  parse(csvText: string): Set<string> {
    const result = new Set<string>();
    const lines = csvText.split(/\r?\n/).filter((l) => l.trim() !== '');
    if (lines.length === 0) return result;

    const headerCells = this.parseCsvLine(lines[0]);
    // メアド列の位置を特定: "メール" "mail" "Eメール" "E-Mail" などを含むヘッダー
    const emailColIdx = headerCells.findIndex((h) =>
      /mail|メール|メアド|E-Mail/i.test(h),
    );
    if (emailColIdx < 0) {
      // ヘッダーに無ければ各行の全セルからメアド形式を走査
      for (const line of lines.slice(1)) {
        const cells = this.parseCsvLine(line);
        for (const cell of cells) {
          const m = cell.match(/[\w.+-]+@[\w-]+\.[\w.-]+/);
          if (m) result.add(m[0].toLowerCase());
        }
      }
      return result;
    }

    for (const line of lines.slice(1)) {
      const cells = this.parseCsvLine(line);
      const raw = cells[emailColIdx];
      if (!raw) continue;
      const email = String(raw).trim().toLowerCase();
      if (email.includes('@')) result.add(email);
    }
    return result;
  }

  /** 簡易CSV行パーサ（ダブルクォート対応） */
  private parseCsvLine(line: string): string[] {
    const cells: string[] = [];
    let cur = '';
    let inQuote = false;
    for (let i = 0; i < line.length; i++) {
      const ch = line[i];
      if (inQuote) {
        if (ch === '"' && line[i + 1] === '"') {
          cur += '"';
          i++;
        } else if (ch === '"') {
          inQuote = false;
        } else {
          cur += ch;
        }
      } else {
        if (ch === ',') {
          cells.push(cur);
          cur = '';
        } else if (ch === '"') {
          inQuote = true;
        } else {
          cur += ch;
        }
      }
    }
    cells.push(cur);
    return cells;
  }
}

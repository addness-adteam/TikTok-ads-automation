import { config } from 'dotenv';
import * as path from 'path';
config({ path: path.resolve(__dirname, '.env') });
config({ path: path.resolve(process.cwd(), '.env') });
import { google } from 'googleapis';
import { SheetsAllowableCpoResolver } from './src/seminar-attendance-alert/infrastructure/allowable-cpo-resolver';
import { YearMonth } from './src/seminar-attendance-alert/domain/value-objects/allowable-seminar-seat-cpo';

async function main() {
  const creds = JSON.parse(process.env.GOOGLE_SERVICE_ACCOUNT_CREDENTIALS ?? '{}');
  const auth = new google.auth.GoogleAuth({ credentials: creds, scopes: ['https://www.googleapis.com/auth/spreadsheets.readonly'] });
  const sheets = google.sheets({ version: 'v4', auth: await auth.getClient() as any });
  const res = await sheets.spreadsheets.values.get({
    spreadsheetId: '1MsJRbZGrLOkgd7lRApr1ciFQ1GOZaIjmrXQSIe3_nCA',
    range: 'スキルプラス（オートウェビナー用）!A1:AZ500',
  });
  const rows = res.data.values ?? [];

  const resolver = new SheetsAllowableCpoResolver({} as any);
  const months = [
    YearMonth.of(2025, 9),
    YearMonth.of(2025, 10),
    YearMonth.of(2025, 11),
    YearMonth.of(2026, 1),
    YearMonth.of(2026, 2),
    YearMonth.of(2026, 3),
    YearMonth.of(2026, 4),
  ];
  for (const m of months) {
    const result = resolver.extractFromRows(rows, m);
    console.log(`${m.toString()}: ${result ? '¥' + result.amount.amount.toLocaleString() : '(見つからない)'}`);
  }
}
main().catch(e => { console.error(e); process.exit(1); });

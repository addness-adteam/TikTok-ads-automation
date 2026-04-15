import { config } from 'dotenv';
import * as path from 'path';
config({ path: path.resolve(__dirname, '.env') });
config({ path: path.resolve(process.cwd(), '.env') });
import { google } from 'googleapis';
import { SheetsReservationSurveyReader } from './src/seminar-attendance-alert/infrastructure/reservation-survey-reader';

async function main() {
  const creds = JSON.parse(process.env.GOOGLE_SERVICE_ACCOUNT_CREDENTIALS ?? '{}');
  const auth = new google.auth.GoogleAuth({ credentials: creds, scopes: ['https://www.googleapis.com/auth/spreadsheets.readonly'] });
  const googleSheets = google.sheets({ version: 'v4', auth: await auth.getClient() as any });

  // GoogleSheetsServiceっぽいインターフェイスのスタブ
  const fakeSheetsService: any = {
    sheets: googleSheets,
    getValues: async (spreadsheetId: string, range: string) => {
      const r = await googleSheets.spreadsheets.values.get({ spreadsheetId, range });
      return r.data.values ?? [];
    },
  };

  const reader = new SheetsReservationSurveyReader(fakeSheetsService);
  const records = await reader.load();
  console.log(`読み込み件数: ${records.length}`);
  console.log('先頭5件:');
  for (const r of records.slice(0, 5)) console.log(`  ${r.reservedAt.toISOString()} | ${r.email}`);
  console.log('末尾3件:');
  for (const r of records.slice(-3)) console.log(`  ${r.reservedAt.toISOString()} | ${r.email}`);
}
main().catch(e => { console.error(e); process.exit(1); });

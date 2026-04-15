import { config } from 'dotenv';
import * as path from 'path';
config({ path: path.resolve(__dirname, '.env') });
config({ path: path.resolve(process.cwd(), '.env') });
import { google } from 'googleapis';

async function main() {
  const creds = JSON.parse(process.env.GOOGLE_SERVICE_ACCOUNT_CREDENTIALS ?? '{}');
  const auth = new google.auth.GoogleAuth({ credentials: creds, scopes: ['https://www.googleapis.com/auth/spreadsheets.readonly'] });
  const sheets = google.sheets({ version: 'v4', auth: await auth.getClient() as any });

  const ids = [
    { label: 'AI メアド一覧(旧)', id: '13x6k01kuazOc03pSJYYeDheWsAxXmD11OCUXluzwAGM' },
    { label: 'APPEAL_AI_CV', id: process.env.APPEAL_AI_CV_SPREADSHEET_ID! },
    { label: 'APPEAL_SNS_CV', id: process.env.APPEAL_SNS_CV_SPREADSHEET_ID! },
    { label: 'APPEAL_SEMINAR_CV (?)', id: process.env.APPEAL_SEMINAR_CV_SPREADSHEET_ID ?? process.env.APPEAL_SKILL_PLUS_CV_SPREADSHEET_ID ?? '' },
    { label: 'APPEAL_AI_FRONT', id: process.env.APPEAL_AI_FRONT_SPREADSHEET_ID! },
  ];
  for (const { label, id } of ids) {
    if (!id) { console.log(`\n${label}: (env未設定)`); continue; }
    try {
      const meta = await sheets.spreadsheets.get({ spreadsheetId: id });
      console.log(`\n=== ${label} (${id}) ===`);
      for (const s of meta.data.sheets ?? []) console.log(`  - ${s.properties?.title}`);
    } catch (e: any) {
      console.log(`\n${label}: ERROR ${e.message}`);
    }
  }
}
main().catch(e => { console.error(e); process.exit(1); });

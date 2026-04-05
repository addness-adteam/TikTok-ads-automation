import * as cheerio from 'cheerio'
import * as dotenv from 'dotenv'
import * as path from 'path'
dotenv.config({ path: path.resolve(__dirname, '.env') })

const OPERATOR_LOGIN_URL = 'https://school.addness.co.jp/operator/GYbKT7Y9d0eR/login'
const UTAGE_BASE_URL = 'https://school.addness.co.jp'
let sessionCookies = ''

function mergeCookies(existing: string, response: Response): string {
  const raw = response.headers.get('set-cookie')
  if (!raw) return existing
  const cookies = raw.split(/,(?=\s*[a-zA-Z_]+=)/).map(c => c.split(';')[0].trim())
  const merged = new Map<string, string>()
  if (existing) existing.split('; ').forEach(c => { merged.set(c.split('=')[0], c) })
  cookies.forEach(c => { merged.set(c.split('=')[0], c) })
  return [...merged.values()].join('; ')
}

async function login(): Promise<void> {
  const email = process.env.UTAGE_EMAIL!
  const password = process.env.UTAGE_PASSWORD!
  const loginPageResp = await fetch(OPERATOR_LOGIN_URL, { redirect: 'manual' })
  sessionCookies = mergeCookies('', loginPageResp)
  const $ = cheerio.load(await loginPageResp.text())
  const csrfToken = $('input[name="_token"]').attr('value') || ''
  const loginResp = await fetch(OPERATOR_LOGIN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'Cookie': sessionCookies },
    body: new URLSearchParams({ _token: csrfToken, email, password }).toString(),
    redirect: 'manual',
  })
  sessionCookies = mergeCookies(sessionCookies, loginResp)
  const loc = loginResp.headers.get('location') || ''
  if (loginResp.status === 302 && !loc.includes('/login')) {
    const r = await fetch(loc.startsWith('http') ? loc : `${UTAGE_BASE_URL}${loc}`, { headers: { 'Cookie': sessionCookies }, redirect: 'manual' })
    sessionCookies = mergeCookies(sessionCookies, r)
    console.log('ログイン成功\n')
  }
}

async function fetchPage(url: string): Promise<string> {
  return (await fetch(url, { headers: { 'Cookie': sessionCookies }, redirect: 'follow' })).text()
}

async function dumpFunnel(funnelId: string, label: string) {
  console.log(`========== ${label} (funnelId: ${funnelId}) ==========`)
  const html = await fetchPage(`${UTAGE_BASE_URL}/funnel/${funnelId}/tracking/create`)
  const $ = cheerio.load(html)

  console.log('group_id:')
  $('select[name="group_id"] option').each((_, el) => {
    const val = $(el).attr('value') || ''
    const text = $(el).text().trim()
    if (val && val !== '0') console.log(`  "${val}" → ${text}`)
  })

  console.log('step_id (TikTok関連のみ):')
  $('select[name="step_id"] option').each((_, el) => {
    const val = $(el).attr('value') || ''
    const text = $(el).text().trim()
    if (text.includes('TikTok') || text.includes('tiktok') || text.includes('Tiktok') || text.includes('オプトイン')) {
      console.log(`  "${val}" → ${text}`)
    }
  })
  console.log('')
}

async function main() {
  await login()
  await dumpFunnel('a09j9jop95LF', 'AI (TikTok)')
  await dumpFunnel('dZNDzwCgHNBC', 'SNS (TikTok)')
  await dumpFunnel('3lS3x3dXa6kc', 'スキルプラス (TikTok) - セミナー導線')
  await dumpFunnel('EYHSSYtextak', 'スキルプラス (TikTok) - LP1')
}

main().catch(e => { console.error(e); process.exit(1) })

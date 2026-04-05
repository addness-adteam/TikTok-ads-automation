/**
 * TikTok広告のLP URLに含まれるstepIdからUTAGEファネルを逆引きする
 */
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
  const email = process.env.UTAGE_EMAIL
  const password = process.env.UTAGE_PASSWORD
  if (!email || !password) throw new Error('UTAGE credentials missing')

  const loginPageResp = await fetch(OPERATOR_LOGIN_URL, { redirect: 'manual' })
  sessionCookies = mergeCookies('', loginPageResp)
  const html = await loginPageResp.text()
  const $ = cheerio.load(html)
  const csrfToken = $('input[name="_token"]').attr('value') || ''

  const loginResp = await fetch(OPERATOR_LOGIN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'Cookie': sessionCookies },
    body: new URLSearchParams({ _token: csrfToken, email, password }).toString(),
    redirect: 'manual',
  })
  sessionCookies = mergeCookies(sessionCookies, loginResp)

  const location = loginResp.headers.get('location') || ''
  if (loginResp.status === 302 && !location.includes('/login')) {
    const redir = await fetch(location.startsWith('http') ? location : `${UTAGE_BASE_URL}${location}`, {
      headers: { 'Cookie': sessionCookies }, redirect: 'manual',
    })
    sessionCookies = mergeCookies(sessionCookies, redir)
    console.log('ログイン成功')
  } else {
    throw new Error('ログイン失敗')
  }
}

async function fetchPage(url: string): Promise<string> {
  const resp = await fetch(url, { headers: { 'Cookie': sessionCookies }, redirect: 'follow' })
  return resp.text()
}

async function main() {
  await login()

  // TikTok広告で使用されているLP URLのstepId
  // AI: https://school.addness.co.jp/p/r2RHcL0PdGIY?ftid=XXX
  // SNS: https://school.addness.co.jp/p/AhTvtpaeXyj6?ftid=XXX
  const knownStepIds = ['r2RHcL0PdGIY', 'AhTvtpaeXyj6']

  console.log('\n=== UTAGEオペレーターページからファネル一覧を取得 ===')

  // オペレーターダッシュボードを取得
  const dashHtml = await fetchPage(`${UTAGE_BASE_URL}/operator/GYbKT7Y9d0eR`)

  // ファネル一覧ページへのリンクを探す
  const $ = cheerio.load(dashHtml)
  const links = new Set<string>()
  $('a').each((_, el) => {
    const href = $(el).attr('href') || ''
    if (href.includes('/funnel/')) links.add(href)
  })
  console.log(`ダッシュボード内のファネルリンク: ${links.size}件`)
  for (const l of links) console.log(`  ${l}`)

  // ファネル一覧ページを試す
  console.log('\n=== ファネル一覧ページを探索 ===')
  const funnelListUrls = [
    `${UTAGE_BASE_URL}/operator/GYbKT7Y9d0eR/funnel`,
    `${UTAGE_BASE_URL}/operator/GYbKT7Y9d0eR/funnels`,
    `${UTAGE_BASE_URL}/funnel`,
  ]

  for (const url of funnelListUrls) {
    try {
      const html = await fetchPage(url)
      const $page = cheerio.load(html)
      const funnelLinks: string[] = []
      $page('a[href*="/funnel/"]').each((_, el) => {
        const href = $page(el).attr('href') || ''
        const text = $page(el).text().trim()
        if (href.match(/\/funnel\/[a-zA-Z0-9]{8,}/)) {
          funnelLinks.push(`${href} → ${text}`)
        }
      })
      if (funnelLinks.length > 0) {
        console.log(`\n${url} でファネル発見 (${funnelLinks.length}件):`)
        for (const f of [...new Set(funnelLinks)].slice(0, 30)) console.log(`  ${f}`)
      }
    } catch (e: any) {
      // skip
    }
  }

  // 既知のstepIdを含むページを直接アクセスして確認
  console.log('\n=== 既知のstepIdからファネル逆引き ===')
  for (const stepId of knownStepIds) {
    console.log(`\nstepId: ${stepId} (URL: /p/${stepId})`)

    // ステップページにアクセスして、ファネル情報がHTMLに含まれるか確認
    try {
      const pageHtml = await fetchPage(`${UTAGE_BASE_URL}/p/${stepId}`)
      const $page = cheerio.load(pageHtml)
      const title = $page('title').text().trim()
      console.log(`  ページタイトル: ${title}`)

      // ファネルIDを含むリンクやdata属性を探す
      const funnelRefs = pageHtml.match(/funnel\/([a-zA-Z0-9]{8,})/g)
      if (funnelRefs) {
        console.log(`  ファネル参照: ${[...new Set(funnelRefs)].join(', ')}`)
      }
    } catch (e: any) {
      console.log(`  アクセスエラー: ${e.message}`)
    }
  }

  // ブルートフォース: 各ファネルのstep_id一覧にknownStepIdsが含まれるか確認
  // すでに見つけた3つ以外のファネルIDを試す
  console.log('\n=== 全ファネルのステップをスキャンして逆引き ===')

  // ダッシュボードのHTMLから全てのファネルIDを抽出
  const allFunnelIds = new Set<string>()
  // 既知のMeta用
  allFunnelIds.add('TXUOxBYkYr9e')
  allFunnelIds.add('IyarhS8EGCgK')
  allFunnelIds.add('d0imwFvGWVbA')

  // ダッシュボードから追加
  const funnelPattern = /\/funnel\/([a-zA-Z0-9]{8,})/g
  let match
  while ((match = funnelPattern.exec(dashHtml)) !== null) {
    allFunnelIds.add(match[1])
  }

  // ファネル一覧ページからも取得試行
  for (const url of funnelListUrls) {
    try {
      const html = await fetchPage(url)
      let m
      const p = /\/funnel\/([a-zA-Z0-9]{8,})/g
      while ((m = p.exec(html)) !== null) allFunnelIds.add(m[1])
    } catch {}
  }

  console.log(`スキャン対象ファネル: ${allFunnelIds.size}個 → ${[...allFunnelIds].join(', ')}`)

  for (const funnelId of allFunnelIds) {
    try {
      const html = await fetchPage(`${UTAGE_BASE_URL}/funnel/${funnelId}/tracking/create`)
      const $page = cheerio.load(html)

      // stepIdを全部抽出
      const stepIds: string[] = []
      $page('select[name="step_id"] option').each((_, el) => {
        const val = $page(el).attr('value') || ''
        const text = $page(el).text().trim()
        if (val) stepIds.push(`${val}:${text}`)

        // knownStepIdsに含まれるか
        if (knownStepIds.includes(val)) {
          console.log(`\n★★★ 発見! stepId "${val}" → ファネル ${funnelId}`)
          console.log(`    ステップ名: ${text}`)
        }
      })

      // TikTok関連のステップを探す
      for (const s of stepIds) {
        if (s.toLowerCase().includes('tiktok') || s.includes('ティック')) {
          console.log(`  TikTok関連ステップ: ${s} (ファネル: ${funnelId})`)
        }
      }
    } catch {}
  }
}

main().catch(e => { console.error(e); process.exit(1) })

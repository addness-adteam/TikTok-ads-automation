/**
 * UTAGEからTikTok広告用のファネルID/グループID/ステップIDを自動取得するスクリプト
 *
 * 使い方: npx tsx apps/backend/get-tiktok-utage-funnel-ids.ts
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

function extractCsrfToken(html: string): string {
  const $ = cheerio.load(html)
  const token = $('input[name="_token"]').attr('value')
  if (token) return token
  const metaToken = $('meta[name="csrf-token"]').attr('content')
  if (metaToken) return metaToken
  throw new Error('CSRFトークンが見つかりません')
}

async function login(): Promise<void> {
  const email = process.env.UTAGE_EMAIL
  const password = process.env.UTAGE_PASSWORD
  if (!email || !password) {
    throw new Error('UTAGE_EMAIL / UTAGE_PASSWORD が .env に設定されていません')
  }

  console.log('UTAGEにログイン中...')

  const loginPageResp = await fetch(OPERATOR_LOGIN_URL, { redirect: 'manual' })
  sessionCookies = mergeCookies('', loginPageResp)
  const loginPageHtml = await loginPageResp.text()
  const csrfToken = extractCsrfToken(loginPageHtml)

  const formBody = new URLSearchParams({ _token: csrfToken, email, password })
  const loginResp = await fetch(OPERATOR_LOGIN_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      'Cookie': sessionCookies,
      'Referer': OPERATOR_LOGIN_URL,
    },
    body: formBody.toString(),
    redirect: 'manual',
  })
  sessionCookies = mergeCookies(sessionCookies, loginResp)

  const location = loginResp.headers.get('location') || ''
  if (loginResp.status === 302 && !location.includes('/login')) {
    console.log('ログイン成功！\n')
    const redirectResp = await fetch(location.startsWith('http') ? location : `${UTAGE_BASE_URL}${location}`, {
      headers: { 'Cookie': sessionCookies },
      redirect: 'manual',
    })
    sessionCookies = mergeCookies(sessionCookies, redirectResp)
  } else {
    throw new Error('UTAGEログイン失敗')
  }
}

async function fetchPage(url: string): Promise<string> {
  const resp = await fetch(url, {
    headers: { 'Cookie': sessionCookies },
    redirect: 'follow',
  })
  return await resp.text()
}

// まずオペレーターのファネル一覧を取得して、TikTok広告用のファネルを探す
async function listAllFunnels(): Promise<void> {
  console.log('========== ファネル一覧を取得中 ==========')

  // オペレーターダッシュボードからファネル一覧を探す
  // UTAGEの管理画面の構造に依存するが、一般的なパスを試す
  const dashboardHtml = await fetchPage(`${UTAGE_BASE_URL}/operator/GYbKT7Y9d0eR`)
  const $ = cheerio.load(dashboardHtml)

  // ファネルへのリンクを探す
  const funnelLinks: { id: string; name: string }[] = []
  $('a[href*="/funnel/"]').each((_, el) => {
    const href = $(el).attr('href') || ''
    const match = href.match(/\/funnel\/([a-zA-Z0-9]+)/)
    if (match) {
      const name = $(el).text().trim()
      if (name && !funnelLinks.find(f => f.id === match[1])) {
        funnelLinks.push({ id: match[1], name })
      }
    }
  })

  if (funnelLinks.length > 0) {
    console.log(`\nファネル一覧（${funnelLinks.length}件）:`)
    for (const f of funnelLinks) {
      console.log(`  funnelId: ${f.id} → ${f.name}`)
    }
  } else {
    console.log('ダッシュボードからファネルリンクが見つかりませんでした')
  }

  // 既知のMeta広告用ファネルID
  const metaFunnelIds = ['TXUOxBYkYr9e', 'IyarhS8EGCgK', 'd0imwFvGWVbA']

  // tracking一覧ページでTikTok広告の登録経路を探す
  console.log('\n========== TikTok広告の登録経路を探索中 ==========')

  for (const funnelId of metaFunnelIds) {
    console.log(`\nファネル ${funnelId} のtracking一覧を確認中...`)
    try {
      const html = await fetchPage(`${UTAGE_BASE_URL}/funnel/${funnelId}/tracking`)
      const tiktokMatches = [...html.matchAll(/TikTok広告[^"<]*/g)]
      if (tiktokMatches.length > 0) {
        console.log(`  → TikTok広告の登録経路が見つかりました（${tiktokMatches.length}件）:`)
        const unique = [...new Set(tiktokMatches.map(m => m[0]))]
        for (const m of unique.slice(0, 10)) {
          console.log(`    ${m}`)
        }
      } else {
        console.log(`  → TikTok広告の登録経路なし`)
      }
    } catch (e: any) {
      console.log(`  → アクセス失敗: ${e.message}`)
    }
  }
}

async function extractFunnelIds(funnelId: string, label: string): Promise<void> {
  console.log(`\n========== ${label} (funnelId: ${funnelId}) ==========`)

  const createUrl = `${UTAGE_BASE_URL}/funnel/${funnelId}/tracking/create`
  console.log(`アクセス中: ${createUrl}`)
  const html = await fetchPage(createUrl)
  const $ = cheerio.load(html)

  // group_id
  console.log('\n--- group_id の選択肢 ---')
  const groupSelect = $('select[name="group_id"]')
  if (groupSelect.length > 0) {
    groupSelect.find('option').each((_, el) => {
      const val = $(el).attr('value') || ''
      const text = $(el).text().trim()
      if (val && val !== '0') console.log(`  groupId: "${val}"  →  ${text}`)
    })
  } else {
    console.log('  <select name="group_id"> が見つかりません')
  }

  // step_id
  console.log('\n--- step_id の選択肢 ---')
  const stepSelect = $('select[name="step_id"]')
  if (stepSelect.length > 0) {
    stepSelect.find('option').each((_, el) => {
      const val = $(el).attr('value') || ''
      const text = $(el).text().trim()
      if (val) console.log(`  stepId: "${val}"  →  ${text}`)
    })
  } else {
    console.log('  <select name="step_id"> が見つかりません')
  }

  // TikTok広告関連のステップを特にハイライト
  console.log('\n--- TikTok広告関連のステップ ---')
  stepSelect.find('option').each((_, el) => {
    const text = $(el).text().trim()
    const val = $(el).attr('value') || ''
    if (text.includes('TikTok') || text.includes('tiktok') || text.includes('ティックトック')) {
      console.log(`  ★ stepId: "${val}"  →  ${text}`)
    }
  })

  // ページタイトル
  console.log(`\nページタイトル: ${$('title').text().trim()}`)
}

async function main() {
  await login()
  await listAllFunnels()

  // Meta広告で使われているファネルIDでTikTok用のステップがあるか確認
  await extractFunnelIds('TXUOxBYkYr9e', 'AIファネル (Meta用)')
  await extractFunnelIds('IyarhS8EGCgK', 'SNSファネル (Meta用)')
  await extractFunnelIds('d0imwFvGWVbA', 'スキルプラスファネル (Meta用)')

  // TikTok広告の登録経路パターンからファネルIDを逆引き
  console.log('\n\n========== 既存のTikTok広告登録経路からファネル情報を抽出 ==========')

  // 各ファネルのtrackingページをパースしてTikTok広告のURLパターンを探す
  for (const { funnelId, label } of [
    { funnelId: 'TXUOxBYkYr9e', label: 'AI' },
    { funnelId: 'IyarhS8EGCgK', label: 'SNS' },
    { funnelId: 'd0imwFvGWVbA', label: 'スキルプラス' },
  ]) {
    let page = 1
    let found = false
    while (page <= 5) {
      const url = page === 1
        ? `${UTAGE_BASE_URL}/funnel/${funnelId}/tracking`
        : `${UTAGE_BASE_URL}/funnel/${funnelId}/tracking?page=${page}`

      try {
        const html = await fetchPage(url)

        // TikTok広告の登録経路とそのURLを探す
        const tiktokPattern = /TikTok広告-[^"<\s]+/g
        const matches = [...html.matchAll(tiktokPattern)]

        if (matches.length > 0 && !found) {
          console.log(`\n${label}ファネル (${funnelId}) にTikTok広告の登録経路あり:`)
          found = true
        }

        for (const m of matches) {
          // 近くのftid URLを探す
          const idx = html.indexOf(m[0])
          const context = html.substring(Math.max(0, idx - 300), idx + 500)
          const urlMatch = context.match(/https:\/\/school\.addness\.co\.jp\/p\/([a-zA-Z0-9]+)\?ftid=([a-zA-Z0-9]+)/)
          if (urlMatch) {
            console.log(`  ${m[0]} → stepId候補: ${urlMatch[1]}, ftid: ${urlMatch[2]}`)
          } else {
            console.log(`  ${m[0]}`)
          }
        }

        if (!html.includes(`page=${page + 1}`)) break
        page++
      } catch {
        break
      }
    }

    if (!found) {
      console.log(`\n${label}ファネル (${funnelId}): TikTok広告の登録経路なし`)
    }
  }
}

main().catch(err => {
  console.error('エラー:', err.message)
  process.exit(1)
})

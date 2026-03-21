/**
 * UTAGE連携サービス（HTTP版）
 * fetch + 正規表現でUTAGE登録経路の作成・URL取得を行う
 */
import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  TIKTOK_FUNNEL_MAP,
  OPERATOR_LOGIN_URL,
  UTAGE_BASE_URL,
  type FunnelConfig,
  type RegistrationPathResult,
} from './utage.types';

@Injectable()
export class UtageService {
  private readonly logger = new Logger(UtageService.name);
  private sessionCookies = '';
  private csrfToken = '';

  constructor(private configService: ConfigService) {}

  // ========== セッション管理 ==========

  private mergeCookies(existing: string, response: Response): string {
    const setCookieHeaders = response.headers.getSetCookie?.() || [];
    if (setCookieHeaders.length === 0) {
      const raw = response.headers.get('set-cookie');
      if (raw) {
        const cookies = raw.split(/,(?=\s*[a-zA-Z_]+=)/).map(c => c.split(';')[0].trim());
        const merged = new Map<string, string>();
        if (existing) {
          existing.split('; ').forEach(c => {
            const [k] = c.split('=');
            merged.set(k, c);
          });
        }
        cookies.forEach(c => {
          const [k] = c.split('=');
          merged.set(k, c);
        });
        return [...merged.values()].join('; ');
      }
      return existing;
    }

    const merged = new Map<string, string>();
    if (existing) {
      existing.split('; ').forEach(c => {
        const [k] = c.split('=');
        merged.set(k, c);
      });
    }
    setCookieHeaders.forEach(header => {
      const cookie = header.split(';')[0].trim();
      const [k] = cookie.split('=');
      merged.set(k, cookie);
    });
    return [...merged.values()].join('; ');
  }

  private extractCsrfToken(html: string): string {
    const inputMatch = html.match(/<input[^>]+name=["']_token["'][^>]+value=["']([^"']+)["']/);
    if (inputMatch) return inputMatch[1];
    const inputMatch2 = html.match(/value=["']([^"']+)["'][^>]+name=["']_token["']/);
    if (inputMatch2) return inputMatch2[1];
    const metaMatch = html.match(/<meta[^>]+name=["']csrf-token["'][^>]+content=["']([^"']+)["']/);
    if (metaMatch) return metaMatch[1];
    throw new Error('UTAGE: CSRFトークンが見つかりません');
  }

  async login(): Promise<void> {
    const email = this.configService.get<string>('UTAGE_EMAIL') || 'chiba.nobuteru@team.addness.co.jp';
    const password = this.configService.get<string>('UTAGE_PASSWORD') || 'bC4F6mkV';

    this.logger.log('UTAGE: ログイン中...');

    // Step 1: ログインページ取得
    const loginPageResp = await fetch(OPERATOR_LOGIN_URL, { redirect: 'manual' });
    this.sessionCookies = this.mergeCookies('', loginPageResp);
    const loginPageHtml = await loginPageResp.text();
    this.csrfToken = this.extractCsrfToken(loginPageHtml);

    // Step 2: ログインPOST
    const formBody = new URLSearchParams({ _token: this.csrfToken, email, password });
    const loginResp = await fetch(OPERATOR_LOGIN_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        'Cookie': this.sessionCookies,
        'Referer': OPERATOR_LOGIN_URL,
      },
      body: formBody.toString(),
      redirect: 'manual',
    });
    this.sessionCookies = this.mergeCookies(this.sessionCookies, loginResp);

    const location = loginResp.headers.get('location') || '';
    if (loginResp.status === 302 && !location.includes('/login')) {
      this.logger.log('UTAGE: ログイン成功');
      const redirectResp = await fetch(
        location.startsWith('http') ? location : `${UTAGE_BASE_URL}${location}`,
        { headers: { 'Cookie': this.sessionCookies }, redirect: 'manual' },
      );
      this.sessionCookies = this.mergeCookies(this.sessionCookies, redirectResp);
    } else {
      throw new Error('UTAGEログインに失敗しました');
    }
  }

  async ensureSession(): Promise<void> {
    if (!this.sessionCookies) {
      await this.login();
    }
  }

  private async authedGet(url: string, retryCount = 0): Promise<{ html: string; finalUrl: string }> {
    if (retryCount > 3) {
      throw new Error(`UTAGE: 認証リトライ上限超過 (URL: ${url})`);
    }

    await this.ensureSession();

    const resp = await fetch(url, {
      headers: { 'Cookie': this.sessionCookies },
      redirect: 'manual',
    });
    this.sessionCookies = this.mergeCookies(this.sessionCookies, resp);

    if (resp.status === 302) {
      const location = resp.headers.get('location') || '';
      const redirectUrl = location.startsWith('http') ? location : `${UTAGE_BASE_URL}${location}`;
      if (redirectUrl.includes('/login')) {
        this.logger.log('UTAGE: セッション切れ検出、再ログイン...');
        await this.login();
        return this.authedGet(url, retryCount + 1);
      }
      return this.authedGet(redirectUrl, retryCount);
    }

    const html = await resp.text();
    if (html.includes('name="password"') && html.includes('login')) {
      this.logger.log('UTAGE: セッション切れ検出（HTML内ログインフォーム）、再ログイン...');
      await this.login();
      return this.authedGet(url, retryCount + 1);
    }

    return { html, finalUrl: url };
  }

  // ========== 登録経路操作 ==========

  /**
   * 指定導線・LPの最新CR番号を取得
   */
  async getLatestCrNumber(appeal: string, lpNumber: number): Promise<number> {
    const config = TIKTOK_FUNNEL_MAP[appeal]?.[lpNumber];
    if (!config) {
      throw new Error(`未対応の導線/LP: ${appeal} LP${lpNumber}`);
    }

    const trackingUrl = `${UTAGE_BASE_URL}/funnel/${config.funnelId}/tracking`;
    const { html } = await this.authedGet(trackingUrl);

    // TikTok広告用のパターンで検索（5桁ゼロ埋め形式のみマッチ）
    // 過去の手動登録経路（CR29527等）を除外するため、CR00xxx形式に限定
    const pattern = new RegExp(`TikTok広告-${appeal}-LP${lpNumber}-CR(0\\d{4})`, 'g');
    const matches = [...html.matchAll(pattern)];

    if (matches.length === 0) {
      this.logger.log(`UTAGE: ${appeal} LP${lpNumber} の既存登録経路が見つかりません。CR00001から開始します。`);
      return 0;
    }

    const crNumbers = matches.map(m => parseInt(m[1])).sort((a, b) => b - a);
    this.logger.log(`UTAGE: ${appeal} LP${lpNumber} 最新CR番号 = ${crNumbers[0]} (${matches.length}件中)`);
    return crNumbers[0];
  }

  /**
   * 登録経路を作成し、遷移先URLを返す
   */
  async createRegistrationPath(
    appeal: string,
    lpNumber: number,
    crNumber: number,
  ): Promise<RegistrationPathResult> {
    const config = TIKTOK_FUNNEL_MAP[appeal]?.[lpNumber];
    if (!config) {
      throw new Error(`未対応の導線/LP: ${appeal} LP${lpNumber}`);
    }

    const crStr = String(crNumber).padStart(5, '0');
    const registrationPath = `TikTok広告-${appeal}-LP${lpNumber}-CR${crStr}`;
    this.logger.log(`UTAGE: 登録経路作成中... ${registrationPath}`);

    await this.ensureSession();

    // Step 1: 作成フォームページをGETしてCSRFトークンを取得
    const createFormUrl = `${UTAGE_BASE_URL}/funnel/${config.funnelId}/tracking/create`;
    const { html: formHtml } = await this.authedGet(createFormUrl);
    const formToken = (() => {
      try { return this.extractCsrfToken(formHtml); } catch { return this.csrfToken; }
    })();

    // フォームのaction URLを取得（name="name"またはname="group_id"を含むフォームを探す）
    let formAction = '';
    const formRegex = /<form[^>]*action=["']([^"']*)["'][^>]*>([\s\S]*?)<\/form>/gi;
    let formMatch: RegExpExecArray | null;
    while ((formMatch = formRegex.exec(formHtml)) !== null) {
      const action = formMatch[1];
      const formBody = formMatch[2];
      if (formBody.includes('name="name"') || formBody.includes('name="group_id"')) {
        formAction = action;
        break;
      }
    }
    if (!formAction) {
      formAction = `${UTAGE_BASE_URL}/funnel/${config.funnelId}/tracking`;
    }
    const postUrl = formAction.startsWith('http') ? formAction : `${UTAGE_BASE_URL}${formAction}`;

    // Step 2: フォームをPOST送信
    const body = new URLSearchParams({
      _token: formToken,
      name: registrationPath,
      group_id: config.groupId,
      step_id: config.stepId,
    });

    const postResp = await fetch(postUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        'Cookie': this.sessionCookies,
        'Referer': createFormUrl,
      },
      body: body.toString(),
      redirect: 'manual',
    });
    this.sessionCookies = this.mergeCookies(this.sessionCookies, postResp);

    // リダイレクト先を取得
    let listingHtml = '';
    if (postResp.status === 302) {
      const location = postResp.headers.get('location') || '';
      const redirectUrl = location.startsWith('http') ? location : `${UTAGE_BASE_URL}${location}`;
      const { html } = await this.authedGet(redirectUrl);
      listingHtml = html;
    } else {
      listingHtml = await postResp.text();
    }

    // Step 3: 一覧ページから登録経路のURLを抽出
    let foundHtml = '';
    let foundIdx = listingHtml.indexOf(registrationPath);
    if (foundIdx !== -1) {
      foundHtml = listingHtml;
    }

    // 見つからなければ一覧を再取得
    if (foundIdx === -1) {
      const trackingListUrl = `${UTAGE_BASE_URL}/funnel/${config.funnelId}/tracking`;
      const { html } = await this.authedGet(trackingListUrl);
      foundIdx = html.indexOf(registrationPath);
      if (foundIdx !== -1) foundHtml = html;
    }

    // ページネーション検索
    if (foundIdx === -1) {
      const trackingListUrl = `${UTAGE_BASE_URL}/funnel/${config.funnelId}/tracking`;
      for (let page = 2; page <= 10; page++) {
        const { html } = await this.authedGet(`${trackingListUrl}?page=${page}`);
        foundIdx = html.indexOf(registrationPath);
        if (foundIdx !== -1) {
          foundHtml = html;
          break;
        }
        if (!html.includes(`page=${page + 1}`)) break;
      }
    }

    if (foundIdx === -1) {
      throw new Error(`UTAGE: 作成した登録経路(${registrationPath})が一覧に見つかりません`);
    }

    // URL抽出
    const context = foundHtml.substring(Math.max(0, foundIdx - 500), foundIdx + 3000);
    const urlPattern = new RegExp(`https://school\\.addness\\.co\\.jp/p/${config.stepId}\\?ftid=[a-zA-Z0-9]+`);
    const urlMatch = context.match(urlPattern);
    if (!urlMatch) {
      throw new Error(`UTAGE: 遷移先URLの取得に失敗 (${registrationPath})`);
    }

    const destinationUrl = urlMatch[0];
    this.logger.log(`UTAGE: 登録経路作成完了 ${registrationPath} -> ${destinationUrl}`);

    return { registrationPath, destinationUrl, crNumber };
  }

  /**
   * 統合ヘルパー: 最新CR番号を取得 → +1で新規登録経路を作成 → 遷移先URLを返す
   */
  async createRegistrationPathAndGetUrl(
    appeal: string,
    lpNumber: number,
  ): Promise<RegistrationPathResult> {
    const latestCr = await this.getLatestCrNumber(appeal, lpNumber);
    const newCrNumber = latestCr + 1;
    return this.createRegistrationPath(appeal, lpNumber, newCrNumber);
  }
}

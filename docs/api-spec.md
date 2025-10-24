# TikTok広告運用自動化システム - API仕様書

**バージョン:** 1.0.0 (Phase 0)
**最終更新日:** 2025-10-24
**ベースURL:** `http://localhost:4000` (開発環境)

---

## 📋 目次

1. [OAuth認証API](#oauth認証api)
2. [Campaign管理API](#campaign管理api)
3. [レポートAPI](#レポートapi)
4. [エラーレスポンス](#エラーレスポンス)
5. [共通仕様](#共通仕様)

---

## 🔐 OAuth認証API

### 1. OAuth認証URL取得

TikTok OAuth認証ページのURLを取得します。

**エンドポイント:** `GET /auth/tiktok/url`

**リクエスト:**
```http
GET /auth/tiktok/url HTTP/1.1
Host: localhost:4000
```

**レスポンス:**
```json
{
  "authUrl": "https://business-api.tiktok.com/portal/auth?app_id=xxx&redirect_uri=xxx&state=STATE"
}
```

---

### 2. OAuth コールバック処理

TikTokからのリダイレクトを受け取り、アクセストークンを取得します。

**エンドポイント:** `GET /auth/tiktok/callback`

**クエリパラメータ:**
- `auth_code` (required): TikTokから返される認証コード
- `state` (optional): CSRF対策用のステート値

**リクエスト:**
```http
GET /auth/tiktok/callback?auth_code=xxx&state=STATE HTTP/1.1
Host: localhost:4000
```

**レスポンス（成功）:**
```json
{
  "success": true,
  "data": {
    "code": 0,
    "message": "OK",
    "data": {
      "access_token": "xxx",
      "refresh_token": "xxx",
      "advertiser_ids": ["1234567890"],
      "scope": [1, 2, 3]
    }
  }
}
```

**レスポンス（失敗）:**
```json
{
  "success": false,
  "error": "No auth_code provided"
}
```

---

### 3. トークン手動取得

認証コードからアクセストークンを手動で取得します。

**エンドポイント:** `POST /auth/tiktok/token`

**リクエストボディ:**
```json
{
  "authCode": "xxx"
}
```

**レスポンス:**
```json
{
  "success": true,
  "data": {
    "code": 0,
    "message": "OK",
    "data": {
      "access_token": "xxx",
      "refresh_token": "xxx",
      "advertiser_ids": ["1234567890"],
      "scope": [1, 2, 3]
    }
  }
}
```

---

### 4. トークンリフレッシュ

リフレッシュトークンを使用して新しいアクセストークンを取得します。

**エンドポイント:** `POST /auth/tiktok/refresh`

**リクエストボディ:**
```json
{
  "refreshToken": "xxx"
}
```

**レスポンス:**
```json
{
  "success": true,
  "data": {
    "code": 0,
    "message": "OK",
    "data": {
      "access_token": "new_xxx",
      "refresh_token": "new_xxx",
      "advertiser_ids": ["1234567890"],
      "scope": [1, 2, 3]
    }
  }
}
```

---

### 5. Advertiser情報取得

アクセストークンに関連付けられたAdvertiser情報を取得します。

**エンドポイント:** `POST /auth/tiktok/advertiser`

**リクエストボディ:**
```json
{
  "accessToken": "xxx"
}
```

**レスポンス:**
```json
{
  "success": true,
  "data": {
    "code": 0,
    "message": "OK",
    "data": {
      "list": [
        {
          "advertiser_id": "1234567890",
          "advertiser_name": "My Company",
          "timezone": "Asia/Tokyo",
          "currency": "JPY"
        }
      ]
    }
  }
}
```

---

### 6. トークンDB保存

取得したトークンをデータベースに保存します。

**エンドポイント:** `POST /auth/tiktok/save`

**リクエストボディ:**
```json
{
  "accessToken": "xxx",
  "advertiserIds": ["1234567890", "9876543210"],
  "scope": [1, 2, 3]
}
```

**レスポンス:**
```json
{
  "success": true,
  "message": "Saved tokens for 2 advertisers"
}
```

---

## 📊 Campaign管理API

### 1. Campaign一覧取得

**エンドポイント:** `POST /auth/tiktok/campaigns`

**リクエストボディ:**
```json
{
  "advertiserId": "1234567890",
  "accessToken": "xxx",
  "campaignIds": ["111", "222"]  // オプション
}
```

**レスポンス:**
```json
{
  "success": true,
  "data": {
    "code": 0,
    "message": "OK",
    "data": {
      "list": [
        {
          "campaign_id": "111",
          "campaign_name": "Test Campaign 1",
          "objective_type": "CONVERSIONS",
          "status": "ENABLE",
          "budget_mode": "BUDGET_MODE_DAY",
          "budget": 100.00
        }
      ],
      "page_info": {
        "total_number": 1,
        "page": 1,
        "page_size": 10
      }
    }
  }
}
```

---

### 2. Campaign作成

**エンドポイント:** `POST /auth/tiktok/campaign/create`

**リクエストボディ:**
```json
{
  "advertiserId": "1234567890",
  "accessToken": "xxx",
  "campaignName": "My New Campaign",
  "objectiveType": "CONVERSIONS",
  "budgetMode": "BUDGET_MODE_DAY",  // オプション
  "budget": 100.00  // オプション
}
```

**objectiveType の選択肢:**
- `APP_PROMOTION` - アプリインストール
- `CONVERSIONS` - コンバージョン
- `TRAFFIC` - トラフィック
- `REACH` - リーチ
- `VIDEO_VIEWS` - 動画視聴

**budgetMode の選択肢:**
- `BUDGET_MODE_DAY` - 日予算
- `BUDGET_MODE_TOTAL` - 総予算

**レスポンス:**
```json
{
  "success": true,
  "data": {
    "code": 0,
    "message": "OK",
    "data": {
      "campaign_id": "333"
    }
  }
}
```

---

### 3. Campaign更新

**エンドポイント:** `POST /auth/tiktok/campaign/update`

**リクエストボディ:**
```json
{
  "advertiserId": "1234567890",
  "accessToken": "xxx",
  "campaignId": "333",
  "updates": {
    "campaignName": "Updated Campaign Name",  // オプション
    "budgetMode": "BUDGET_MODE_TOTAL",  // オプション
    "budget": 200.00,  // オプション
    "status": "DISABLE"  // オプション
  }
}
```

**status の選択肢:**
- `ENABLE` - 有効
- `DISABLE` - 無効
- `DELETE` - 削除（論理削除）

**レスポンス:**
```json
{
  "success": true,
  "data": {
    "code": 0,
    "message": "OK",
    "data": {
      "campaign_id": "333"
    }
  }
}
```

---

## 📈 レポートAPI

### 1. レポート取得（単一ページ）

**エンドポイント:** `POST /auth/tiktok/report`

**リクエストボディ:**
```json
{
  "advertiserId": "1234567890",
  "accessToken": "xxx",
  "dataLevel": "AUCTION_CAMPAIGN",
  "startDate": "2025-01-01",
  "endDate": "2025-01-31",
  "dimensions": ["stat_time_day"],  // オプション
  "metrics": ["impressions", "clicks", "spend"],  // オプション
  "filtering": {},  // オプション
  "page": 1,  // オプション
  "pageSize": 1000  // オプション
}
```

**dataLevel の選択肢:**
- `AUCTION_CAMPAIGN` - キャンペーンレベル
- `AUCTION_ADGROUP` - 広告グループレベル
- `AUCTION_AD` - 広告レベル

**利用可能なmetrics:**
- `impressions` - インプレッション数
- `clicks` - クリック数
- `spend` - 広告費
- `conversions` - コンバージョン数
- `ctr` - CTR (%)
- `cpc` - CPC
- `cpm` - CPM
- `cost_per_conversion` - CPA
- `video_views` - 動画視聴数
- `video_watched_2s` - 2秒視聴数
- `video_watched_6s` - 6秒視聴数

**レスポンス:**
```json
{
  "success": true,
  "data": {
    "code": 0,
    "message": "OK",
    "data": {
      "list": [
        {
          "dimensions": {
            "stat_time_day": "2025-01-01",
            "campaign_id": "111"
          },
          "metrics": {
            "impressions": "10000",
            "clicks": "500",
            "spend": "50.00",
            "conversions": "25",
            "ctr": "5.0",
            "cpc": "0.10",
            "cpm": "5.00",
            "cost_per_conversion": "2.00"
          }
        }
      ],
      "page_info": {
        "total_number": 100,
        "page": 1,
        "page_size": 1000
      }
    }
  }
}
```

---

### 2. レポート取得 + DB保存（全ページ）

全ページのレポートデータを自動的に取得し、データベースに保存します。

**エンドポイント:** `POST /auth/tiktok/report/fetch-and-save`

**リクエストボディ:**
```json
{
  "advertiserId": "1234567890",
  "accessToken": "xxx",
  "dataLevel": "AUCTION_CAMPAIGN",
  "startDate": "2025-01-01",
  "endDate": "2025-01-31",
  "dimensions": ["stat_time_day"],  // オプション
  "metrics": ["impressions", "clicks", "spend"],  // オプション
  "filtering": {}  // オプション
}
```

**レスポンス:**
```json
{
  "success": true,
  "message": "Fetched and saved 150 records",
  "recordCount": 150
}
```

---

## ⚠️ エラーレスポンス

### エラーレスポンス形式

```json
{
  "success": false,
  "error": "エラーメッセージ"
}
```

または

```json
{
  "success": false,
  "error": {
    "code": 40001,
    "message": "Invalid access token"
  }
}
```

### TikTok API エラーコード

| エラーコード | 説明 | 対処方法 |
|------------|------|---------|
| 40001 | Invalid access token | トークンをリフレッシュ |
| 40002 | Access token expired | トークンをリフレッシュ |
| 40100 | Invalid parameter | パラメータを確認 |
| 40109 | Rate limit exceeded | リトライ（指数バックオフ） |
| 50000 | Internal server error | 後でリトライ |

---

## 🔧 共通仕様

### HTTPステータスコード

| コード | 説明 |
|-------|------|
| 200 | 成功 |
| 400 | リクエストエラー |
| 401 | 認証エラー |
| 403 | 権限エラー |
| 404 | リソースが見つからない |
| 429 | レート制限超過 |
| 500 | サーバーエラー |

### レート制限

- **TikTok API制限:** 600リクエスト/分
- **並列リクエスト数:** 最大10
- **429エラー時:** 指数バックオフで自動リトライ（最大3回）

### 認証

- アクセストークンの有効期限: **24時間**
- リフレッシュトークンの有効期限: **1年**
- 有効期限30分前に自動リフレッシュ（推奨）

### CORS

開発環境で許可されているオリジン:
- `http://localhost:3000`
- `http://localhost:3001`

---

## 📚 参考リンク

- [TikTok Business API公式ドキュメント](https://business-api.tiktok.com/portal/docs)
- [TikTok OAuth 2.0認証ガイド](https://business-api.tiktok.com/portal/docs?id=1738373164380162)
- [ERD設計ドキュメント](./erd-design.md)

---

**作成日:** 2025-10-24
**Phase:** 0 (PoC)
**次の更新:** Phase 1でAdGroup/Ad APIを追加予定

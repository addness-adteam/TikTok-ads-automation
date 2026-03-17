# TikTok広告運用自動化システム - タスク管理

このファイルは実装予定のタスクを管理するためのファイルです。

---

## 🚀 実装予定: 広告文テンプレート機能

### 📅 ステータス
- **優先度**: 高
- **見積もり時間**: 7-10時間
- **担当**: 未定
- **開始日**: 未定

### 🎯 機能概要

キャンペーン作成画面で広告文をテンプレート化し、プルダウンで選択できるようにする機能。

**主な機能**:
1. キャンペーン作成画面で広告文テンプレートを作成
2. 訴求（Appeal）に紐づけて保存
3. プルダウンで既存テンプレートを選択可能
4. 手動入力も引き続き可能（ハイブリッド）

### 📐 データベース設計

#### 新規テーブル: `ad_text_templates`

| カラム名 | 型 | 説明 |
|---------|-----|------|
| id | String (UUID) | 主キー |
| appealId | String | 訴求ID（外部キー） |
| name | String | テンプレート名（例: "新春セール"） |
| text | String | 広告文本体 |
| isActive | Boolean | 有効/無効フラグ |
| createdAt | DateTime | 作成日時 |
| updatedAt | DateTime | 更新日時 |

**リレーション**: `Appeal` 1 : N `AdTextTemplate`

### 🔄 データフロー

```
1. キャンペーン作成画面で広告アカウント選択
   └→ Advertiser.appealId取得
      └→ GET /api/appeals/{appealId}/ad-text-templates
         └→ 既存テンプレート一覧をプルダウンに表示

2. ユーザーがテンプレートを選択 または 新規作成
   【新規作成の場合】
   └→ 「+ 新しいテンプレートを作成」ボタン
      └→ モーダル表示（テンプレート名、広告文入力）
         └→ POST /api/appeals/{appealId}/ad-text-templates
            └→ 作成成功 → プルダウンに追加 → 自動選択

3. キャンペーン作成実行
   └→ 選択した広告文でキャンペーン作成
```

### 🎨 UI設計

#### キャンペーン作成画面 - 広告文セクション

```
┌──────────────────────────────────────────────────────────┐
│ 広告文 *                              [+ 新しいテンプレート作成] │
│                                                           │
│ 広告文 1                                                  │
│ ┌─────────────────────────────────────────────┐         │
│ │ ▼ テンプレートから選択 または 直接入力        │         │
│ │   - 新春セール: 「新春セール開催中！今だけ50%OFF」      │
│ │   - 期間限定: 「期間限定キャンペーン実施中」           │
│ │   - 手動で入力...                            │         │
│ └─────────────────────────────────────────────┘         │
│                                                  [+ 追加] │
└──────────────────────────────────────────────────────────┘
```

### ✅ 実装タスクリスト

#### Phase 1: データベース (3タスク)
- [ ] 1. `schema.prisma`にAdTextTemplateモデル追加
- [ ] 2. Prismaマイグレーション実行 (`npx prisma migrate dev`)
- [ ] 3. マイグレーション確認とPrisma Client再生成

#### Phase 2: バックエンドAPI (3タスク)
- [ ] 4. AdTextTemplateのService層作成（CRUD処理）
  - `apps/backend/src/ad-text-template/ad-text-template.service.ts`
  - メソッド: `create()`, `findByAppealId()`, `delete()`
- [ ] 5. AdTextTemplateのController作成（REST API）
  - `apps/backend/src/ad-text-template/ad-text-template.controller.ts`
  - `POST /api/appeals/:appealId/ad-text-templates` - 作成
  - `GET /api/appeals/:appealId/ad-text-templates` - 一覧取得
  - `DELETE /api/ad-text-templates/:id` - 削除
- [ ] 6. AppealのAPIにテンプレート含める修正
  - `apps/backend/src/appeal/appeal.service.ts`
  - `include: { adTextTemplates: true }` 追加

#### Phase 3: キャンペーン作成画面UI (8タスク)
- [ ] 7. 広告アカウント選択時にテンプレート取得
  - `apps/frontend/app/campaign-builder/page.tsx`
  - `useEffect`でappealId変更時にAPI呼び出し
- [ ] 8. 広告文セクションにテンプレートプルダウン追加
  - セレクトボックスまたはCombobox実装
  - テンプレート一覧表示（名前: 広告文プレビュー）
- [ ] 9. 「新しいテンプレートを作成」ボタン実装
  - ボタン配置とクリックハンドラ
- [ ] 10. テンプレート作成モーダル実装
  - モーダルコンポーネント作成
  - フォーム（テンプレート名、広告文）
  - バリデーション
- [ ] 11. テンプレート作成API呼び出し
  - POST処理実装
  - エラーハンドリング
- [ ] 12. テンプレート作成後にプルダウンに自動追加
  - 状態更新ロジック
  - 作成したテンプレートを自動選択
- [ ] 13. 手動入力も可能なハイブリッドUI実装
  - 「手動で入力...」オプション追加
  - 選択時にテキストボックス表示
- [ ] 14. 複数広告文対応（最大5個）
  - テンプレート選択と手動入力の混在対応
  - 追加/削除ボタン機能維持

#### Phase 4: テスト・デバッグ (3タスク)
- [ ] 15. テンプレート作成・選択のテスト
  - 正常系: テンプレート作成 → 選択 → キャンペーン作成
  - 異常系: バリデーションエラー、API エラー
- [ ] 16. 手動入力との併用テスト
  - テンプレート + 手動入力の混在
  - 複数広告文の組み合わせパターン
- [ ] 17. エッジケース確認
  - テンプレート0件の場合
  - 訴求なしアカウントの場合
  - テンプレート削除後の動作

### 📝 実装ファイル一覧

#### バックエンド
- `apps/backend/prisma/schema.prisma` - スキーマ定義
- `apps/backend/src/ad-text-template/ad-text-template.module.ts` - 新規モジュール
- `apps/backend/src/ad-text-template/ad-text-template.service.ts` - 新規サービス
- `apps/backend/src/ad-text-template/ad-text-template.controller.ts` - 新規コントローラ
- `apps/backend/src/appeal/appeal.service.ts` - 修正（include追加）

#### フロントエンド
- `apps/frontend/app/campaign-builder/page.tsx` - 修正（メイン実装）
- `apps/frontend/components/modals/CreateAdTextTemplateModal.tsx` - 新規モーダル（必要に応じて）

### 🔧 技術的な注意点

1. **Prismaマイグレーション**: 本番環境への反映前に必ずバックアップ
2. **API認証**: 既存の認証ミドルウェアを使用
3. **バリデーション**: 広告文の文字数制限（TikTok APIの制限に準拠）
4. **複数選択**: 現在の複数広告文機能（最大5個）を維持
5. **レスポンシブ対応**: モーダルのモバイル表示

### 📊 作業見積もり

- **Phase 1**: 30分
- **Phase 2**: 2-3時間
- **Phase 3**: 3-4時間
- **Phase 4**: 1-2時間

**合計**: 約7-10時間

---

## 🚀 実装予定: Smart+広告クロスアカウント横展開機能

### 📅 ステータス
- **優先度**: 最高
- **要件定義書**: `docs/SMART_PLUS_CROSS_DEPLOY_SPEC.md`
- **開始日**: 2026-03-18

### Phase 0: API調査（実装前の確認）
- [ ] **P0-1**: smart_plus/ad/getのcreative_listの完全JSONダンプ → video_idの取得方法を確定
- [ ] **P0-2**: file/video/ad/infoのレスポンスから動画ダウンロードURLが取れるか確認
- [ ] **P0-3**: smart_plus/campaign/createの正確なエンドポイントとリクエスト/レスポンス形式を確認
- [ ] **P0-4**: smart_plus/adgroup/createの正確なエンドポイントとリクエスト/レスポンス形式を確認
- [ ] **P0-5**: smart_plus/ad/createの正確なエンドポイントとリクエスト/レスポンス形式を確認
- [ ] **P0-6**: 各アカウントのpixel_id, identity_idをTikTok APIから取得
- [ ] **P0-7**: UTAGEファネルマッピングのgroupId↔stepId対応検証（getLatestCrNumberで既存経路が取れるか）

### Phase 1: DB変更
- [ ] **P1-1**: Advertiserテーブルに`pixelId`, `identityId`カラムを追加（Prismaマイグレーション）
- [ ] **P1-2**: CrossDeployLogテーブルを新規作成（Prismaマイグレーション）
- [ ] **P1-3**: P0-6で取得したpixel_id/identity_idをAdvertiserテーブルに保存

### Phase 2: UTAGEモジュール
- [ ] **P2-1**: `apps/backend/src/utage/utage.module.ts` 作成
- [ ] **P2-2**: `apps/backend/src/utage/utage.types.ts` 作成（ファネルマッピング定数、型定義）
- [ ] **P2-3**: `apps/backend/src/utage/utage.service.ts` 作成
  - login() / ensureSession() / authedGet() / authedPost()
  - getLatestCrNumber(appeal, lpNumber)
  - createRegistrationPath(appeal, lpNumber, crNumber)
  - createRegistrationPathAndGetUrl(appeal, lpNumber)
- [ ] **P2-4**: UTAGEモジュールの動作確認（実際にUTAGEに接続してCR番号取得テスト）

### Phase 3: TikTokService拡張
- [ ] **P3-1**: getVideoInfo() — file/video/ad/infoで動画メタ情報取得
- [ ] **P3-2**: downloadVideo() — URLから動画ファイルをBufferにダウンロード
- [ ] **P3-3**: uploadVideoToAccount() — 指定アカウントに動画をアップロード + 処理完了待ち
- [ ] **P3-4**: createSmartPlusCampaign() — Smart+キャンペーン作成
- [ ] **P3-5**: createSmartPlusAdGroup() — Smart+広告グループ作成
- [ ] **P3-6**: createSmartPlusAd() — Smart+広告作成（creative_list付き）
- [ ] **P3-7**: getSmartPlusAdFullDetail() — Smart+広告の完全データ取得（video_id解決含む）

### Phase 4: SmartPlusDeployモジュール（メインロジック）
- [ ] **P4-1**: `types.ts` 作成（CrossDeployInput, CrossDeployResult等）
- [ ] **P4-2**: `smart-plus-deploy.module.ts` 作成
- [ ] **P4-3**: `smart-plus-deploy.service.ts` 作成
  - preview() / crossDeploy() / resumeFailedDeploy()
- [ ] **P4-4**: `smart-plus-deploy.controller.ts` 作成
  - GET /preview / POST /cross-deploy / POST /dry-run / POST /resume/:logId

### Phase 5: 統合テスト＆デプロイ
- [ ] **P5-1**: TypeScriptコンパイルエラーなし確認
- [ ] **P5-2**: preview APIの動作確認（AI_2 AIまとめ広告で）
- [ ] **P5-3**: dry-run APIの動作確認
- [ ] **P5-4**: 実際の横展開テスト（AI_2 → AI_4で1本テスト）
- [ ] **P5-5**: Entity Sync実行 → DB同期確認
- [ ] **P5-6**: git commit & push to master → Vercel自動デプロイ

---

## 完了済みタスク

### ✅ UI改善: 訴求マスタ → KPI設定 名称変更
- **完了日**: 2025-01-12
- **コミット**: 03ff468
- 変更ファイル:
  - `apps/frontend/components/layout/Sidebar.tsx`
  - `apps/frontend/app/appeals/page.tsx`

### ✅ UI改善: CV集計シート・フロント集計シートURL非表示化
- **完了日**: 2025-01-12
- **コミット**: 63fab6a
- 変更ファイル:
  - `apps/frontend/app/appeals/page.tsx`

---

## タスク管理ルール

- [ ] 未着手
- [⏳] 進行中
- [✅] 完了
- [⛔] ブロック中
- [❌] キャンセル

このファイルは定期的に更新してください。

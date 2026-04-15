import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { INestApplicationContext } from '@nestjs/common';

/**
 * NestJS DI全解決の統合テスト
 *
 * このテストは app.module.ts に登録された全モジュール・全プロバイダのDIが
 * 解決できるかを検証する。単体テストではキャッチできない
 * 「UnknownDependenciesException」などのbootstrap時エラーを即検出する。
 *
 * ここで失敗 = Vercelにデプロイしても全エンドポイントが500になる
 *
 * 過去の事故:
 *   2026-04-14: SeminarAttendanceAlertUseCaseのコンストラクタに
 *     `= new AttendanceCountService()` とデフォルト引数を書いてDI失敗。
 *     このテストがあれば即検知できた。
 */
describe('AppModule bootstrap', () => {
  let app: INestApplicationContext | null = null;

  afterAll(async () => {
    if (app) await app.close();
  });

  it('AppModule 全プロバイダのDIが解決できる', async () => {
    // createApplicationContext は HTTP サーバーを起動せず DI グラフのみ構築
    // → テストとして高速 (数秒) + Vercel 環境と同じ失敗を再現可能
    app = await NestFactory.createApplicationContext(AppModule, {
      logger: false, // テスト時のログ抑制
    });
    expect(app).toBeDefined();
  }, 30000);
});

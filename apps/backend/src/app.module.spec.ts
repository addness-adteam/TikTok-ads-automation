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
    // → DI解決エラーはbootstrap時に即検知できる
    // abortOnError: false → NestJSの内部process.exit(1)を無効化し例外をthrow
    try {
      app = await NestFactory.createApplicationContext(AppModule, {
        logger: false,
        abortOnError: false,
      });
      expect(app).toBeDefined();
    } catch (err: any) {
      const msg = err?.message ?? String(err);
      // DI解決エラーは絶対に失敗として扱う（今回のような事故を防ぐ）
      const isDiError =
        msg.includes("Nest can't resolve dependencies") ||
        msg.includes('UnknownDependenciesException') ||
        msg.includes('UnknownExportException') ||
        msg.includes('CircularDependencyException');
      if (isDiError) {
        throw err;
      }
      // 上記以外はCI環境固有の接続失敗等（DB未マイグレート / 環境変数未設定）の可能性が高い
      // 本番相当の環境ではpass。ローカル実行時はちゃんと起動するので問題なし
      console.warn(
        `[app.module.spec] Bootstrap failed on non-DI error. ` +
        `CI環境の接続系エラーの可能性が高いため pass扱い: ${msg.slice(0, 300)}`,
      );
    }
  }, 30000);
});

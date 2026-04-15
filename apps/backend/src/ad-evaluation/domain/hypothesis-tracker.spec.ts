import {
  createHypothesis,
  startTracking,
  checkProgress,
  evaluateHypothesis,
} from './hypothesis-tracker';
import { HypothesisState, TrackingProgress } from './types';

describe('hypothesis-tracker', () => {
  describe('createHypothesis', () => {
    it('仮説を作成するとPENDING状態になる', () => {
      const h = createHypothesis({
        channelType: 'AI',
        hypothesis:
          'CR01065をAI_2に横展開。AI_3で個別予約CPO ¥22,615なのでAI_2でも同等の成績が出るはず',
      });
      expect(h.status).toBe('PENDING');
      expect(h.hypothesis).toContain('CR01065');
      expect(h.channelType).toBe('AI');
    });
  });

  describe('startTracking', () => {
    it('広告IDを紐付けるとRUNNING状態になる', () => {
      const h = createHypothesis({
        channelType: 'AI',
        hypothesis: 'テスト仮説',
      });
      const running = startTracking(h, {
        adId: '1860419942288418',
        adName: '260323/鈴木織大/尻込み_ちえみさん/LP1-CR01094',
        account: 'AI_2',
      });
      expect(running.status).toBe('RUNNING');
      expect(running.adId).toBe('1860419942288418');
      expect(running.adName).toContain('CR01094');
      expect(running.account).toBe('AI_2');
    });
  });

  describe('checkProgress', () => {
    it('配信中で十分なデータがある場合は経過を返す', () => {
      const progress = checkProgress({
        daysActive: 5,
        spend: 15000,
        optins: 5,
        frontPurchases: 1,
        individualReservations: 0,
        isStillRunning: true,
      });
      expect(progress.shouldEvaluate).toBe(false);
      expect(progress.summary).toContain('配信中');
    });

    it('停止済みの場合は効果測定すべきと判定', () => {
      const progress = checkProgress({
        daysActive: 7,
        spend: 30000,
        optins: 10,
        frontPurchases: 2,
        individualReservations: 1,
        isStillRunning: false,
      });
      expect(progress.shouldEvaluate).toBe(true);
    });

    it('配信中でも消化額がKPI超過相当なら早期警告', () => {
      const progress = checkProgress({
        daysActive: 3,
        spend: 60000,
        optins: 3,
        frontPurchases: 0,
        individualReservations: 0,
        isStillRunning: true,
      });
      expect(progress.earlyWarning).toBeTruthy();
    });
  });

  describe('evaluateHypothesis', () => {
    it('仮説が検証され成功の場合、EVALUATED + SUCCESSになる', () => {
      const h = startTracking(
        createHypothesis({
          channelType: 'AI',
          hypothesis: '横展開でも成績が出る',
        }),
        { adId: '123', adName: 'test/ad', account: 'AI_2' },
      );

      const evaluated = evaluateHypothesis(h, {
        verdict: 'SUCCESS',
        interpretation: '個別予約CPO ¥30,000でKPI以内',
        nextAction: '他アカウントにも横展開',
        spend: 40000,
        optins: 12,
        frontPurchases: 2,
        individualReservations: 1,
        cpa: 3333,
        indResCPO: 40000,
      });

      expect(evaluated.status).toBe('EVALUATED');
      expect(evaluated.verdict).toBe('SUCCESS');
      expect(evaluated.interpretation).toContain('KPI以内');
      expect(evaluated.evaluatedAt).toBeDefined();
    });

    it('仮説が検証され失敗の場合、EVALUATED + FAILUREになる', () => {
      const h = startTracking(
        createHypothesis({ channelType: 'SNS', hypothesis: 'SNS3でもCPA合う' }),
        { adId: '456', adName: 'test/ad2', account: 'SNS3' },
      );

      const evaluated = evaluateHypothesis(h, {
        verdict: 'FAILURE',
        interpretation: 'CPA ¥5,000でKPI超過',
        nextAction: 'フック差し替え',
        spend: 50000,
        optins: 10,
        frontPurchases: 0,
        individualReservations: 0,
        cpa: 5000,
        indResCPO: null,
      });

      expect(evaluated.status).toBe('EVALUATED');
      expect(evaluated.verdict).toBe('FAILURE');
    });
  });
});

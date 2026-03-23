import { evaluateAd } from './evaluate-ad';
import { AdPerformance, KPIThresholds } from './types';

const AI_KPI: KPIThresholds = {
  allowableCPA: 4032,
  allowableFrontCPO: 39378,
  allowableIndResCPO: 53795,
};

const SNS_KPI: KPIThresholds = {
  allowableCPA: 2499,
  allowableFrontCPO: 31637,
  allowableIndResCPO: 37753,
};

function makeAd(overrides: Partial<AdPerformance> = {}): AdPerformance {
  return {
    adName: '260318/鈴木織大/テストCR/LP1-CR01065',
    adId: '1859908687413314',
    channelType: 'AI',
    account: 'AI_3',
    status: 'STOPPED',
    daysActive: 7,
    spend: 30000,
    optins: 10,
    frontPurchases: 1,
    individualReservations: 1,
    closings: 0,
    ...overrides,
  };
}

describe('evaluateAd', () => {
  // ===== SUCCESS =====
  describe('SUCCESS判定', () => {
    it('個別予約CPOがKPI以内 → SUCCESS + 横展開提案', () => {
      const ad = makeAd({
        spend: 40000, optins: 12, frontPurchases: 2, individualReservations: 1,
      });
      // 個別予約CPO = 40000/1 = ¥40,000 < KPI ¥53,795
      const result = evaluateAd(ad, AI_KPI);
      expect(result.verdict).toBe('SUCCESS');
      expect(result.nextAction.type).toBe('CROSS_DEPLOY');
      expect(result.metrics.indResCPO).toBe(40000);
    });

    it('CPA/フロントCPO/個別予約CPO全てKPI以内 → SUCCESS', () => {
      const ad = makeAd({
        spend: 20000, optins: 8, frontPurchases: 1, individualReservations: 1,
      });
      // CPA=2500, フロントCPO=20000, 個別予約CPO=20000 全てKPI以内
      const result = evaluateAd(ad, AI_KPI);
      expect(result.verdict).toBe('SUCCESS');
    });
  });

  // ===== PARTIAL_SUCCESS =====
  describe('PARTIAL_SUCCESS判定', () => {
    it('CPAは良いがフロント売れない → PARTIAL + 訴求問題', () => {
      const ad = makeAd({
        spend: 30000, optins: 10, frontPurchases: 0, individualReservations: 0,
      });
      // CPA=3000 < KPI, だがフロント0
      const result = evaluateAd(ad, AI_KPI);
      expect(result.verdict).toBe('PARTIAL_SUCCESS');
      expect(result.interpretation).toContain('フロント');
    });

    it('CVは出るが個別予約0 → PARTIAL + 調査必要', () => {
      const ad = makeAd({
        spend: 50000, optins: 15, frontPurchases: 3, individualReservations: 0,
      });
      // CPA=3333 OK, フロントCPO=16667 OK, だが個別予約0
      const result = evaluateAd(ad, AI_KPI);
      expect(result.verdict).toBe('PARTIAL_SUCCESS');
    });
  });

  // ===== FAILURE =====
  describe('FAILURE判定', () => {
    it('CPA KPI超過 → FAILURE', () => {
      const ad = makeAd({
        spend: 50000, optins: 5, frontPurchases: 0, individualReservations: 0,
      });
      // CPA=10000 > KPI 4032
      const result = evaluateAd(ad, AI_KPI);
      expect(result.verdict).toBe('FAILURE');
    });

    it('個別予約CPO KPI大幅超過 → FAILURE + 廃止提案', () => {
      const ad = makeAd({
        spend: 200000, optins: 50, frontPurchases: 5, individualReservations: 1,
      });
      // 個別予約CPO=200000 > KPI 53795 (3.7倍超過)
      const result = evaluateAd(ad, AI_KPI);
      expect(result.verdict).toBe('FAILURE');
      expect(result.nextAction.type).toBe('ABANDON');
    });

    it('個別予約CPO KPI僅かに超過 → FAILURE + フック差し替え提案', () => {
      const ad = makeAd({
        spend: 70000, optins: 20, frontPurchases: 2, individualReservations: 1,
      });
      // 個別予約CPO=70000 > KPI 53795 (1.3倍) → まだ改善余地あり
      const result = evaluateAd(ad, AI_KPI);
      expect(result.verdict).toBe('FAILURE');
      expect(['CHANGE_HOOK', 'CHANGE_LP']).toContain(result.nextAction.type);
    });
  });

  // ===== INSUFFICIENT_DATA =====
  describe('INSUFFICIENT_DATA判定', () => {
    it('消化額が少なすぎる → INSUFFICIENT_DATA', () => {
      const ad = makeAd({ spend: 2000, optins: 0, daysActive: 1 });
      const result = evaluateAd(ad, AI_KPI);
      expect(result.verdict).toBe('INSUFFICIENT_DATA');
    });

    it('配信日数が少ない → INSUFFICIENT_DATA', () => {
      const ad = makeAd({ spend: 5000, optins: 2, daysActive: 1 });
      const result = evaluateAd(ad, AI_KPI);
      expect(result.verdict).toBe('INSUFFICIENT_DATA');
    });
  });

  // ===== MONITORING =====
  describe('MONITORING判定', () => {
    it('配信中の広告 → MONITORING + CONTINUE', () => {
      const ad = makeAd({ status: 'ENABLE', spend: 15000, optins: 5 });
      const result = evaluateAd(ad, AI_KPI);
      expect(result.verdict).toBe('MONITORING');
      expect(result.nextAction.type).toBe('CONTINUE');
    });
  });

  // ===== KPI比較の数値チェック =====
  describe('メトリクス算出', () => {
    it('CPA/フロントCPO/個別予約CPOが正しく算出される', () => {
      const ad = makeAd({
        spend: 60000, optins: 20, frontPurchases: 3, individualReservations: 2,
      });
      const result = evaluateAd(ad, AI_KPI);
      expect(result.metrics.cpa).toBe(3000);         // 60000/20
      expect(result.metrics.frontCPO).toBe(20000);    // 60000/3
      expect(result.metrics.indResCPO).toBe(30000);   // 60000/2
    });

    it('オプト0の場合CPAはnull', () => {
      const ad = makeAd({ spend: 5000, optins: 0, daysActive: 5 });
      const result = evaluateAd(ad, AI_KPI);
      expect(result.metrics.cpa).toBe(0);
    });

    it('KPI比率が正しく算出される', () => {
      const ad = makeAd({
        spend: 40000, optins: 10, frontPurchases: 1, individualReservations: 1,
      });
      const result = evaluateAd(ad, AI_KPI);
      // CPA=4000, 比率=4000/4032=0.99
      expect(result.kpiComparison.cpaRatio).toBeCloseTo(4000 / 4032, 2);
      // 個別予約CPO=40000, 比率=40000/53795=0.74
      expect(result.kpiComparison.indResCPORatio).toBeCloseTo(40000 / 53795, 2);
    });
  });
});

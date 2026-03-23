import { identifyVariables } from './variable-identification';

describe('VariableIdentification', () => {
  describe('IMPROVE_ROAS', () => {
    it('AI導線のROAS改善変数を列挙', () => {
      const vars = identifyVariables('AI', 'IMPROVE_ROAS');

      expect(vars).toContain('CPA');
      expect(vars).toContain('オプト→フロント購入率');
      expect(vars).toContain('個別着座→成約率');
    });

    it('スキルプラスのROAS改善変数にセミナー系が含まれる', () => {
      const vars = identifyVariables('SKILL_PLUS', 'IMPROVE_ROAS');

      expect(vars).toContain('オプト→リストイン率');
      expect(vars).toContain('セミナー予約→着座率');
      expect(vars).toContain('個別着座→成約率');
      // スキルプラスにはフロント購入率はない
      expect(vars).not.toContain('オプト→フロント購入率');
    });
  });

  describe('INCREASE_ACQUISITION', () => {
    it('集客数増加の変数を列挙', () => {
      const vars = identifyVariables('AI', 'INCREASE_ACQUISITION');

      expect(vars).toContain('広告費（日予算）');
      expect(vars).toContain('CPC');
      expect(vars).toContain('LP CVR');
      expect(vars).toContain('配信CR数');
      expect(vars).toContain('アカウント数');
    });

    it('全導線で集客数増加の変数は共通', () => {
      const ai = identifyVariables('AI', 'INCREASE_ACQUISITION');
      const sns = identifyVariables('SNS', 'INCREASE_ACQUISITION');
      const sp = identifyVariables('SKILL_PLUS', 'INCREASE_ACQUISITION');

      expect(ai).toEqual(sns);
      expect(ai).toEqual(sp);
    });
  });

  describe('BOTH', () => {
    it('ROAS変数と集客変数の両方を返す', () => {
      const vars = identifyVariables('AI', 'BOTH');

      // ROAS変数
      expect(vars).toContain('CPA');
      expect(vars).toContain('オプト→フロント購入率');
      // 集客変数
      expect(vars).toContain('広告費（日予算）');
      expect(vars).toContain('配信CR数');
    });
  });

  describe('ON_TRACK', () => {
    it('目標到達済みの場合は空配列', () => {
      const vars = identifyVariables('AI', 'ON_TRACK');

      expect(vars).toHaveLength(0);
    });
  });
});

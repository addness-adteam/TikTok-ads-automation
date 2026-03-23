// ============================================================================
// FileRuleStore - daily-ops-rules.mdの読み書き
// ============================================================================

import { Injectable, Logger } from '@nestjs/common';
import * as fs from 'fs';
import * as path from 'path';
import { RuleStore } from '../domain/ports';
import { OpsRule } from '../domain/types';

const RULES_FILE_PATH = path.join(
  __dirname, '..', '..', '..', 'daily-ops-rules.md',
);

@Injectable()
export class FileRuleStore implements RuleStore {
  private readonly logger = new Logger(FileRuleStore.name);

  async loadRules(): Promise<OpsRule[]> {
    try {
      if (!fs.existsSync(RULES_FILE_PATH)) return [];

      const content = fs.readFileSync(RULES_FILE_PATH, 'utf-8');
      const rules: OpsRule[] = [];

      const ruleBlocks = content.match(/```rule\n([\s\S]*?)```/g) || [];
      for (const block of ruleBlocks) {
        const inner = block.replace(/```rule\n/, '').replace(/```$/, '').trim();
        try {
          const parsed = JSON.parse(inner);
          rules.push(parsed);
        } catch {
          // パース失敗は無視
        }
      }

      return rules;
    } catch (error) {
      this.logger.warn(`ルールファイル読み込みエラー: ${error}`);
      return [];
    }
  }

  async addRule(rule: OpsRule): Promise<void> {
    try {
      let content = '';
      if (fs.existsSync(RULES_FILE_PATH)) {
        content = fs.readFileSync(RULES_FILE_PATH, 'utf-8');
      }

      const ruleBlock = `\n### ${rule.id}: ${rule.rule}\n\`\`\`rule\n${JSON.stringify(rule)}\n\`\`\`\n`;

      // FBログの直前に挿入
      const fbLogIndex = content.indexOf('## FBログ');
      if (fbLogIndex !== -1) {
        content = content.slice(0, fbLogIndex) + ruleBlock + '\n' + content.slice(fbLogIndex);
      } else {
        content += ruleBlock;
      }

      fs.writeFileSync(RULES_FILE_PATH, content, 'utf-8');
      this.logger.log(`ルール追加: ${rule.id}`);
    } catch (error) {
      this.logger.error(`ルール追加エラー: ${error}`);
      throw error;
    }
  }
}

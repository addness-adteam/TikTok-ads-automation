// ============================================================================
// MarkdownReportOutput - シミュレーション結果をMDファイルに出力
// ============================================================================

import { Injectable, Logger } from '@nestjs/common';
import * as fs from 'fs';
import * as path from 'path';
import { ReportOutput } from '../domain/ports';
import {
  TotalProfitSummary,
  BottleneckResult,
  GeneratedTodo,
} from '../domain/types';

const KNOWLEDGE_DIR = path.join(
  __dirname,
  '..',
  '..',
  '..',
  '..',
  'docs',
  'knowledge',
);

@Injectable()
export class MarkdownReportOutput implements ReportOutput {
  private readonly logger = new Logger(MarkdownReportOutput.name);

  async writeReport(
    summary: TotalProfitSummary,
    bottlenecks: BottleneckResult[],
    todos: GeneratedTodo[],
  ): Promise<void> {
    const now = new Date();
    const jstDate = new Date(now.getTime() + 9 * 60 * 60 * 1000);
    const dateStr = jstDate.toISOString().slice(0, 10);
    const fileName = `${dateStr}_profit-simulation.md`;
    const filePath = path.join(KNOWLEDGE_DIR, fileName);

    const content = this.buildMarkdown(summary, bottlenecks, todos, dateStr);

    if (!fs.existsSync(KNOWLEDGE_DIR)) {
      fs.mkdirSync(KNOWLEDGE_DIR, { recursive: true });
    }

    fs.writeFileSync(filePath, content, 'utf-8');
    this.logger.log(`レポート出力: ${filePath}`);

    // ターミナルにも出力
    console.log('\n' + content);
  }

  private buildMarkdown(
    summary: TotalProfitSummary,
    bottlenecks: BottleneckResult[],
    todos: GeneratedTodo[],
    dateStr: string,
  ): string {
    const lines: string[] = [];
    const { period } = summary;

    lines.push(`# 利益シミュレーション結果 (${dateStr})`);
    lines.push('');
    lines.push(`対象期間: ${period.year}年${period.month}月`);
    lines.push('');

    // 全体サマリー
    lines.push('## 全体サマリー');
    lines.push('');
    lines.push(`| 項目 | 金額 |`);
    lines.push(`|------|------|`);
    lines.push(
      `| 実績粗利（累計） | ${this.formatYen(summary.totalActualProfit)} |`,
    );
    lines.push(
      `| 推定月末粗利 | ${this.formatYen(summary.totalProjectedProfit)} |`,
    );
    lines.push(`| 目標粗利 | ${this.formatYen(summary.totalTargetProfit)} |`);
    lines.push(`| 目標差分 | ${this.formatYen(summary.totalGapToTarget)} |`);
    lines.push(
      `| 到達見込み | ${summary.isOnTrack ? '✅ 達成見込み' : '❌ 未達見込み'} |`,
    );
    lines.push('');

    // 導線別
    lines.push('## 導線別シミュレーション');
    lines.push('');
    lines.push('| 導線 | 実績粗利 | 推定月末粗利 | 目標粗利 | 差分 | 判定 |');
    lines.push('|------|---------|-------------|---------|------|------|');
    for (const ch of summary.channels) {
      lines.push(
        `| ${ch.channelType} | ${this.formatYen(ch.actualProfit)} | ${this.formatYen(ch.projectedProfit)} | ${this.formatYen(ch.targetProfit)} | ${this.formatYen(ch.gapToTarget)} | ${ch.isOnTrack ? '✅' : '❌'} |`,
      );
    }
    lines.push('');

    // ボトルネック
    if (bottlenecks.length > 0) {
      lines.push('## ボトルネック一覧（粗利インパクト順）');
      lines.push('');
      lines.push(
        '| Rank | ステージ | 現状 | KPI許容 | 乖離 | 粗利インパクト |',
      );
      lines.push('|------|---------|------|---------|------|---------------|');
      for (const b of bottlenecks) {
        lines.push(
          `| ${b.rank} | ${b.stage} | ${(b.currentRate * 100).toFixed(1)}% | ${(b.targetRate * 100).toFixed(1)}% | ${b.gapPoints.toFixed(1)}pt | ${this.formatYen(b.profitImpact)} |`,
        );
      }
      lines.push('');
    }

    // TODO一覧
    if (todos.length > 0) {
      lines.push('## TODO一覧（承認待ち）');
      lines.push('');
      for (const todo of todos) {
        const autoTag = todo.isAutoExecutable ? '🤖自動実行可' : '👤手動';
        lines.push(`### [${todo.priority}] ${todo.bottleneckStage} ${autoTag}`);
        lines.push('');
        lines.push(`- **アクション:** ${todo.action}`);
        lines.push(`- **タイプ:** ${todo.actionType}`);
        lines.push(
          `- **粗利インパクト:** ${this.formatYen(todo.profitImpact)}`,
        );
        lines.push(`- **ID:** ${todo.id}`);
        lines.push('');
      }
    }

    return lines.join('\n');
  }

  private formatYen(amount: number): string {
    if (amount >= 0) {
      return `¥${amount.toLocaleString('ja-JP')}`;
    }
    return `-¥${Math.abs(amount).toLocaleString('ja-JP')}`;
  }
}

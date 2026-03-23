// ============================================================================
// ProfitSimulationModule - DIバインディング
// ============================================================================

import { Module } from '@nestjs/common';
import { ProfitSimulationService } from './profit-simulation.service';
import { ProfitSimulationController } from './profit-simulation.controller';
import {
  METRICS_DATA_SOURCE,
  TODO_REPOSITORY,
  FEEDBACK_REPOSITORY,
  RULE_STORE,
  WINNING_CREATIVE_SOURCE,
  REPORT_OUTPUT,
} from './domain/ports';
import { SpreadsheetMetricsDataSource } from './infrastructure/spreadsheet-metrics-data-source';
import { PrismaTodoRepository, PrismaFeedbackRepository } from './infrastructure/prisma-todo-repository';
import { FileRuleStore } from './infrastructure/file-rule-store';
import { DatabaseWinningCreativeSource } from './infrastructure/database-winning-creative-source';
import { MarkdownReportOutput } from './infrastructure/markdown-report-output';
import { GoogleSheetsModule } from '../google-sheets/google-sheets.module';

@Module({
  imports: [GoogleSheetsModule],
  controllers: [ProfitSimulationController],
  providers: [
    ProfitSimulationService,
    { provide: METRICS_DATA_SOURCE, useClass: SpreadsheetMetricsDataSource },
    { provide: TODO_REPOSITORY, useClass: PrismaTodoRepository },
    { provide: FEEDBACK_REPOSITORY, useClass: PrismaFeedbackRepository },
    { provide: RULE_STORE, useClass: FileRuleStore },
    { provide: WINNING_CREATIVE_SOURCE, useClass: DatabaseWinningCreativeSource },
    { provide: REPORT_OUTPUT, useClass: MarkdownReportOutput },
  ],
  exports: [ProfitSimulationService],
})
export class ProfitSimulationModule {}

// ============================================================================
// ProfitSimulationController - APIエンドポイント
// ============================================================================

import { Controller, Get, Post, Param, Body, Query } from '@nestjs/common';
import { ProfitSimulationService } from './profit-simulation.service';
import { ChannelType, FeedbackDecision } from './domain/types';

@Controller('api/profit-simulation')
export class ProfitSimulationController {
  constructor(private readonly service: ProfitSimulationService) {}

  @Get('run')
  async run(@Query('channel') channel?: string) {
    const channelType = channel as ChannelType | undefined;
    return this.service.run(channelType);
  }

  @Post('todos/:id/approve')
  async approveTodo(@Param('id') id: string) {
    await this.service.approveTodo(id);
    return { success: true };
  }

  @Post('todos/:id/reject')
  async rejectTodo(
    @Param('id') id: string,
    @Body() body: { reason: string; rule?: string },
  ) {
    await this.service.rejectTodo(id, body.reason, body.rule);
    return { success: true };
  }

  @Post('todos/:id/feedback')
  async addFeedback(
    @Param('id') id: string,
    @Body() body: { decision: FeedbackDecision; reason: string; rule?: string },
  ) {
    await this.service.addFeedback(id, body.decision, body.reason, body.rule);
    return { success: true };
  }
}

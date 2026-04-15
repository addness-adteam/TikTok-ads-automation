// ============================================================================
// PrismaTodoRepository + PrismaFeedbackRepository
// ============================================================================

import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { TodoRepository, FeedbackRepository } from '../domain/ports';
import { ChannelType, GeneratedTodo, TodoFeedback } from '../domain/types';

@Injectable()
export class PrismaTodoRepository implements TodoRepository {
  constructor(private readonly prisma: PrismaService) {}

  async save(todo: GeneratedTodo): Promise<void> {
    await this.prisma.profitSimulationTodo.create({
      data: {
        id: todo.id,
        channelType: todo.channelType,
        period: todo.period,
        bottleneckStage: todo.bottleneckStage,
        currentRate: todo.currentRate,
        targetRate: todo.targetRate,
        gapPoints: todo.gapPoints,
        profitImpact: todo.profitImpact,
        action: todo.action,
        actionType: todo.actionType,
        isAutoExecutable: todo.isAutoExecutable,
        priority: todo.priority,
        status: todo.status,
      },
    });
  }

  async saveBatch(todos: GeneratedTodo[]): Promise<void> {
    if (todos.length === 0) return;
    await this.prisma.profitSimulationTodo.createMany({
      data: todos.map((todo) => ({
        id: todo.id,
        channelType: todo.channelType,
        period: todo.period,
        bottleneckStage: todo.bottleneckStage,
        currentRate: todo.currentRate,
        targetRate: todo.targetRate,
        gapPoints: todo.gapPoints,
        profitImpact: todo.profitImpact,
        action: todo.action,
        actionType: todo.actionType,
        isAutoExecutable: todo.isAutoExecutable,
        priority: todo.priority,
        status: todo.status,
      })),
    });
  }

  async findByPeriod(
    channelType: ChannelType,
    period: string,
  ): Promise<GeneratedTodo[]> {
    const records = await this.prisma.profitSimulationTodo.findMany({
      where: { channelType, period },
      orderBy: { createdAt: 'desc' },
    });
    return records.map((r) => ({
      id: r.id,
      channelType: r.channelType as ChannelType,
      period: r.period,
      bottleneckStage: r.bottleneckStage,
      currentRate: r.currentRate,
      targetRate: r.targetRate,
      gapPoints: r.gapPoints,
      profitImpact: r.profitImpact,
      action: r.action,
      actionType: r.actionType as GeneratedTodo['actionType'],
      isAutoExecutable: r.isAutoExecutable,
      priority: r.priority as GeneratedTodo['priority'],
      status: r.status as GeneratedTodo['status'],
    }));
  }

  async updateStatus(
    id: string,
    status: GeneratedTodo['status'],
  ): Promise<void> {
    await this.prisma.profitSimulationTodo.update({
      where: { id },
      data: { status },
    });
  }
}

@Injectable()
export class PrismaFeedbackRepository implements FeedbackRepository {
  constructor(private readonly prisma: PrismaService) {}

  async save(feedback: TodoFeedback): Promise<void> {
    await this.prisma.profitSimulationFeedback.create({
      data: {
        id: feedback.id,
        todoId: feedback.todoId,
        decision: feedback.decision,
        reason: feedback.reason,
        rule: feedback.rule,
      },
    });
  }

  async findByTodoId(todoId: string): Promise<TodoFeedback[]> {
    const records = await this.prisma.profitSimulationFeedback.findMany({
      where: { todoId },
      orderBy: { createdAt: 'desc' },
    });
    return records.map((r) => ({
      id: r.id,
      todoId: r.todoId,
      decision: r.decision as TodoFeedback['decision'],
      reason: r.reason,
      rule: r.rule ?? undefined,
      timestamp: r.createdAt,
    }));
  }
}

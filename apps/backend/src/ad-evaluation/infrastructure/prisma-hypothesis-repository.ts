// ============================================================================
// HypothesisTest の Prisma リポジトリ
// ============================================================================

import { PrismaClient } from '@prisma/client';
import { HypothesisState } from '../domain/types';

export class PrismaHypothesisRepository {
  constructor(private readonly prisma: PrismaClient) {}

  async save(state: HypothesisState): Promise<string> {
    const record = await this.prisma.hypothesisTest.create({
      data: {
        channelType: state.channelType,
        hypothesis: state.hypothesis,
        status: state.status,
        adId: state.adId || null,
        adName: state.adName || null,
        account: state.account || null,
        verdict: state.verdict || null,
        interpretation: state.interpretation || null,
        nextAction: state.nextAction || null,
        spend: state.spend || null,
        optins: state.optins || null,
        frontPurchases: state.frontPurchases || null,
        individualRes: state.individualRes || null,
        cpa: state.cpa || null,
        indResCPO: state.indResCPO || null,
        evaluatedAt: state.evaluatedAt || null,
      },
    });
    return record.id;
  }

  async update(id: string, state: Partial<HypothesisState>): Promise<void> {
    await this.prisma.hypothesisTest.update({
      where: { id },
      data: {
        ...(state.status !== undefined && { status: state.status }),
        ...(state.adId !== undefined && { adId: state.adId }),
        ...(state.adName !== undefined && { adName: state.adName }),
        ...(state.account !== undefined && { account: state.account }),
        ...(state.verdict !== undefined && { verdict: state.verdict }),
        ...(state.interpretation !== undefined && { interpretation: state.interpretation }),
        ...(state.nextAction !== undefined && { nextAction: state.nextAction }),
        ...(state.spend !== undefined && { spend: state.spend }),
        ...(state.optins !== undefined && { optins: state.optins }),
        ...(state.frontPurchases !== undefined && { frontPurchases: state.frontPurchases }),
        ...(state.individualRes !== undefined && { individualRes: state.individualRes }),
        ...(state.cpa !== undefined && { cpa: state.cpa }),
        ...(state.indResCPO !== undefined && { indResCPO: state.indResCPO }),
        ...(state.evaluatedAt !== undefined && { evaluatedAt: state.evaluatedAt }),
      },
    });
  }

  async findByStatus(status: string): Promise<(HypothesisState & { id: string })[]> {
    const records = await this.prisma.hypothesisTest.findMany({
      where: { status },
      orderBy: { createdAt: 'desc' },
    });
    return records.map(r => ({
      id: r.id,
      channelType: r.channelType as 'AI' | 'SNS' | 'SKILL_PLUS',
      hypothesis: r.hypothesis,
      status: r.status as HypothesisState['status'],
      adId: r.adId || undefined,
      adName: r.adName || undefined,
      account: r.account || undefined,
      verdict: r.verdict || undefined,
      interpretation: r.interpretation || undefined,
      nextAction: r.nextAction || undefined,
      spend: r.spend || undefined,
      optins: r.optins || undefined,
      frontPurchases: r.frontPurchases || undefined,
      individualRes: r.individualRes || undefined,
      cpa: r.cpa || undefined,
      indResCPO: r.indResCPO || undefined,
      evaluatedAt: r.evaluatedAt || undefined,
    }));
  }

  async findByAdId(adId: string): Promise<(HypothesisState & { id: string }) | null> {
    const record = await this.prisma.hypothesisTest.findFirst({
      where: { adId },
      orderBy: { createdAt: 'desc' },
    });
    if (!record) return null;
    return {
      id: record.id,
      channelType: record.channelType as 'AI' | 'SNS' | 'SKILL_PLUS',
      hypothesis: record.hypothesis,
      status: record.status as HypothesisState['status'],
      adId: record.adId || undefined,
      adName: record.adName || undefined,
      account: record.account || undefined,
    };
  }

  async findRecent(limit = 20): Promise<(HypothesisState & { id: string; createdAt: Date })[]> {
    const records = await this.prisma.hypothesisTest.findMany({
      orderBy: { createdAt: 'desc' },
      take: limit,
    });
    return records.map(r => ({
      id: r.id,
      channelType: r.channelType as 'AI' | 'SNS' | 'SKILL_PLUS',
      hypothesis: r.hypothesis,
      status: r.status as HypothesisState['status'],
      adId: r.adId || undefined,
      adName: r.adName || undefined,
      account: r.account || undefined,
      verdict: r.verdict || undefined,
      interpretation: r.interpretation || undefined,
      nextAction: r.nextAction || undefined,
      spend: r.spend || undefined,
      optins: r.optins || undefined,
      cpa: r.cpa || undefined,
      indResCPO: r.indResCPO || undefined,
      evaluatedAt: r.evaluatedAt || undefined,
      createdAt: r.createdAt,
    }));
  }
}

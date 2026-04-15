/**
 * 実験A出稿スクリプト: クリエイティブ本数別Smart+広告を4グループ作成 (完全自動版)
 *
 * 仕様: docs/hypothesis/hypothesis_experiment_A_creative_count.md
 *
 * 群構成:
 *   A1 (1本)  → AI_1 : CR01132の動画2 (Claude Code解説)
 *   A2 (6本)  → AI_2 : CR01132内 動画 2,7,13,14,9,15
 *   A3 (17本) → AI_2 : CR01132の全17本
 *   A4 (20本) → AI_1 : CR01132の17本 + CR01144動画 + CR01215動画 + CR01150動画
 *
 * 使い方:
 *   npx tsx apps/backend/experiment-a-deploy.ts <A1|A2|A3|A4|all>
 */
import { config as dotenvConfig } from 'dotenv';
import * as path from 'path';
dotenvConfig({ path: path.resolve(__dirname, '.env') });
dotenvConfig({ path: path.resolve(process.cwd(), '.env') });
import { spawn } from 'child_process';

const ACCOUNTS = {
  AI_1: '7468288053866561553',
  AI_2: '7523128243466551303',
};

const CR01132 = { advertiser: ACCOUNTS.AI_2, adId: '1861004791157921' };

// A4で追加する3動画 (advertiserId:videoId 形式)
const A4_EXTRA_VIDEOS = [
  { advId: ACCOUNTS.AI_1, videoId: 'v10033g50000d6onmc7og65m24ip5vig', label: 'CR01144 (AI全部やめました渋谷Ver)' },
  { advId: ACCOUNTS.AI_1, videoId: 'v10033g50000d58f1enog65nesaovgb0', label: 'CR01215 (Claudeが重要)' },
  { advId: ACCOUNTS.AI_2, videoId: 'v10033g50000d7803jvog65vrdpvqi3g', label: 'CR01150 動画2' },
];

interface GroupConfig {
  name: string;
  targetAccount: string;
  expectedVideoCount: number;
  videoIndices?: number[];
  extraVideos?: { advId: string; videoId: string }[];
}

const GROUPS: Record<string, GroupConfig> = {
  A1: {
    name: '群A1 (1本) → AI_1',
    targetAccount: ACCOUNTS.AI_1,
    expectedVideoCount: 1,
    videoIndices: [2],
  },
  A2: {
    name: '群A2 (6本) → AI_2',
    targetAccount: ACCOUNTS.AI_2,
    expectedVideoCount: 6,
    videoIndices: [2, 7, 13, 14, 9, 15],
  },
  A3: {
    name: '群A3 (17本) → AI_2',
    targetAccount: ACCOUNTS.AI_2,
    expectedVideoCount: 17,
  },
  A4: {
    name: '群A4 (20本) → AI_1',
    targetAccount: ACCOUNTS.AI_1,
    expectedVideoCount: 20,
    extraVideos: A4_EXTRA_VIDEOS,
  },
};

async function runCrossDeploy(args: string[]): Promise<number> {
  return new Promise((resolve) => {
    const proc = spawn('npx', ['tsx', 'apps/backend/cross-deploy-local.ts', ...args], {
      stdio: 'inherit',
      shell: true,
    });
    proc.on('close', (code) => resolve(code ?? 1));
  });
}

async function deployGroup(groupKey: string): Promise<boolean> {
  const cfg = GROUPS[groupKey];
  if (!cfg) { console.error(`Unknown group: ${groupKey}`); return false; }

  console.log(`\n${'='.repeat(60)}`);
  console.log(`${cfg.name}`);
  console.log('='.repeat(60));
  console.log(`元素材: CR01132 (ad=${CR01132.adId})`);
  console.log(`配信先: ${cfg.targetAccount}`);
  console.log(`動画本数: ${cfg.expectedVideoCount}本`);
  if (cfg.videoIndices) console.log(`動画インデックス: ${cfg.videoIndices.join(',')}`);
  if (cfg.extraVideos) console.log(`追加動画: ${cfg.extraVideos.length}本`);

  const args: string[] = [CR01132.advertiser, CR01132.adId, cfg.targetAccount, '3000'];
  if (cfg.videoIndices) args.push(`--video-indices=${cfg.videoIndices.join(',')}`);
  if (cfg.extraVideos) args.push(`--extra-videos=${cfg.extraVideos.map(e => `${e.advId}:${e.videoId}`).join(',')}`);

  console.log(`\nコマンド: npx tsx apps/backend/cross-deploy-local.ts ${args.join(' ')}\n`);

  const code = await runCrossDeploy(args);
  if (code !== 0) {
    console.error(`\n❌ ${groupKey} 失敗 (exit ${code})`);
    return false;
  }
  console.log(`\n✅ ${groupKey} 出稿完了`);
  return true;
}

async function main() {
  const group = process.argv[2];
  if (!group) {
    console.log('使い方: npx tsx apps/backend/experiment-a-deploy.ts <A1|A2|A3|A4|all>');
    console.log('\n群の説明:');
    for (const [k, v] of Object.entries(GROUPS)) console.log(`  ${k}: ${v.name}`);
    console.log(`  all: A1〜A4を順次実行`);
    process.exit(1);
  }

  if (group === 'all') {
    for (const k of ['A1', 'A2', 'A3', 'A4']) {
      const ok = await deployGroup(k);
      if (!ok) {
        console.error(`\n${k}で失敗したため中断`);
        process.exit(1);
      }
    }
    console.log('\n🎉 全群出稿完了');
  } else {
    if (!GROUPS[group]) {
      console.error(`Unknown group: ${group}`);
      process.exit(1);
    }
    const ok = await deployGroup(group);
    process.exit(ok ? 0 : 1);
  }
}

main().catch((e) => { console.error(e); process.exit(1); });

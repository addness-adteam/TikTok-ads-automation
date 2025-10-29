import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
  console.log('🌱 Seeding database...');

  // ============================================================================
  // 1. ロール（Role）の作成
  // ============================================================================
  console.log('Creating roles...');

  const adminRole = await prisma.role.upsert({
    where: { name: 'ADMIN' },
    update: {},
    create: {
      name: 'ADMIN',
      description: 'システム管理者 - すべての操作が可能',
    },
  });

  const operatorRole = await prisma.role.upsert({
    where: { name: 'OPERATOR' },
    update: {},
    create: {
      name: 'OPERATOR',
      description: '運用担当者 - キャンペーン・広告の作成・編集が可能',
    },
  });

  const approverRole = await prisma.role.upsert({
    where: { name: 'APPROVER' },
    update: {},
    create: {
      name: 'APPROVER',
      description: '承認者 - キャンペーン・広告の承認が可能',
    },
  });

  const viewerRole = await prisma.role.upsert({
    where: { name: 'VIEWER' },
    update: {},
    create: {
      name: 'VIEWER',
      description: '閲覧者 - レポート・ダッシュボードの閲覧のみ可能',
    },
  });

  console.log('✅ Roles created');

  // ============================================================================
  // 2. 権限（Permission）の作成
  // ============================================================================
  console.log('Creating permissions...');

  const permissions = [
    // Campaign権限
    { name: 'campaign.create', resource: 'campaign', action: 'create', description: 'キャンペーンの作成' },
    { name: 'campaign.read', resource: 'campaign', action: 'read', description: 'キャンペーンの閲覧' },
    { name: 'campaign.update', resource: 'campaign', action: 'update', description: 'キャンペーンの編集' },
    { name: 'campaign.delete', resource: 'campaign', action: 'delete', description: 'キャンペーンの削除' },
    { name: 'campaign.approve', resource: 'campaign', action: 'approve', description: 'キャンペーンの承認' },

    // AdGroup権限
    { name: 'adgroup.create', resource: 'adgroup', action: 'create', description: '広告グループの作成' },
    { name: 'adgroup.read', resource: 'adgroup', action: 'read', description: '広告グループの閲覧' },
    { name: 'adgroup.update', resource: 'adgroup', action: 'update', description: '広告グループの編集' },
    { name: 'adgroup.delete', resource: 'adgroup', action: 'delete', description: '広告グループの削除' },

    // Ad権限
    { name: 'ad.create', resource: 'ad', action: 'create', description: '広告の作成' },
    { name: 'ad.read', resource: 'ad', action: 'read', description: '広告の閲覧' },
    { name: 'ad.update', resource: 'ad', action: 'update', description: '広告の編集' },
    { name: 'ad.delete', resource: 'ad', action: 'delete', description: '広告の削除' },

    // Creative権限
    { name: 'creative.create', resource: 'creative', action: 'create', description: 'クリエイティブの作成' },
    { name: 'creative.read', resource: 'creative', action: 'read', description: 'クリエイティブの閲覧' },
    { name: 'creative.update', resource: 'creative', action: 'update', description: 'クリエイティブの編集' },
    { name: 'creative.delete', resource: 'creative', action: 'delete', description: 'クリエイティブの削除' },

    // Report権限
    { name: 'report.read', resource: 'report', action: 'read', description: 'レポートの閲覧' },
    { name: 'report.export', resource: 'report', action: 'export', description: 'レポートのエクスポート' },

    // User管理権限
    { name: 'user.create', resource: 'user', action: 'create', description: 'ユーザーの作成' },
    { name: 'user.read', resource: 'user', action: 'read', description: 'ユーザーの閲覧' },
    { name: 'user.update', resource: 'user', action: 'update', description: 'ユーザーの編集' },
    { name: 'user.delete', resource: 'user', action: 'delete', description: 'ユーザーの削除' },

    // Role管理権限
    { name: 'role.create', resource: 'role', action: 'create', description: 'ロールの作成' },
    { name: 'role.read', resource: 'role', action: 'read', description: 'ロールの閲覧' },
    { name: 'role.update', resource: 'role', action: 'update', description: 'ロールの編集' },
    { name: 'role.delete', resource: 'role', action: 'delete', description: 'ロールの削除' },

    // Settings権限
    { name: 'settings.read', resource: 'settings', action: 'read', description: '設定の閲覧' },
    { name: 'settings.update', resource: 'settings', action: 'update', description: '設定の編集' },

    // Experiment権限
    { name: 'experiment.create', resource: 'experiment', action: 'create', description: '実験の作成' },
    { name: 'experiment.read', resource: 'experiment', action: 'read', description: '実験の閲覧' },
    { name: 'experiment.update', resource: 'experiment', action: 'update', description: '実験の編集' },
    { name: 'experiment.delete', resource: 'experiment', action: 'delete', description: '実験の削除' },
  ];

  const createdPermissions: Record<string, any> = {};

  for (const permission of permissions) {
    const created = await prisma.permission.upsert({
      where: { name: permission.name },
      update: {},
      create: permission,
    });
    createdPermissions[permission.name] = created;
  }

  console.log(`✅ ${permissions.length} permissions created`);

  // ============================================================================
  // 3. ロール-権限マッピング（RolePermission）
  // ============================================================================
  console.log('Mapping roles to permissions...');

  // ADMIN: すべての権限
  const adminPermissions = Object.values(createdPermissions);
  for (const permission of adminPermissions) {
    await prisma.rolePermission.upsert({
      where: {
        roleId_permissionId: {
          roleId: adminRole.id,
          permissionId: permission.id,
        },
      },
      update: {},
      create: {
        roleId: adminRole.id,
        permissionId: permission.id,
      },
    });
  }
  console.log(`✅ ADMIN role mapped to ${adminPermissions.length} permissions`);

  // OPERATOR: Campaign, AdGroup, Ad, Creative, Reportの作成・編集・閲覧
  const operatorPermissionNames = [
    'campaign.create', 'campaign.read', 'campaign.update',
    'adgroup.create', 'adgroup.read', 'adgroup.update',
    'ad.create', 'ad.read', 'ad.update',
    'creative.create', 'creative.read', 'creative.update',
    'report.read', 'report.export',
  ];
  for (const permName of operatorPermissionNames) {
    const permission = createdPermissions[permName];
    if (permission) {
      await prisma.rolePermission.upsert({
        where: {
          roleId_permissionId: {
            roleId: operatorRole.id,
            permissionId: permission.id,
          },
        },
        update: {},
        create: {
          roleId: operatorRole.id,
          permissionId: permission.id,
        },
      });
    }
  }
  console.log(`✅ OPERATOR role mapped to ${operatorPermissionNames.length} permissions`);

  // APPROVER: 閲覧 + 承認権限
  const approverPermissionNames = [
    'campaign.read', 'campaign.approve',
    'adgroup.read',
    'ad.read',
    'creative.read',
    'report.read', 'report.export',
  ];
  for (const permName of approverPermissionNames) {
    const permission = createdPermissions[permName];
    if (permission) {
      await prisma.rolePermission.upsert({
        where: {
          roleId_permissionId: {
            roleId: approverRole.id,
            permissionId: permission.id,
          },
        },
        update: {},
        create: {
          roleId: approverRole.id,
          permissionId: permission.id,
        },
      });
    }
  }
  console.log(`✅ APPROVER role mapped to ${approverPermissionNames.length} permissions`);

  // VIEWER: 閲覧のみ
  const viewerPermissionNames = [
    'campaign.read',
    'adgroup.read',
    'ad.read',
    'creative.read',
    'report.read',
  ];
  for (const permName of viewerPermissionNames) {
    const permission = createdPermissions[permName];
    if (permission) {
      await prisma.rolePermission.upsert({
        where: {
          roleId_permissionId: {
            roleId: viewerRole.id,
            permissionId: permission.id,
          },
        },
        update: {},
        create: {
          roleId: viewerRole.id,
          permissionId: permission.id,
        },
      });
    }
  }
  console.log(`✅ VIEWER role mapped to ${viewerPermissionNames.length} permissions`);

  // ============================================================================
  // 4. デフォルトユーザー作成（開発用）
  // ============================================================================
  console.log('Creating default users...');

  const adminUser = await prisma.user.upsert({
    where: { email: 'admin@example.com' },
    update: {},
    create: {
      email: 'admin@example.com',
      name: 'Admin User',
      passwordHash: null, // パスワードハッシュは別途設定
      status: 'ACTIVE',
    },
  });

  // AdminユーザーにADMINロールを割り当て
  await prisma.userRole.upsert({
    where: {
      userId_roleId: {
        userId: adminUser.id,
        roleId: adminRole.id,
      },
    },
    update: {},
    create: {
      userId: adminUser.id,
      roleId: adminRole.id,
    },
  });

  console.log('✅ Default admin user created');

  console.log('');
  console.log('🎉 Seed completed successfully!');
  console.log('');
  console.log('📊 Summary:');
  console.log(`   - Roles: 4 (ADMIN, OPERATOR, APPROVER, VIEWER)`);
  console.log(`   - Permissions: ${permissions.length}`);
  console.log(`   - Users: 1 (admin@example.com)`);
  console.log('');
}

main()
  .then(async () => {
    await prisma.$disconnect();
  })
  .catch(async (e) => {
    console.error('❌ Seed failed:', e);
    await prisma.$disconnect();
    process.exit(1);
  });

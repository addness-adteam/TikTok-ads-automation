import {
  Controller,
  Get,
  Post,
  Patch,
  Delete,
  Query,
  Param,
  Body,
  HttpCode,
  HttpStatus,
} from '@nestjs/common';
import {
  NotificationService,
  NotificationType,
  NotificationSeverity,
  NotificationStatus,
} from './notification.service';

@Controller('api/notifications')
export class NotificationController {
  constructor(private readonly notificationService: NotificationService) {}

  /**
   * 通知一覧取得
   * GET /api/notifications?advertiserId=xxx&status=UNREAD&type=CPA_DEVIATION&limit=50&offset=0
   */
  @Get()
  async getNotifications(
    @Query('advertiserId') advertiserId: string,
    @Query('status') status?: string,
    @Query('type') type?: string,
    @Query('severity') severity?: string,
    @Query('limit') limit?: string,
    @Query('offset') offset?: string,
  ) {
    const statusArray = status
      ? (status.split(',') as NotificationStatus[])
      : undefined;
    const typeArray = type
      ? (type.split(',') as NotificationType[])
      : undefined;
    const severityArray = severity
      ? (severity.split(',') as NotificationSeverity[])
      : undefined;

    return this.notificationService.getNotifications({
      advertiserId,
      status: statusArray,
      type: typeArray,
      severity: severityArray,
      limit: limit ? parseInt(limit, 10) : 50,
      offset: offset ? parseInt(offset, 10) : 0,
    });
  }

  /**
   * 未読通知数取得
   * GET /api/notifications/unread-count?advertiserId=xxx
   */
  @Get('unread-count')
  async getUnreadCount(@Query('advertiserId') advertiserId: string) {
    const count = await this.notificationService.getUnreadCount(advertiserId);
    return { unreadCount: count };
  }

  /**
   * 通知既読更新
   * PATCH /api/notifications/:id/read
   */
  @Patch(':id/read')
  @HttpCode(HttpStatus.OK)
  async markAsRead(@Param('id') id: string) {
    await this.notificationService.markAsRead(id);
    return { success: true };
  }

  /**
   * 一括既読
   * POST /api/notifications/mark-read
   */
  @Post('mark-read')
  @HttpCode(HttpStatus.OK)
  async markAllAsRead(
    @Body() body: { advertiserId: string; notificationIds?: string[] },
  ) {
    await this.notificationService.markAllAsRead(
      body.advertiserId,
      body.notificationIds,
    );
    return { success: true };
  }

  /**
   * 通知削除（対応済み）
   * DELETE /api/notifications/:id
   */
  @Delete(':id')
  @HttpCode(HttpStatus.OK)
  async deleteNotification(@Param('id') id: string) {
    await this.notificationService.deleteNotification(id);
    return { success: true };
  }
}

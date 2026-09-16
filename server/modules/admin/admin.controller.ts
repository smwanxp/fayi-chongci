import { Body, Controller, Get, Post, Put, Req } from '@nestjs/common';
import {
  AuthorizationSDK,
  NeedLogin,
} from '@lark-apaas/fullstack-nestjs-core';
import type { Request } from 'express';

import type {
  AddAdminStudentsRequest,
  AdminContentSyncRequest,
  AdminContentSyncResponse,
  ListAdminStudentsResponse,
  RemoveAdminStudentsRequest,
  UpdateAdminStudentRemarkRequest,
} from '@shared/api.interface';
import { PlatformRoleService } from '../../common/services/platform-role.service';

import { AdminDataService } from './admin-data.service';

const STUDENT_ROLE = 'fayi_student';

@Controller('api/admin')
export class AdminController {
  constructor(
    private readonly authzSDK: AuthorizationSDK,
    private readonly adminDataService: AdminDataService,
    private readonly platformRoleService: PlatformRoleService,
  ) {}

  @NeedLogin()
  @Get('students')
  async listStudents(@Req() req: Request): Promise<ListAdminStudentsResponse> {
    await this.platformRoleService.requireAny(req.userContext.userId, ['fayi_admin']);
    const response = await this.authzSDK.members.list(STUDENT_ROLE, {
      type: 'User',
      page: 1,
      pageSize: 100,
    });
    return { students: await this.adminDataService.summarizeStudents(req.userContext.userId, response.members.userList ?? []) };
  }

  @NeedLogin()
  @Post('students')
  async addStudents(@Req() req: Request, @Body() body: AddAdminStudentsRequest) {
    await this.platformRoleService.requireAny(req.userContext.userId, ['fayi_admin']);
    const userIds = [...new Set(body.userIds ?? [])].filter(Boolean);
    if (!userIds.length) return { added: 0, initialized: 0 };
    await this.authzSDK.members.add(STUDENT_ROLE, {
      members: { userList: userIds.map(userID => ({ userID })) },
    });
    const result = await this.adminDataService.initializeStudents(req.userContext.userId, userIds);
    return { added: userIds.length, ...result };
  }

  @NeedLogin()
  @Post('students/remove')
  async removeStudents(@Req() req: Request, @Body() body: RemoveAdminStudentsRequest) {
    await this.platformRoleService.requireAny(req.userContext.userId, ['fayi_admin']);
    const userIds = [...new Set(body.userIds ?? [])].filter(Boolean);
    if (!userIds.length) return { removed: 0, deleted: 0 };
    await this.authzSDK.members.remove(STUDENT_ROLE, {
      members: { userList: userIds.map(userID => ({ userID })) },
    });
    const result = body.deleteData
      ? await this.adminDataService.deleteStudentData(userIds)
      : { deleted: 0 };
    await this.adminDataService.deleteStudentRemarks(req.userContext.userId, userIds);
    return { removed: userIds.length, ...result };
  }

  @NeedLogin()
  @Put('students/remark')
  async updateStudentRemark(@Req() req: Request, @Body() body: UpdateAdminStudentRemarkRequest) {
    await this.platformRoleService.requireAny(req.userContext.userId, ['fayi_admin']);
    return this.adminDataService.updateStudentRemark(req.userContext.userId, body.userId, body.remark);
  }

  @NeedLogin()
  @Post('content-sync')
  async syncContent(
    @Req() req: Request,
    @Body() body: AdminContentSyncRequest,
  ): Promise<AdminContentSyncResponse> {
    await this.platformRoleService.requireAny(req.userContext.userId, ['fayi_admin']);
    return this.adminDataService.syncContent(req.userContext.userId, body);
  }
}

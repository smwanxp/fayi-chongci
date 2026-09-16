import { Body, Controller, Get, Param, ParseIntPipe, Post, Put, Req } from '@nestjs/common';
import { NeedLogin } from '@lark-apaas/fullstack-nestjs-core';
import type { Request } from 'express';

import type {
  GetStudyDataResponse,
  CommitStudyDataUploadRequest,
  SaveStudyDataRequest,
  SaveStudyDataResponse,
  UploadStudyDataChunkRequest,
} from '@shared/api.interface';
import { PlatformRoleService } from '../../common/services/platform-role.service';

import { StudyDataService } from './study-data.service';

@Controller('api/data')
export class StudyDataController {
  constructor(
    private readonly studyDataService: StudyDataService,
    private readonly platformRoleService: PlatformRoleService,
  ) {}

  @NeedLogin()
  @Get()
  async getCurrentUserData(@Req() req: Request): Promise<GetStudyDataResponse> {
    await this.platformRoleService.requireAny(req.userContext.userId, ['fayi_admin', 'fayi_student']);
    return this.studyDataService.getForUser(req.userContext.userId);
  }

  @NeedLogin()
  @Put()
  async saveCurrentUserData(
    @Req() req: Request,
    @Body() body: SaveStudyDataRequest,
  ): Promise<SaveStudyDataResponse> {
    await this.platformRoleService.requireAny(req.userContext.userId, ['fayi_admin', 'fayi_student']);
    return this.studyDataService.saveForUser(req.userContext.userId, body.payload);
  }

  @NeedLogin()
  @Put('upload/:uploadId/:chunkIndex')
  async saveUploadChunk(
    @Req() req: Request,
    @Param('uploadId') uploadId: string,
    @Param('chunkIndex', ParseIntPipe) chunkIndex: number,
    @Body() body: UploadStudyDataChunkRequest,
  ) {
    await this.platformRoleService.requireAny(req.userContext.userId, ['fayi_admin', 'fayi_student']);
    return this.studyDataService.saveUploadChunk(
      req.userContext.userId,
      uploadId,
      chunkIndex,
      body.data,
    );
  }

  @NeedLogin()
  @Post('upload/:uploadId/commit')
  async commitUpload(
    @Req() req: Request,
    @Param('uploadId') uploadId: string,
    @Body() body: CommitStudyDataUploadRequest,
  ): Promise<SaveStudyDataResponse> {
    await this.platformRoleService.requireAny(req.userContext.userId, ['fayi_admin', 'fayi_student']);
    return this.studyDataService.commitUpload(
      req.userContext.userId,
      uploadId,
      body.totalChunks,
    );
  }
}

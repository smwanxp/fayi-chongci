import { APP_FILTER } from '@nestjs/core';
import { Module } from '@nestjs/common';
import { PlatformModule } from '@lark-apaas/fullstack-nestjs-core';

import { GlobalExceptionFilter } from './common/filters/exception.filter';
import { PlatformRoleModule } from './common/services/platform-role.module';
import { AdminModule } from './modules/admin/admin.module';
import { StudyDataModule } from './modules/study-data/study-data.module';
import { ViewModule } from './modules/view/view.module';

@Module({
  imports: [
    // 平台 Module，提供平台能力
    PlatformModule.forRoot(),
    PlatformRoleModule,
    // ====== @route-section: business-modules START ======
    StudyDataModule,
    AdminModule,
    // ====== @route-section: business-modules END ======

    // ⚠️ @route-order: last
    // ViewModule is the fallback route module, must be registered last.
    ViewModule,
  ],
  providers: [
    {
      provide: APP_FILTER,
      useClass: GlobalExceptionFilter,
    },
  ],
})
export class AppModule {}

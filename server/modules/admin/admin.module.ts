import { Module } from '@nestjs/common';

import { AdminController } from './admin.controller';
import { AdminDataService } from './admin-data.service';

@Module({
  controllers: [AdminController],
  providers: [AdminDataService],
})
export class AdminModule {}

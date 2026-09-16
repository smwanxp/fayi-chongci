import { Module } from '@nestjs/common';

import { StudyDataController } from './study-data.controller';
import { StudyDataService } from './study-data.service';

@Module({
  controllers: [StudyDataController],
  providers: [StudyDataService],
  exports: [StudyDataService],
})
export class StudyDataModule {}

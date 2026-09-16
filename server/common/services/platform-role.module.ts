import { Global, Module } from '@nestjs/common';

import { PlatformRoleService } from './platform-role.service';

@Global()
@Module({
  providers: [PlatformRoleService],
  exports: [PlatformRoleService],
})
export class PlatformRoleModule {}

import { Module } from '@nestjs/common';
import { GroupsController } from './groups.controller';
import { SupabaseModule } from '../supabase/supabase.module';

import { GroupsCoreService } from './services/groups-core.service';
import { GroupsMembersService } from './services/groups-members.service';

@Module({
  imports: [SupabaseModule],
  controllers: [GroupsController],
  providers: [
    GroupsCoreService,
    GroupsMembersService,
  ],
  exports: [
    GroupsCoreService,
    GroupsMembersService,
  ],
})
export class GroupsModule {}

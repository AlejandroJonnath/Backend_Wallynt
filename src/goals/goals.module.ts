import { Module } from '@nestjs/common';
import { GoalsController } from './goals.controller';
import { GoalsService } from './goals.service';
import { SupabaseModule } from '../supabase/supabase.module';
import { AnalysisModule } from '../analysis/analysis.module';

@Module({
  imports: [SupabaseModule, AnalysisModule],
  controllers: [GoalsController],
  providers: [GoalsService],
  exports: [GoalsService],
})
export class GoalsModule {}

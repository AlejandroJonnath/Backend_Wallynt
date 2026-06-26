import { Module } from '@nestjs/common';
import { MovementsController } from './movements.controller';
import { MovementsService } from './movements.service';
import { SupabaseModule } from '../supabase/supabase.module';
import { AnalysisModule } from '../analysis/analysis.module';

@Module({
  imports: [SupabaseModule, AnalysisModule],
  controllers: [MovementsController],
  providers: [MovementsService],
})
export class MovementsModule {}

import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { AnalysisController } from './analysis.controller';
import { SupabaseModule } from '../supabase/supabase.module';

import { AnalysisDashboardService } from './services/analysis-dashboard.service';
import { AnalysisPredictionsService } from './services/analysis-predictions.service';
import { AnalysisAlertsService } from './services/analysis-alerts.service';
import { AnalysisAiService } from './services/analysis-ai.service';

@Module({
  imports: [SupabaseModule, ConfigModule],
  controllers: [AnalysisController],
  providers: [
    AnalysisDashboardService,
    AnalysisPredictionsService,
    AnalysisAlertsService,
    AnalysisAiService,
  ],
  exports: [
    AnalysisDashboardService,
    AnalysisPredictionsService,
    AnalysisAlertsService,
    AnalysisAiService,
  ],
})
export class AnalysisModule {}

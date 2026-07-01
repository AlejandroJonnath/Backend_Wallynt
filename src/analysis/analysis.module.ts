import { Module } from '@nestjs/common';
import { AnalysisController } from './analysis.controller';
import { SupabaseModule } from '../supabase/supabase.module';

import { AnalysisDashboardService } from './services/analysis-dashboard.service';
import { AnalysisPredictionsService } from './services/analysis-predictions.service';
import { AnalysisAlertsService } from './services/analysis-alerts.service';

@Module({
  imports: [SupabaseModule],
  controllers: [AnalysisController],
  providers: [
    AnalysisDashboardService,
    AnalysisPredictionsService,
    AnalysisAlertsService,
  ],
  exports: [
    AnalysisDashboardService,
    AnalysisPredictionsService,
    AnalysisAlertsService,
  ],
})
export class AnalysisModule {}

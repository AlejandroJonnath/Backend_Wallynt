import { Module } from '@nestjs/common';
import { AdminController } from './admin.controller';
import { SupabaseModule } from '../supabase/supabase.module';
import { AnalysisModule } from '../analysis/analysis.module';

import { AdminCoreService } from './services/admin-core.service';
import { AdminKpisService } from './services/admin-kpis.service';
import { AdminInsightsService } from './services/admin-insights.service';
import { AdminUsersService } from './services/admin-users.service';
import { AdminExportService } from './services/admin-export.service';
import { AdminExportExcelService } from './services/admin-export-excel.service';
import { AdminExportPowerBiService } from './services/admin-export-powerbi.service';

@Module({
  imports: [SupabaseModule, AnalysisModule],
  controllers: [AdminController],
  providers: [
    AdminCoreService,
    AdminKpisService,
    AdminInsightsService,
    AdminUsersService,
    AdminExportService,
    AdminExportExcelService,
    AdminExportPowerBiService,
  ],
})
export class AdminModule {}

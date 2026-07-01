import { Injectable } from '@nestjs/common';
import { AdminExportExcelService } from './admin-export-excel.service';
import { AdminExportPowerBiService } from './admin-export-powerbi.service';

@Injectable()
export class AdminExportService {
  constructor(
    private readonly excelService: AdminExportExcelService,
    private readonly powerBiService: AdminExportPowerBiService,
  ) {}

  async exportExcel(adminId: string): Promise<string> {
    return this.excelService.exportExcel(adminId);
  }

  async exportPowerBI(adminId: string) {
    return this.powerBiService.exportPowerBI(adminId);
  }
}

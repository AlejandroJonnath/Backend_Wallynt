import { Controller, Get, Post, Patch, Delete, Body, Param, UseGuards, Request } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';

import { AdminKpisService } from './services/admin-kpis.service';
import { AdminInsightsService } from './services/admin-insights.service';
import { AdminUsersService } from './services/admin-users.service';
import { AdminExportService } from './services/admin-export.service';

@Controller('admin')
@UseGuards(JwtAuthGuard)
export class AdminController {
  constructor(
    private readonly adminKpisService: AdminKpisService,
    private readonly adminInsightsService: AdminInsightsService,
    private readonly adminUsersService: AdminUsersService,
    private readonly adminExportService: AdminExportService,
  ) {}

  @Get('business-kpis')
  getBusinessKPIs(@Request() req) {
    return this.adminKpisService.getBusinessKPIs(req.user.userId);
  }

  @Get('financial-kpis')
  getFinancialKPIs(@Request() req) {
    return this.adminKpisService.getFinancialKPIs(req.user.userId);
  }

  @Get('strategic-insights')
  getStrategicInsights(@Request() req) {
    return this.adminInsightsService.getStrategicInsights(req.user.userId);
  }

  // Devuelve base64 del Excel para que el cliente lo descargue
  @Get('export/excel')
  async exportExcel(@Request() req) {
    const base64 = await this.adminExportService.exportExcel(req.user.userId);
    return { base64, filename: 'wallynt_report.xlsx' };
  }

  // JSON estructurado para Power BI
  @Get('export/powerbi')
  exportPowerBI(@Request() req) {
    return this.adminExportService.exportPowerBI(req.user.userId);
  }

  // Solo SuperAdmin
  @Get('users')
  getUsers(@Request() req) {
    return this.adminUsersService.getUsers(req.user.userId);
  }

  @Patch('users/:id/role')
  updateRole(@Request() req, @Param('id') id: string, @Body() body: { rol: string }) {
    return this.adminUsersService.updateUserRole(req.user.userId, id, body.rol);
  }

  @Delete('users/:id')
  deleteUser(@Request() req, @Param('id') id: string) {
    return this.adminUsersService.deleteUser(req.user.userId, id);
  }

  @Post('users/generate')
  generateUsers(@Request() req, @Body() body: { count: number }) {
    return this.adminUsersService.generateUsers(req.user.userId, body.count);
  }
}

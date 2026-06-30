import { Controller, Get, Post, Patch, Delete, Body, Param, UseGuards, Request } from '@nestjs/common';
import { AdminService } from './admin.service';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';


@Controller('admin')
@UseGuards(JwtAuthGuard)
export class AdminController {
  constructor(private readonly adminService: AdminService) {}



  @Get('business-kpis')
  getBusinessKPIs(@Request() req) {
    return this.adminService.getBusinessKPIs(req.user.userId);
  }

  @Get('financial-kpis')
  getFinancialKPIs(@Request() req) {
    return this.adminService.getFinancialKPIs(req.user.userId);
  }

  @Get('strategic-insights')
  getStrategicInsights(@Request() req) {
    return this.adminService.getStrategicInsights(req.user.userId);
  }

  // Devuelve base64 del Excel para que el cliente lo descargue
  @Get('export/excel')
  async exportExcel(@Request() req) {
    const base64 = await this.adminService.exportExcel(req.user.userId);
    return { base64, filename: 'wallynt_report.xlsx' };
  }

  // JSON estructurado para Power BI
  @Get('export/powerbi')
  exportPowerBI(@Request() req) {
    return this.adminService.exportPowerBI(req.user.userId);
  }

  // Solo SuperAdmin
  @Get('users')
  getUsers(@Request() req) {
    return this.adminService.getUsers(req.user.userId);
  }

  @Patch('users/:id/role')
  updateRole(@Request() req, @Param('id') id: string, @Body() body: { rol: string }) {
    return this.adminService.updateUserRole(req.user.userId, id, body.rol);
  }

  @Delete('users/:id')
  deleteUser(@Request() req, @Param('id') id: string) {
    return this.adminService.deleteUser(req.user.userId, id);
  }
}

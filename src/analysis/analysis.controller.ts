import { Controller, Get, Patch, Param, UseGuards, Request } from '@nestjs/common';
import { AnalysisService } from './analysis.service';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';

@Controller('analysis')
@UseGuards(JwtAuthGuard)
export class AnalysisController {
  constructor(private readonly analysisService: AnalysisService) {}

  @Get('dashboard')
  getDashboard(@Request() req) {
    return this.analysisService.getDashboard(req.user.userId);
  }

  @Get('score')
  getScore(@Request() req) {
    return this.analysisService.calculateAndSaveWallyScore(req.user.userId);
  }

  @Get('daily-limit')
  getDailyLimit(@Request() req) {
    return this.analysisService.getDailyLimit(req.user.userId);
  }

  @Get('prediction')
  getPrediction(@Request() req) {
    return this.analysisService.getFinancialPrediction(req.user.userId);
  }

  @Get('alerts')
  getAlerts(@Request() req) {
    return this.analysisService.getAlerts(req.user.userId);
  }

  @Patch('alerts/:id/read')
  markRead(@Request() req, @Param('id') id: string) {
    return this.analysisService.markAlertRead(req.user.userId, id);
  }
}

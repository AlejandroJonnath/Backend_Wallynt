import { Controller, Get, Post, Patch, Param, Body, UseGuards, Request } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';

import { AnalysisDashboardService } from './services/analysis-dashboard.service';
import { AnalysisPredictionsService } from './services/analysis-predictions.service';
import { AnalysisAlertsService } from './services/analysis-alerts.service';
import { AnalysisAiService } from './services/analysis-ai.service';

@Controller('analysis')
@UseGuards(JwtAuthGuard)
export class AnalysisController {
  constructor(
    private readonly analysisDashboardService: AnalysisDashboardService,
    private readonly analysisPredictionsService: AnalysisPredictionsService,
    private readonly analysisAlertsService: AnalysisAlertsService,
    private readonly analysisAiService: AnalysisAiService,
  ) {}

  @Get('dashboard')
  getDashboard(@Request() req) {
    return this.analysisDashboardService.getDashboard(req.user.userId);
  }

  @Get('score')
  getScore(@Request() req) {
    return this.analysisPredictionsService.calculateAndSaveWallyScore(req.user.userId);
  }

  @Get('daily-limit')
  getDailyLimit(@Request() req) {
    return this.analysisDashboardService.getDailyLimit(req.user.userId);
  }

  @Get('prediction')
  getPrediction(@Request() req) {
    return this.analysisPredictionsService.getFinancialPrediction(req.user.userId);
  }

  @Get('alerts')
  getAlerts(@Request() req) {
    return this.analysisAlertsService.getAlerts(req.user.userId);
  }

  @Patch('alerts/:id/read')
  markRead(@Request() req, @Param('id') id: string) {
    return this.analysisAlertsService.markAlertRead(req.user.userId, id);
  }

  @Get('ai-recommendations')
  getAiRecommendations(@Request() req) {
    return this.analysisAiService.getPersonalizedRecommendations(req.user.userId);
  }

  @Post('chat')
  async chat(@Request() req, @Body('history') history: { role: 'user'|'assistant'|'system', content: string }[]) {
    const response = await this.analysisAiService.chatWithWallyBot(req.user.userId, history || []);
    return { response };
  }
}

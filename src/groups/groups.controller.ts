import { Controller, Get, Post, Delete, Body, Param, UseGuards, Request } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { CreateGroupDto } from './dto/create-group.dto';
import { AddMemberDto } from './dto/add-member.dto';
import { AddExpenseDto } from './dto/add-expense.dto';

import { GroupsCoreService } from './services/groups-core.service';
import { GroupsMembersService } from './services/groups-members.service';

@Controller('groups')
@UseGuards(JwtAuthGuard)
export class GroupsController {
  constructor(
    private readonly groupsCoreService: GroupsCoreService,
    private readonly groupsMembersService: GroupsMembersService,
  ) {}

  @Get('requests')
  getPendingRequests(@Request() req) {
    return this.groupsMembersService.getPendingRequests(req.user.userId);
  }

  @Post(':id/invitations/respond')
  respondInvitation(@Request() req, @Param('id') id: string, @Body() body: { accept: boolean }) {
    return this.groupsMembersService.respondInvitation(req.user.userId, id, body.accept);
  }

  @Post('expenses/respond/:approvalId')
  respondExpense(@Request() req, @Param('approvalId') approvalId: string, @Body() body: { accept: boolean }) {
    return this.groupsCoreService.respondExpense(req.user.userId, approvalId, body.accept);
  }

  @Get()
  findAll(@Request() req) {
    return this.groupsCoreService.findAll(req.user.userId);
  }

  @Post()
  create(@Request() req, @Body() dto: CreateGroupDto) {
    return this.groupsCoreService.create(req.user.userId, dto);
  }

  @Post(':id/members')
  addMember(@Request() req, @Param('id') id: string, @Body() dto: AddMemberDto) {
    return this.groupsMembersService.addMember(req.user.userId, id, dto);
  }

  @Delete(':id/members/:memberId')
  removeMember(@Request() req, @Param('id') id: string, @Param('memberId') memberId: string) {
    return this.groupsMembersService.removeMember(req.user.userId, id, memberId);
  }

  @Get(':id/expenses')
  getExpenses(@Request() req, @Param('id') id: string) {
    return this.groupsCoreService.getExpenses(req.user.userId, id);
  }

  @Post(':id/expenses')
  addExpense(@Request() req, @Param('id') id: string, @Body() dto: AddExpenseDto) {
    return this.groupsCoreService.addExpense(req.user.userId, id, dto);
  }

  @Delete(':id/expenses/:expenseId')
  removeExpense(@Request() req, @Param('id') id: string, @Param('expenseId') expenseId: string) {
    return this.groupsCoreService.removeExpense(req.user.userId, id, expenseId);
  }

  @Post(':id/expenses/:expenseId/confirm')
  confirmExpense(@Request() req, @Param('id') id: string, @Param('expenseId') expenseId: string) {
    return this.groupsCoreService.confirmExpense(req.user.userId, id, expenseId);
  }
}

import { Controller, Get, Post, Delete, Body, Param, UseGuards, Request } from '@nestjs/common';
import { GroupsService } from './groups.service';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { CreateGroupDto } from './dto/create-group.dto';
import { AddMemberDto } from './dto/add-member.dto';
import { AddExpenseDto } from './dto/add-expense.dto';

@Controller('groups')
@UseGuards(JwtAuthGuard)
export class GroupsController {
  constructor(private readonly groupsService: GroupsService) {}

  @Get('requests')
  getPendingRequests(@Request() req) {
    return this.groupsService.getPendingRequests(req.user.userId);
  }

  @Post(':id/invitations/respond')
  respondInvitation(@Request() req, @Param('id') id: string, @Body() body: { accept: boolean }) {
    return this.groupsService.respondInvitation(req.user.userId, id, body.accept);
  }

  @Post('expenses/respond/:approvalId')
  respondExpense(@Request() req, @Param('approvalId') approvalId: string, @Body() body: { accept: boolean }) {
    return this.groupsService.respondExpense(req.user.userId, approvalId, body.accept);
  }

  @Get()
  findAll(@Request() req) {
    return this.groupsService.findAll(req.user.userId);
  }

  @Post()
  create(@Request() req, @Body() dto: CreateGroupDto) {
    return this.groupsService.create(req.user.userId, dto);
  }

  @Post(':id/members')
  addMember(@Request() req, @Param('id') id: string, @Body() dto: AddMemberDto) {
    return this.groupsService.addMember(req.user.userId, id, dto);
  }

  @Delete(':id/members/:memberId')
  removeMember(@Request() req, @Param('id') id: string, @Param('memberId') memberId: string) {
    return this.groupsService.removeMember(req.user.userId, id, memberId);
  }

  @Get(':id/expenses')
  getExpenses(@Request() req, @Param('id') id: string) {
    return this.groupsService.getExpenses(req.user.userId, id);
  }

  @Post(':id/expenses')
  addExpense(@Request() req, @Param('id') id: string, @Body() dto: AddExpenseDto) {
    return this.groupsService.addExpense(req.user.userId, id, dto);
  }

  @Delete(':id/expenses/:expenseId')
  removeExpense(@Request() req, @Param('id') id: string, @Param('expenseId') expenseId: string) {
    return this.groupsService.removeExpense(req.user.userId, id, expenseId);
  }
}

import { Body, Controller, Get, Put, UseGuards } from '@nestjs/common';
import { ZodResponse } from 'nestjs-zod';
import { AuthGuard } from '../auth/guard/auth.guard';
import { RolesGuard } from '../auth/guard/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { UserRole } from '../users/user-role.enum';
import { InvidiousInstanceDto } from './dto/invidious-instance.dto';
import { ReplaceInvidiousInstancesDto } from './dto/replace-invidious-instances.dto';
import { InvidiousInstancesService } from './invidious-instances.service';

@Controller('invidious-instances')
export class InvidiousInstancesController {
  constructor(
    private readonly invidiousInstancesService: InvidiousInstancesService,
  ) {}

  @Get()
  @Roles(UserRole.Admin)
  @UseGuards(AuthGuard, RolesGuard)
  @ZodResponse({ type: [InvidiousInstanceDto] })
  findAll(): Promise<InvidiousInstanceDto[]> {
    return this.invidiousInstancesService.findAll();
  }

  @Put()
  @Roles(UserRole.Admin)
  @UseGuards(AuthGuard, RolesGuard)
  @ZodResponse({ type: [InvidiousInstanceDto] })
  replace(
    @Body() body: ReplaceInvidiousInstancesDto,
  ): Promise<InvidiousInstanceDto[]> {
    return this.invidiousInstancesService.replace(body.urls);
  }
}

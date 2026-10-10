import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Patch,
  Post,
  Put,
  Req,
  UseGuards,
} from '@nestjs/common';
import { ZodResponse } from 'nestjs-zod';
import { AccessTokenPayload, AuthGuard } from '../auth/guard/auth.guard';
import { OptionalAuthGuard } from '../auth/guard/optional-auth.guard';
import { RolesGuard } from '../auth/guard/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { IdParamDto } from '../shared/dto/id-param.dto';
import { UserRole } from '../users/user-role.enum';
import { FeatureFlagsService } from './feature-flags.service';
import { CreateFeatureFlagDto } from './dto/create-feature-flag.dto';
import { UpdateFeatureFlagDto } from './dto/update-feature-flag.dto';
import { SetFeatureFlagOverrideDto } from './dto/set-feature-flag-override.dto';
import { FeatureFlagOverrideParamsDto } from './dto/feature-flag-override-params.dto';
import { FeatureFlagResponseDto } from './dto/feature-flag-response.dto';
import { FeatureFlagListResponseDto } from './dto/feature-flag-list-response.dto';
import { FeatureFlagOverrideListResponseDto } from './dto/feature-flag-override-list-response.dto';
import { EffectiveFeatureFlagListResponseDto } from './dto/effective-feature-flag-list-response.dto';

interface OptionalUserRequest {
  user?: Pick<AccessTokenPayload, 'id' | 'role'>;
}

@Controller('feature-flags')
export class FeatureFlagsController {
  constructor(private readonly featureFlagsService: FeatureFlagsService) {}

  @Get('me')
  @UseGuards(OptionalAuthGuard)
  @ZodResponse({ type: EffectiveFeatureFlagListResponseDto })
  getEffectiveForMe(@Req() req: OptionalUserRequest) {
    return this.featureFlagsService.getEffectiveForUser(req.user?.id);
  }

  @Get()
  @Roles(UserRole.Admin)
  @UseGuards(AuthGuard, RolesGuard)
  @ZodResponse({ type: FeatureFlagListResponseDto })
  findAll() {
    return this.featureFlagsService.findAll();
  }

  @Get(':id/overrides')
  @Roles(UserRole.Admin)
  @UseGuards(AuthGuard, RolesGuard)
  @ZodResponse({ type: FeatureFlagOverrideListResponseDto })
  findOverrides(@Param() params: IdParamDto) {
    return this.featureFlagsService.findOverrides(params.id);
  }

  @Post()
  @Roles(UserRole.Admin)
  @UseGuards(AuthGuard, RolesGuard)
  @ZodResponse({ type: FeatureFlagResponseDto })
  create(@Body() body: CreateFeatureFlagDto) {
    return this.featureFlagsService.create(body);
  }

  @Patch(':id')
  @Roles(UserRole.Admin)
  @UseGuards(AuthGuard, RolesGuard)
  @ZodResponse({ type: FeatureFlagResponseDto })
  update(@Param() params: IdParamDto, @Body() body: UpdateFeatureFlagDto) {
    return this.featureFlagsService.update(params.id, body);
  }

  @Delete(':id')
  @Roles(UserRole.Admin)
  @UseGuards(AuthGuard, RolesGuard)
  @HttpCode(HttpStatus.NO_CONTENT)
  remove(@Param() params: IdParamDto) {
    return this.featureFlagsService.remove(params.id);
  }

  @Put(':id/overrides/:userId')
  @Roles(UserRole.Admin)
  @UseGuards(AuthGuard, RolesGuard)
  @HttpCode(HttpStatus.NO_CONTENT)
  setOverride(
    @Param() params: FeatureFlagOverrideParamsDto,
    @Body() body: SetFeatureFlagOverrideDto,
  ) {
    return this.featureFlagsService.setOverride(
      params.id,
      params.userId,
      body.value,
    );
  }

  @Delete(':id/overrides/:userId')
  @Roles(UserRole.Admin)
  @UseGuards(AuthGuard, RolesGuard)
  @HttpCode(HttpStatus.NO_CONTENT)
  deleteOverride(@Param() params: FeatureFlagOverrideParamsDto) {
    return this.featureFlagsService.deleteOverride(params.id, params.userId);
  }
}

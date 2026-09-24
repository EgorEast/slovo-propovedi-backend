import {
  Controller,
  Get,
  Post,
  Body,
  Patch,
  Param,
  Delete,
  Query,
  UseGuards,
} from '@nestjs/common';
import { ZodResponse } from 'nestjs-zod';
import { SermonService } from './sermon.service';
import { CreateSermonDto } from './dto/create-sermon.dto';
import { UpdateSermonDto } from './dto/update-sermon.dto';
import { FindAllSermonsQueryDto } from './dto/find-all-sermons-query.dto';
import { SermonResponseDto } from './dto/sermon-response.dto';
import { AllSermonsResponseDto } from './dto/all-sermons-response.dto';
import { StreamUrlResponseDto } from './dto/stream-url-response.dto';
import { StatusSermonResponseDto } from './dto/status-sermon-response.dto';
import { DistinctValuesResponseDto } from './dto/distinct-values-response.dto';
import { AuthGuard } from '../auth/guard/auth.guard';
import { RolesGuard } from '../auth/guard/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { UserRole } from '../users/user-role.enum';
import { IdParamDto } from '../shared/dto/id-param.dto';

@Controller('sermons')
export class SermonController {
  constructor(private readonly sermonService: SermonService) {}

  @Post()
  @Roles(UserRole.Admin, UserRole.Moderator)
  @UseGuards(AuthGuard, RolesGuard)
  @ZodResponse({ type: SermonResponseDto })
  async create(
    @Body() createSermonDto: CreateSermonDto,
  ): Promise<SermonResponseDto> {
    return await this.sermonService.create(createSermonDto);
  }

  @Get()
  @ZodResponse({ type: AllSermonsResponseDto })
  async findAll(
    @Query() query: FindAllSermonsQueryDto,
  ): Promise<AllSermonsResponseDto> {
    return await this.sermonService.findAll(
      query.take,
      query.cursor,
      query.search,
      query.page,
      query.limit,
      query.sort,
      query.order,
    );
  }

  // Static route must be declared before @Get(':id') — otherwise "distinct-values"
  // would be captured by the :id param.
  @Get('distinct-values')
  @ZodResponse({ type: DistinctValuesResponseDto })
  async getDistinctValues(): Promise<DistinctValuesResponseDto> {
    return await this.sermonService.getDistinctValues();
  }

  @Get(':id/stream-url')
  @ZodResponse({ type: StreamUrlResponseDto })
  async getStreamUrl(
    @Param() params: IdParamDto,
  ): Promise<StreamUrlResponseDto> {
    return await this.sermonService.getStreamUrl(params.id);
  }

  @Get(':id')
  @ZodResponse({ type: SermonResponseDto })
  async findOne(@Param() params: IdParamDto): Promise<SermonResponseDto> {
    return await this.sermonService.findOne(params.id);
  }

  @Patch(':id')
  @Roles(UserRole.Admin, UserRole.Moderator)
  @UseGuards(AuthGuard, RolesGuard)
  @ZodResponse({ type: StatusSermonResponseDto })
  async update(
    @Param() params: IdParamDto,
    @Body() updateSermonDto: UpdateSermonDto,
  ): Promise<StatusSermonResponseDto> {
    return await this.sermonService.update(params.id, updateSermonDto);
  }

  @Delete(':id')
  @Roles(UserRole.Admin, UserRole.Moderator)
  @UseGuards(AuthGuard, RolesGuard)
  @ZodResponse({ type: StatusSermonResponseDto })
  async remove(@Param() params: IdParamDto): Promise<StatusSermonResponseDto> {
    return await this.sermonService.remove(params.id);
  }
}

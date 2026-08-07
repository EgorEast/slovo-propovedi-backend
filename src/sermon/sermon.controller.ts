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
import { AuthGuard } from '../auth/guard/auth.guard';
import { IdParamDto } from '../shared/dto/id-param.dto';

@Controller('sermons')
export class SermonController {
  constructor(private readonly sermonService: SermonService) {}

  @Post()
  @UseGuards(AuthGuard)
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
    return await this.sermonService.findAll(query.take, query.cursor);
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
  @UseGuards(AuthGuard)
  @ZodResponse({ type: StatusSermonResponseDto })
  async update(
    @Param() params: IdParamDto,
    @Body() updateSermonDto: UpdateSermonDto,
  ): Promise<StatusSermonResponseDto> {
    return await this.sermonService.update(params.id, updateSermonDto);
  }

  @Delete(':id')
  @UseGuards(AuthGuard)
  @ZodResponse({ type: StatusSermonResponseDto })
  async remove(@Param() params: IdParamDto): Promise<StatusSermonResponseDto> {
    return await this.sermonService.remove(params.id);
  }
}

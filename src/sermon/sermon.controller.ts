import {
  Controller,
  Get,
  Post,
  Body,
  Patch,
  Param,
  Delete,
  Query,
  HttpStatus,
  UseGuards,
} from '@nestjs/common';
import { SermonService } from './sermon.service';
import { CreateSermonDto } from './dto/create-sermon.dto';
import { UpdateSermonDto } from './dto/update-sermon.dto';
import { FindAllSermonsQueryDto } from './dto/find-all-sermons-query.dto';
import { ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import { AuthGuard } from '../auth/guard/auth.guard';
import { SermonEntity } from './entities/sermon.entity';
import {
  AllSermonsResponse,
  StatusSermonResponse,
  StreamUrlResponse,
} from './interfaces/interface';

@Controller('sermons')
@ApiTags('Sermons')
export class SermonController {
  constructor(private readonly sermonService: SermonService) {}

  @Post()
  @UseGuards(AuthGuard)
  @ApiOperation({
    summary: 'Create sermon',
  })
  @ApiResponse({
    status: HttpStatus.OK,
    type: SermonEntity,
  })
  async create(
    @Body() createSermonDto: CreateSermonDto,
  ): Promise<SermonEntity> {
    return await this.sermonService.create(createSermonDto);
  }

  @Get()
  @ApiOperation({
    summary: 'Get all sermons',
  })
  @ApiResponse({
    status: HttpStatus.OK,
    type: AllSermonsResponse,
  })
  async findAll(
    @Query() query: FindAllSermonsQueryDto,
  ): Promise<AllSermonsResponse> {
    return await this.sermonService.findAll(query.take, query.cursor);
  }

  @Get(':id/stream-url')
  @ApiOperation({
    summary: 'Get a presigned streaming URL for a sermon audio',
  })
  @ApiResponse({
    status: HttpStatus.OK,
    type: StreamUrlResponse,
  })
  async getStreamUrl(@Param('id') id: string): Promise<StreamUrlResponse> {
    return await this.sermonService.getStreamUrl(id);
  }

  @Get(':id')
  @ApiOperation({
    summary: 'Get one sermon by id',
  })
  @ApiResponse({
    status: HttpStatus.OK,
    type: SermonEntity,
  })
  async findOne(@Param('id') id: string): Promise<SermonEntity> {
    return await this.sermonService.findOne(id);
  }

  @Patch(':id')
  @UseGuards(AuthGuard)
  @ApiOperation({
    summary: 'Update one sermon by id',
  })
  @ApiResponse({
    status: HttpStatus.OK,
    type: StatusSermonResponse,
  })
  async update(
    @Param('id') id: string,
    @Body() updateSermonDto: UpdateSermonDto,
  ): Promise<StatusSermonResponse> {
    return await this.sermonService.update(id, updateSermonDto);
  }

  @Delete(':id')
  @UseGuards(AuthGuard)
  @ApiOperation({
    summary: 'Delete one sermon by id',
  })
  @ApiResponse({
    status: HttpStatus.OK,
    type: StatusSermonResponse,
  })
  async remove(@Param('id') id: string): Promise<StatusSermonResponse> {
    return await this.sermonService.remove(id);
  }
}

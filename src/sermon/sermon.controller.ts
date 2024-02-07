import {
  Controller,
  Get,
  Post,
  Body,
  Patch,
  Param,
  Delete,
  HttpStatus,
} from '@nestjs/common';
import { SermonService } from './sermon.service';
import { CreateSermonDto } from './dto/create-sermon.dto';
import { UpdateSermonDto } from './dto/update-sermon.dto';
import { ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import { SermonEntity } from './entities/sermon.entity';
import {
  AllSermonsResponse,
  StatusSermonResponse,
} from './interfaces/interface';

@Controller('sermons')
@ApiTags('Sermons')
export class SermonController {
  constructor(private readonly sermonService: SermonService) {}

  @Post()
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
  async findAll(): Promise<AllSermonsResponse> {
    return await this.sermonService.findAll();
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

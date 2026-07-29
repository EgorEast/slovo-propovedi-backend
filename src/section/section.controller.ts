import {
  Controller,
  Get,
  Post,
  Body,
  Patch,
  Param,
  Delete,
  HttpStatus,
  UseGuards,
} from '@nestjs/common';
import { SectionService } from './section.service';
import { CreateSectionDto } from './dto/create-section.dto';
import { UpdateSectionDto } from './dto/update-section.dto';
import { SectionEntity } from './entities/section.entity';
import { ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import { AuthGuard } from '../auth/guard/auth.guard';

import {
  AllSectionsResponse,
  StatusSectionsResponse,
} from './interfacies/interface';

@Controller('section')
@ApiTags('Sections')
export class SectionController {
  constructor(private readonly sectionService: SectionService) {}

  @Post()
  @UseGuards(AuthGuard)
  @ApiOperation({
    summary: 'Create section',
  })
  @ApiResponse({
    status: HttpStatus.OK,
    type: SectionEntity,
  })
  async create(
    @Body() createSectionDto: CreateSectionDto,
  ): Promise<SectionEntity> {
    return await this.sectionService.createSectionItem(createSectionDto);
  }

  @Get()
  @ApiOperation({
    summary: 'Get all sections',
  })
  @ApiResponse({
    status: HttpStatus.OK,
    type: AllSectionsResponse,
  })
  async findAll(): Promise<AllSectionsResponse> {
    return await this.sectionService.findAllSectionItems();
  }

  @Get(':id')
  @ApiOperation({
    summary: 'Get one section by id',
  })
  @ApiResponse({
    status: HttpStatus.OK,
    type: SectionEntity,
  })
  async findOne(@Param('id') id: string): Promise<SectionEntity> {
    return await this.sectionService.findOneSectionItem(id);
  }

  @Patch(':id')
  @UseGuards(AuthGuard)
  @ApiOperation({
    summary: 'Update one section by id',
  })
  @ApiResponse({
    status: HttpStatus.OK,
    type: SectionEntity,
  })
  async update(
    @Param('id') id: string,
    @Body() updateSectionDto: UpdateSectionDto,
  ): Promise<SectionEntity> {
    return await this.sectionService.update(id, updateSectionDto);
  }

  @Delete(':id')
  @UseGuards(AuthGuard)
  @ApiOperation({
    summary: 'Delete one section by id',
  })
  @ApiResponse({
    status: HttpStatus.OK,
    type: StatusSectionsResponse,
  })
  async remove(@Param('id') id: string): Promise<StatusSectionsResponse> {
    return await this.sectionService.remove(id);
  }
}

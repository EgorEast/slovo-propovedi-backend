import {
  Controller,
  Get,
  Post,
  Body,
  Patch,
  Param,
  Delete,
} from '@nestjs/common';
import { SectionService } from './section.service';
import { CreateSectionDto } from './dto/create-section.dto';
import { UpdateSectionDto } from './dto/update-section.dto';

@Controller('section')
export class SectionController {
  constructor(private readonly sectionService: SectionService) {}

  @Post()
  async create(@Body() createSectionDto: CreateSectionDto) {
    return await this.sectionService.createSectionItem(createSectionDto);
  }

  @Get()
  async findAll() {
    return await this.sectionService.findAllSectionItems();
  }

  @Get(':id')
  async findOne(@Param('id') id: string) {
    return await this.sectionService.findOneSectionItem(id);
  }

  @Patch(':id')
  async update(
    @Param('id') id: string,
    @Body() updateSectionDto: UpdateSectionDto,
  ) {
    return await this.sectionService.update(id, updateSectionDto);
  }

  @Delete(':id')
  async remove(@Param('id') id: string) {
    return await this.sectionService.remove(id);
  }
}

import {
  Controller,
  Get,
  Post,
  Body,
  Patch,
  Param,
  Delete,
  UseGuards,
} from '@nestjs/common';
import { SectionService } from './section.service';
import { CreateSectionDto } from './dto/create-section.dto';
import { UpdateSectionDto } from './dto/update-section.dto';
import { ReorderSectionsDto } from './dto/reorder-sections.dto';
import { ReorderPlaylistsInSectionDto } from './dto/reorder-playlists-in-section.dto';
import { SectionResponseDto } from './dto/section-response.dto';
import { AllSectionsResponseDto } from './dto/all-sections-response.dto';
import { StatusSectionResponseDto } from './dto/status-section-response.dto';
import { AuthGuard } from '../auth/guard/auth.guard';
import { RolesGuard } from '../auth/guard/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { UserRole } from '../users/user-role.enum';
import { ZodResponse } from 'nestjs-zod';
import { IdParamDto } from '../shared/dto/id-param.dto';

@Controller('section')
export class SectionController {
  constructor(private readonly sectionService: SectionService) {}

  @Post()
  @Roles(UserRole.Admin, UserRole.Moderator)
  @UseGuards(AuthGuard, RolesGuard)
  @ZodResponse({ type: SectionResponseDto })
  async create(@Body() createSectionDto: CreateSectionDto) {
    return await this.sectionService.createSectionItem(createSectionDto);
  }

  @Get()
  @ZodResponse({ type: AllSectionsResponseDto })
  findAll() {
    return this.sectionService.findAllSectionItems();
  }

  @Get(':id')
  @ZodResponse({ type: SectionResponseDto })
  findOne(@Param() params: IdParamDto) {
    return this.sectionService.findOneSectionItem(params.id);
  }

  // Must be declared before @Patch(':id') so 'reorder' is not swallowed as an id.
  @Patch('reorder')
  @Roles(UserRole.Admin, UserRole.Moderator)
  @UseGuards(AuthGuard, RolesGuard)
  @ZodResponse({ type: StatusSectionResponseDto })
  async reorder(@Body() reorderSectionsDto: ReorderSectionsDto) {
    return this.sectionService.reorderSections(reorderSectionsDto.ids);
  }

  @Patch(':id/playlists/reorder')
  @Roles(UserRole.Admin, UserRole.Moderator)
  @UseGuards(AuthGuard, RolesGuard)
  @ZodResponse({ type: StatusSectionResponseDto })
  async reorderPlaylistsInSection(
    @Param() params: IdParamDto,
    @Body() reorderPlaylistsInSectionDto: ReorderPlaylistsInSectionDto,
  ) {
    return this.sectionService.reorderPlaylistsInSection(
      params.id,
      reorderPlaylistsInSectionDto.playlistIds,
    );
  }

  @Patch(':id')
  @Roles(UserRole.Admin, UserRole.Moderator)
  @UseGuards(AuthGuard, RolesGuard)
  @ZodResponse({ type: SectionResponseDto })
  update(
    @Param() params: IdParamDto,
    @Body() updateSectionDto: UpdateSectionDto,
  ) {
    return this.sectionService.update(params.id, updateSectionDto);
  }

  @Delete(':id')
  @Roles(UserRole.Admin, UserRole.Moderator)
  @UseGuards(AuthGuard, RolesGuard)
  @ZodResponse({ type: StatusSectionResponseDto })
  remove(@Param() params: IdParamDto) {
    return this.sectionService.remove(params.id);
  }
}

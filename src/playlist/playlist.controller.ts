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
import { PlaylistService } from './playlist.service';
import { CreatePlaylistDto } from './dto/create-playlist.dto';
import { UpdatePlaylistDto } from './dto/update-playlist.dto';
import { FindAllPlaylistsQueryDto } from './dto/find-all-playlists-query.dto';
import { ReorderSermonsInPlaylistDto } from './dto/reorder-sermons-in-playlist.dto';
import { PlaylistResponseDto } from './dto/playlist-response.dto';
import { AllPlaylistsResponseDto } from './dto/all-playlists-response.dto';
import { StatusPlaylistResponseDto } from './dto/status-playlist-response.dto';
import { AuthGuard } from '../auth/guard/auth.guard';
import { RolesGuard } from '../auth/guard/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { UserRole } from '../users/user-role.enum';
import { ZodResponse } from 'nestjs-zod';
import { IdParamDto } from '../shared/dto/id-param.dto';

@Controller('playlists')
export class PlaylistController {
  constructor(private readonly playlistService: PlaylistService) {}

  @Post()
  @Roles(UserRole.Admin, UserRole.Moderator)
  @UseGuards(AuthGuard, RolesGuard)
  @ZodResponse({ type: PlaylistResponseDto })
  async create(@Body() createPlaylistDto: CreatePlaylistDto) {
    return await this.playlistService.create(createPlaylistDto);
  }

  @Get()
  @ZodResponse({ type: AllPlaylistsResponseDto })
  async findAll(@Query() query: FindAllPlaylistsQueryDto) {
    return await this.playlistService.findAll(
      query.search,
      query.page,
      query.limit,
      query.sort,
      query.order,
    );
  }

  @Get(':id')
  @ZodResponse({ type: PlaylistResponseDto })
  async findOne(@Param() params: IdParamDto) {
    return await this.playlistService.findOne(params.id);
  }

  @Patch(':id/sermons/reorder')
  @Roles(UserRole.Admin, UserRole.Moderator)
  @UseGuards(AuthGuard, RolesGuard)
  @ZodResponse({ type: StatusPlaylistResponseDto })
  async reorderSermons(
    @Param() params: IdParamDto,
    @Body() reorderSermonsInPlaylistDto: ReorderSermonsInPlaylistDto,
  ) {
    return this.playlistService.reorderSermonsInPlaylist(
      params.id,
      reorderSermonsInPlaylistDto.sermonIds,
    );
  }

  @Patch(':id')
  @Roles(UserRole.Admin, UserRole.Moderator)
  @UseGuards(AuthGuard, RolesGuard)
  @ZodResponse({ type: PlaylistResponseDto })
  async update(
    @Param() params: IdParamDto,
    @Body() updatePlaylistDto: UpdatePlaylistDto,
  ) {
    return await this.playlistService.update(params.id, updatePlaylistDto);
  }

  @Delete(':id')
  @Roles(UserRole.Admin, UserRole.Moderator)
  @UseGuards(AuthGuard, RolesGuard)
  @ZodResponse({ type: StatusPlaylistResponseDto })
  async remove(@Param() params: IdParamDto) {
    return await this.playlistService.remove(params.id);
  }
}

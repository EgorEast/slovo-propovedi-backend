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
import { PlaylistService } from './playlist.service';
import { CreatePlaylistDto } from './dto/create-playlist.dto';
import { UpdatePlaylistDto } from './dto/update-playlist.dto';
import { ReorderSermonsInPlaylistDto } from './dto/reorder-sermons-in-playlist.dto';
import { PlaylistResponseDto } from './dto/playlist-response.dto';
import { AllPlaylistsResponseDto } from './dto/all-playlists-response.dto';
import { StatusPlaylistResponseDto } from './dto/status-playlist-response.dto';
import { AuthGuard } from '../auth/guard/auth.guard';
import { ZodResponse } from 'nestjs-zod';
import { IdParamDto } from '../shared/dto/id-param.dto';

@Controller('playlists')
export class PlaylistController {
  constructor(private readonly playlistService: PlaylistService) {}

  @Post()
  @UseGuards(AuthGuard)
  @ZodResponse({ type: PlaylistResponseDto })
  async create(@Body() createPlaylistDto: CreatePlaylistDto) {
    return await this.playlistService.create(createPlaylistDto);
  }

  @Get()
  @ZodResponse({ type: AllPlaylistsResponseDto })
  async findAll() {
    return await this.playlistService.findAll();
  }

  @Get(':id')
  @ZodResponse({ type: PlaylistResponseDto })
  async findOne(@Param() params: IdParamDto) {
    return await this.playlistService.findOne(params.id);
  }

  @Patch(':id/sermons/reorder')
  @UseGuards(AuthGuard)
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
  @UseGuards(AuthGuard)
  @ZodResponse({ type: PlaylistResponseDto })
  async update(
    @Param() params: IdParamDto,
    @Body() updatePlaylistDto: UpdatePlaylistDto,
  ) {
    return await this.playlistService.update(params.id, updatePlaylistDto);
  }

  @Delete(':id')
  @UseGuards(AuthGuard)
  @ZodResponse({ type: StatusPlaylistResponseDto })
  async remove(@Param() params: IdParamDto) {
    return await this.playlistService.remove(params.id);
  }
}

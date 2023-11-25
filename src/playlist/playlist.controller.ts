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
import { PlaylistService } from './playlist.service';
import { CreatePlaylistDto } from './dto/create-playlist.dto';
import { UpdatePlaylistDto } from './dto/update-playlist.dto';
import { ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import { PlaylistEntity } from './entities/playlist.entity';
import { DeleteResult } from 'typeorm';

@Controller('playlists')
@ApiTags('Playlists')
export class PlaylistController {
  constructor(private readonly playlistService: PlaylistService) {}

  @Post()
  @ApiOperation({
    summary: 'Create playlist',
  })
  @ApiResponse({
    status: HttpStatus.OK,
    type: PlaylistEntity,
  })
  async create(
    @Body() createPlaylistDto: CreatePlaylistDto,
  ): Promise<PlaylistEntity> {
    return await this.playlistService.create(createPlaylistDto);
  }

  @Get()
  async findAll(): Promise<[PlaylistEntity[], number]> {
    return await this.playlistService.findAll();
  }

  @Get(':id')
  async findOne(@Param('id') id: string): Promise<PlaylistEntity> {
    return await this.playlistService.findOne(id);
  }

  @Patch(':id')
  async update(
    @Param('id') id: string,
    @Body() updatePlaylistDto: UpdatePlaylistDto,
  ): Promise<{ status: 'success' }> {
    return await this.playlistService.update(id, updatePlaylistDto);
  }

  @Delete(':id')
  async remove(@Param('id') id: string): Promise<DeleteResult> {
    return await this.playlistService.remove(id);
  }
}

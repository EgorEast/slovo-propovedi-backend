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
import {
  AllPlaylistsResponse,
  StatusPlaylistResponse,
} from './interfaces/interface';

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
  @ApiOperation({
    summary: 'Get all playlists',
  })
  @ApiResponse({
    status: HttpStatus.OK,
    type: AllPlaylistsResponse,
  })
  async findAll(): Promise<AllPlaylistsResponse> {
    return await this.playlistService.findAll();
  }

  @Get(':id')
  @ApiOperation({
    summary: 'Get one playlist by id',
  })
  @ApiResponse({
    status: HttpStatus.OK,
    type: PlaylistEntity,
  })
  async findOne(@Param('id') id: string): Promise<PlaylistEntity> {
    return await this.playlistService.findOne(id);
  }

  @Patch(':id')
  @ApiOperation({
    summary: 'Update one playlist by id',
  })
  @ApiResponse({
    status: HttpStatus.OK,
    type: PlaylistEntity,
  })
  async update(
    @Param('id') id: string,
    @Body() updatePlaylistDto: UpdatePlaylistDto,
  ): Promise<PlaylistEntity> {
    return await this.playlistService.update(id, updatePlaylistDto);
  }

  @Delete(':id')
  @ApiOperation({
    summary: 'Delete one playlist by id',
  })
  @ApiResponse({
    status: HttpStatus.OK,
    type: StatusPlaylistResponse,
  })
  async remove(@Param('id') id: string): Promise<StatusPlaylistResponse> {
    return await this.playlistService.remove(id);
  }
}

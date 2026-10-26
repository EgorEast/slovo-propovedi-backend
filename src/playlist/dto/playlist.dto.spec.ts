import { CreatePlaylistDto } from './create-playlist.dto';
import { UpdatePlaylistDto } from './update-playlist.dto';

const baseBody = {
  title: 'Плейлист',
  description: null,
  artwork: '',
  sermonsIds: [],
};

describe('Playlist DTO artwork', () => {
  it.each(['javascript:alert(1)', 'data:image/svg+xml,<svg/>'])(
    'rejects a dangerous artwork scheme %p',
    (artwork) => {
      expect(
        CreatePlaylistDto.schema.safeParse({ ...baseBody, artwork }).success,
      ).toBe(false);
      expect(
        UpdatePlaylistDto.schema.safeParse({ ...baseBody, artwork }).success,
      ).toBe(false);
    },
  );

  it.each(['', 'https://minio.example.com/files/a.png'])(
    'accepts artwork %p',
    (artwork) => {
      expect(
        CreatePlaylistDto.schema.safeParse({ ...baseBody, artwork }).success,
      ).toBe(true);
    },
  );
});

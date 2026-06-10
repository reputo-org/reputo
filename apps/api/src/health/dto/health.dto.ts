import { ApiProperty } from '@nestjs/swagger';

export class HealthDto {
  @ApiProperty({ example: 'ok' })
  status!: string;

  @ApiProperty({
    description: 'Git commit SHA baked into the image at build time (GIT_SHA build arg)',
    example: '4f9c2d7e8a1b3c5d6e7f8a9b0c1d2e3f4a5b6c7d',
  })
  sha!: string;
}

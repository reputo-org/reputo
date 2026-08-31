import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsOptional, IsString } from 'class-validator';

/**
 * Query GitHub appends to the App's setup URL. The installation id is confirmed
 * with the app JWT before anything is stored, so a tampered redirect names an
 * installation GitHub will not vouch for; the fields must still be declared so
 * the global whitelist pipe does not reject the callback.
 */
export class GitHubCallbackQueryDto {
  @ApiPropertyOptional({ description: 'Installation the App was installed into, as GitHub reports it.' })
  @IsString()
  @IsOptional()
  installation_id?: string;

  @ApiPropertyOptional({ description: 'Whether the App was installed, updated, or only requested from an owner.' })
  @IsString()
  @IsOptional()
  setup_action?: string;

  @ApiPropertyOptional({
    description:
      'User authorization code, appended when the App requests OAuth during installation. Informational: the installation is confirmed with the app JWT, never with this code.',
  })
  @IsString()
  @IsOptional()
  code?: string;

  @ApiPropertyOptional({ description: 'Signed install state issued by this API.' })
  @IsString()
  @IsOptional()
  state?: string;

  @ApiPropertyOptional({ description: 'Error code when the admin cancelled or GitHub refused.' })
  @IsString()
  @IsOptional()
  error?: string;

  @ApiPropertyOptional({ description: 'Human-readable error detail from GitHub.' })
  @IsString()
  @IsOptional()
  error_description?: string;
}

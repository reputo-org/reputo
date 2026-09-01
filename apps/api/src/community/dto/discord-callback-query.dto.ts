import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsOptional, IsString } from 'class-validator';

/**
 * Query Discord appends to the bot install callback. `guild_id` and
 * `permissions` are informational — the guild is read from the token exchange,
 * which cannot be forged by editing the redirect — but they must be declared so
 * the global whitelist pipe does not reject the callback.
 */
export class DiscordCallbackQueryDto {
  @ApiPropertyOptional({ description: 'Authorization code to exchange.' })
  @IsString()
  @IsOptional()
  code?: string;

  @ApiPropertyOptional({ description: 'Signed install state issued by this API.' })
  @IsString()
  @IsOptional()
  state?: string;

  @ApiPropertyOptional({ description: 'Guild the bot was installed into, as Discord reports it.' })
  @IsString()
  @IsOptional()
  guild_id?: string;

  @ApiPropertyOptional({ description: 'Permissions integer granted to the bot.' })
  @IsString()
  @IsOptional()
  permissions?: string;

  @ApiPropertyOptional({ description: 'Error code when the admin cancelled or Discord refused.' })
  @IsString()
  @IsOptional()
  error?: string;

  @ApiPropertyOptional({ description: 'Human-readable error detail from Discord.' })
  @IsString()
  @IsOptional()
  error_description?: string;
}

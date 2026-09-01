import { ApiProperty } from '@nestjs/swagger';
import type {
  MattermostConnectRequestDto as MattermostConnectRequestContract,
  MattermostTeamDto as MattermostTeamContract,
  MattermostValidateRequestDto as MattermostValidateRequestContract,
  MattermostValidationDto as MattermostValidationContract,
} from '@reputo/contracts';
import { IsNotEmpty, IsString, MaxLength } from 'class-validator';

/**
 * Deliberately light validation: the safe outbound fetch is the security
 * boundary for the URL, and stricter DTO rules would only produce a second,
 * weaker copy of it.
 */
export class MattermostValidateRequestDto implements MattermostValidateRequestContract {
  @ApiProperty({ description: 'Mattermost server URL; normalized to its origin.', example: 'https://chat.example.com' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(2048)
  serverUrl: string;

  @ApiProperty({ description: 'Bot access token. Sent for validation only; never returned or logged.' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(2048)
  token: string;
}

export class MattermostConnectRequestDto
  extends MattermostValidateRequestDto
  implements MattermostConnectRequestContract
{
  @ApiProperty({ description: 'Team to connect, from the validate response.', example: '48b3dhqf3ib1zpgpm8osdd66pc' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(64)
  teamId: string;
}

export class MattermostTeamDto implements MattermostTeamContract {
  @ApiProperty({ description: 'Team identifier.', example: '48b3dhqf3ib1zpgpm8osdd66pc' })
  id: string;

  @ApiProperty({ description: 'URL slug of the team.', example: 'singularitynet' })
  name: string;

  @ApiProperty({ description: 'Name the server shows for the team.', example: 'SingularityNET' })
  displayName: string;
}

export class MattermostValidationDto implements MattermostValidationContract {
  @ApiProperty({ description: "Teams the token's bot account belongs to.", type: [MattermostTeamDto] })
  teams: MattermostTeamDto[];
}

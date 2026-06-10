import { Controller, Get } from '@nestjs/common';
import { ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Public } from '../shared/decorators';
import { HealthDto } from './dto';

@ApiTags('Health')
@Controller('health')
export class HealthController {
  @Get()
  @Public()
  @ApiOperation({
    summary: 'Liveness probe with build info',
    description:
      'Public endpoint used by container healthchecks and the deploy pipeline. ' +
      'Reports the git commit SHA the running image was built from, so a deploy ' +
      'can be verified end to end.',
  })
  @ApiOkResponse({ type: HealthDto })
  check(): HealthDto {
    return {
      status: 'ok',
      sha: process.env.GIT_SHA || 'unknown',
    };
  }
}

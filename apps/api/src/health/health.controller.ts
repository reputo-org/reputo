import { Controller, Get } from '@nestjs/common';
import { ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Public } from '../shared/decorators';
import { ApiWorkerStatus, TemporalService } from '../temporal';
import { HealthDto } from './dto';

@ApiTags('Health')
@Controller('health')
export class HealthController {
  constructor(
    private readonly temporalService: TemporalService,
    private readonly workerStatus: ApiWorkerStatus,
  ) {}

  @Get()
  @Public()
  @ApiOperation({
    summary: 'Liveness probe with build info',
    description:
      'Public endpoint used by container healthchecks and the deploy pipeline. ' +
      'Reports the git commit SHA the running image was built from, so a deploy ' +
      'can be verified end to end. The `temporal` and `worker` fields are ' +
      'informational only: `status` stays "ok" while the HTTP server is alive, ' +
      'because Traefik drops containers whose healthcheck fails and a Temporal ' +
      'outage must not take read endpoints down with it.',
  })
  @ApiOkResponse({ type: HealthDto })
  check(): HealthDto {
    return {
      status: 'ok',
      sha: process.env.GIT_SHA || 'unknown',
      temporal: this.temporalService.getAvailability(),
      worker: this.workerStatus.get(),
    };
  }
}

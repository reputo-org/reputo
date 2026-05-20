import { ConfigService } from '@nestjs/config';
import { createS3Client } from '@reputo/storage';

export const S3_CLIENT = Symbol('S3_CLIENT');

export const s3ClientProvider = {
  provide: S3_CLIENT,
  inject: [ConfigService],
  useFactory: (configService: ConfigService) => {
    return createS3Client({
      region: configService.get<string>('aws.region') as string,
      endpoint: configService.get<string>('aws.s3Endpoint') || undefined,
      forcePathStyle: configService.get<boolean>('aws.s3ForcePathStyle'),
    });
  },
};

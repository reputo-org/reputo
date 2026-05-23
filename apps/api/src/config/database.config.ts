import { registerAs } from '@nestjs/config';
import * as Joi from 'joi';

export default registerAs('database', () => ({
  url: process.env.DATABASE_URL,
}));

export const databaseConfigSchema = {
  DATABASE_URL: Joi.string()
    .uri({ scheme: ['postgresql', 'postgres'] })
    .required()
    .description('PostgreSQL connection URL for the API application database (consumed by TypeORM)'),
};

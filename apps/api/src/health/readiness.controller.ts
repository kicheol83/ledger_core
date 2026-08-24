import { Controller, Get, HttpStatus, Inject, Res } from '@nestjs/common';
import type { Response } from 'express';
import type { Pool } from 'pg';
import { PG_POOL } from '../shared/database/executor.js';

interface ReadinessReport {
  status: 'ready' | 'not_ready';
  checks: {
    database: { ok: boolean; latencyMs?: number; error?: string };
  };
  pool: { total: number; idle: number; waiting: number };
}

@Controller('health')
export class ReadinessController {
  constructor(@Inject(PG_POOL) private readonly pool: Pool) {}

  @Get('ready')
  async ready(@Res() response: Response): Promise<void> {
    const startedAt = process.hrtime.bigint();
    const report: ReadinessReport = {
      status: 'ready',
      checks: { database: { ok: true } },
      pool: {
        total: this.pool.totalCount,
        idle: this.pool.idleCount,

        waiting: this.pool.waitingCount,
      },
    };

    try {
      await this.pool.query('SELECT 1');
      report.checks.database.latencyMs = Number(process.hrtime.bigint() - startedAt) / 1_000_000;
    } catch (error) {
      report.status = 'not_ready';
      report.checks.database = { ok: false, error: (error as Error).message };
    }

    response
      .status(report.status === 'ready' ? HttpStatus.OK : HttpStatus.SERVICE_UNAVAILABLE)
      .json(report);
  }
}

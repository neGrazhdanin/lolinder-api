import { WorkerHost } from '@nestjs/bullmq';
import { type BeforeApplicationShutdown, Injectable } from '@nestjs/common';
import { DiscoveryService } from '@nestjs/core';

// @nestjs/bullmq closes workers in onApplicationShutdown, after shared clients may already be gone.
// Closing them first lets active jobs finish while Redis and Prisma are still connected.
@Injectable()
export class WorkerShutdown implements BeforeApplicationShutdown {
  constructor(private readonly discovery: DiscoveryService) {}

  async beforeApplicationShutdown(): Promise<void> {
    const hosts = this.discovery
      .getProviders()
      .map((wrapper) => wrapper.instance as unknown)
      .filter((instance): instance is WorkerHost => instance instanceof WorkerHost);
    await Promise.all(hosts.map((host) => host.worker.close()));
  }
}

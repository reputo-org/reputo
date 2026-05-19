import { Injectable, OnApplicationBootstrap } from '@nestjs/common';
import { AdminService } from './admin.service';

@Injectable()
export class AdminOwnerSeeder implements OnApplicationBootstrap {
  constructor(private readonly adminService: AdminService) {}

  onApplicationBootstrap(): Promise<void> {
    return this.adminService.seedOwner();
  }
}

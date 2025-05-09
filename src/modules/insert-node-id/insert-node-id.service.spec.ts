import { Test, TestingModule } from '@nestjs/testing';
import { InsertNodeIdService } from './insert-node-id.service';

describe('InsertNodeIdService', () => {
  let service: InsertNodeIdService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [InsertNodeIdService],
    }).compile();

    service = module.get<InsertNodeIdService>(InsertNodeIdService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });
});

import { Test, TestingModule } from '@nestjs/testing';
import { InsertNodeLinkDataService } from './insert-node-link-data.service';

describe('InsertNodeLinkDataService', () => {
  let service: InsertNodeLinkDataService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [InsertNodeLinkDataService],
    }).compile();

    service = module.get<InsertNodeLinkDataService>(InsertNodeLinkDataService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });
});

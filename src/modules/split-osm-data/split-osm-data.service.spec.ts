import { Test, TestingModule } from '@nestjs/testing';
import { SplitOsmDataService } from './split-osm-data.service';

describe('SplitOsmDataService', () => {
  let service: SplitOsmDataService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [SplitOsmDataService],
    }).compile();

    service = module.get<SplitOsmDataService>(SplitOsmDataService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });
});

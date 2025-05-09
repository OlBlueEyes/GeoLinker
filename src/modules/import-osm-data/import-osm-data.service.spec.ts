import { Test, TestingModule } from '@nestjs/testing';
import { ImportOsmDataService } from './import-osm-data.service';

describe('ImportOsmDataService', () => {
  let service: ImportOsmDataService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [ImportOsmDataService],
    }).compile();

    service = module.get<ImportOsmDataService>(ImportOsmDataService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });
});

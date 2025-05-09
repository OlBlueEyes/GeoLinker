import { Test, TestingModule } from '@nestjs/testing';
import { MapMatchingService } from './map-matching.service';

describe('MapMatchingService', () => {
  let service: MapMatchingService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [MapMatchingService],
    }).compile();

    service = module.get<MapMatchingService>(MapMatchingService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });
});

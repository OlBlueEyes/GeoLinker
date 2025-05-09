import { Test, TestingModule } from '@nestjs/testing';
import { MapMatchingController } from './map-matching.controller';

describe('MapMatchingController', () => {
  let controller: MapMatchingController;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [MapMatchingController],
    }).compile();

    controller = module.get<MapMatchingController>(MapMatchingController);
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });
});

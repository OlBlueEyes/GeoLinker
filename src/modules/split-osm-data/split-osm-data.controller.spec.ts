import { Test, TestingModule } from '@nestjs/testing';
import { SplitOsmDataController } from './split-osm-data.controller';

describe('SplitOsmDataController', () => {
  let controller: SplitOsmDataController;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [SplitOsmDataController],
    }).compile();

    controller = module.get<SplitOsmDataController>(SplitOsmDataController);
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });
});

import { Test, TestingModule } from '@nestjs/testing';
import { ImportOsmDataController } from './import-osm-data.controller';

describe('ImportOsmDataController', () => {
  let controller: ImportOsmDataController;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [ImportOsmDataController],
    }).compile();

    controller = module.get<ImportOsmDataController>(ImportOsmDataController);
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });
});

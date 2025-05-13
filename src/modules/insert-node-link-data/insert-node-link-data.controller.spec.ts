import { Test, TestingModule } from '@nestjs/testing';
import { InsertNodeLinkDataController } from './insert-node-link-data.controller';

describe('InsertNodeLinkDataController', () => {
  let controller: InsertNodeLinkDataController;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [InsertNodeLinkDataController],
    }).compile();

    controller = module.get<InsertNodeLinkDataController>(InsertNodeLinkDataController);
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });
});

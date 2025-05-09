import { Test, TestingModule } from '@nestjs/testing';
import { InsertNodeIdController } from './insert-node-id.controller';

describe('InsertNodeIdController', () => {
  let controller: InsertNodeIdController;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [InsertNodeIdController],
    }).compile();

    controller = module.get<InsertNodeIdController>(InsertNodeIdController);
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });
});

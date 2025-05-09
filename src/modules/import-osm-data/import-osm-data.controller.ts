import { Controller } from '@nestjs/common';
import { Post } from '@nestjs/common';
import { ImportOsmDataService } from './import-osm-data.service';

@Controller('import-osm-data')
export class ImportOsmDataController {
  constructor(private readonly importOsmData: ImportOsmDataService) {}

  // Final Import Code
  @Post('importOsmData')
  async processNodeLinkData(): Promise<void> {
    await this.importOsmData.processNodeLinkData();
  }
}

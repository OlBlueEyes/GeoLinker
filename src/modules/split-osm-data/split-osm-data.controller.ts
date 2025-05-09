import { Controller } from '@nestjs/common';
import { SplitOsmDataService } from './split-osm-data.service';
import { Post } from '@nestjs/common';

@Controller('split-osm-data')
export class SplitOsmDataController {
  constructor(private readonly splitOsmData: SplitOsmDataService) {}

  // Final Split Code
  @Post('splitOsmData')
  async processSplitForAllAreas(): Promise<void> {
    await this.splitOsmData.processSplitForAllAreas();
  }
}

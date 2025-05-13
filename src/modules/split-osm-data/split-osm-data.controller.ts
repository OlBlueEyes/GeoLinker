import { Controller, Param } from '@nestjs/common';
import { SplitOsmDataService } from './split-osm-data.service';
import { Post } from '@nestjs/common';

@Controller('split-osm-data')
export class SplitOsmDataController {
  constructor(private readonly splitOsmData: SplitOsmDataService) {}

  // Final Split Code
  @Post('splitOsmData/:countryName')
  async processSplitForCountry(
    @Param('countryName') countryName: string,
  ): Promise<void> {
    await this.splitOsmData.processSplitForAllAreas(countryName);
  }
}

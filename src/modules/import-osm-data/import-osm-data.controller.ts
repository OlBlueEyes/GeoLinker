import { Controller, Param } from '@nestjs/common';
import { Post } from '@nestjs/common';
import { ImportOsmDataService } from './import-osm-data.service';

@Controller('import-osm-data')
export class ImportOsmDataController {
  constructor(private readonly importOsmData: ImportOsmDataService) {}

  // Final Import Code
  @Post('importOsmData/:city')
  async processNodeLinkData(@Param('city') city: string): Promise<void> {
    await this.importOsmData.processNodeLinkData(city);
  }

  @Post('importAdminBoundaries/:countryName')
  async importAdminBoundaries(
    @Param('countryName') countryName: string,
  ): Promise<void> {
    await this.importOsmData.importAdminBoundaries(countryName);
  }
}

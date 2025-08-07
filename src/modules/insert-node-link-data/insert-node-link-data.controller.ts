import { Controller, Param, Post } from '@nestjs/common';
import { InsertNodeLinkDataService } from './insert-node-link-data.service';

@Controller('insert-node-link-data')
export class InsertNodeLinkDataController {
  constructor(private readonly insertOsmData: InsertNodeLinkDataService) {}

  // Final Insert Code
  @Post('insertOsmData/:countryName')
  async insertNodeLinkData(
    @Param('countryName') countryName: string,
  ): Promise<void> {
    await this.insertOsmData.insertAllNodesAndLinks(countryName);
    await this.insertOsmData.insertNodeIdsInFinal();
  }

  @Post('insertNodeIds')
  async insertNodeIds(): Promise<void> {
    await this.insertOsmData.insertNodeIdsInFinal();
  }

  // Insert Admin Boundaries
  @Post('insertAdminBoundaries/:countryName')
  async insertAdminBoundaries(
    @Param('countryName') countryName: string,
  ): Promise<void> {
    await this.insertOsmData.insertAdminBoundariesFromFolder(countryName);
  }
}

import { Controller, Post } from '@nestjs/common';
import { MapMatchingService } from './map-matching.service';
import { AdvancedMapMatching } from 'src/common/utils/map-matcher';

// Map-Matching
@Controller('map-matching')
export class MapMatchingController {
  constructor(
    private readonly mapMatchingService: MapMatchingService,
    private readonly advancedMapMatching: AdvancedMapMatching,
  ) {}

  @Post('mapMatching')
  async matchFramesToLinks(): Promise<void> {
    await this.mapMatchingService.matchFramesByGroup();
  }

  // Advanced-Map-Matching
  @Post('advancedMapMatching')
  async advancedMatchFramesToLinks(): Promise<void> {
    await this.advancedMapMatching.matchFramesByGroup();
  }
}

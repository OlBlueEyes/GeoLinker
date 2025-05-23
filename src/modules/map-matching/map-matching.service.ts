import { InjectRepository } from '@nestjs/typeorm';
import { Injectable } from '@nestjs/common';
import { Link } from 'src/shared/entities/link.entity';
import { Repository } from 'typeorm';
import { Frame } from 'src/shared/entities/frame.entity';
import {
  FrameRow,
  LinkWithOppositeNode,
} from 'src/common/types/map-matching-types.interface';
import { MapMatchingHelper } from 'src/common/utils/map-matching-helper';
import { EnvConfigService } from 'src/config/env-config.service';
import { WINSTON_MODULE_PROVIDER } from 'nest-winston';
import { LoggingUtil } from 'src/common/utils/logger.util';
import { Inject } from '@nestjs/common';
import { Logger } from 'winston';

@Injectable()
export class MapMatchingService {
  // private readonly logger = new Logger(MapMatchingService.name);

  constructor(
    @Inject(WINSTON_MODULE_PROVIDER)
    private readonly logger: Logger,

    @InjectRepository(Link)
    private readonly linkRepository: Repository<Link>,

    @InjectRepository(Frame)
    private readonly frameRepository: Repository<Frame>,

    private readonly loggingUtil: LoggingUtil,
    private readonly mapMatchingHelper: MapMatchingHelper,
    private readonly envConfigService: EnvConfigService,
  ) {}

  async matchFramesByGroup() {
    await this.loggingUtil.logDatabaseInfo();
    type RecordRow = { record_id: number };

    const records = (await this.frameRepository.query(
      `SELECT DISTINCT record_id FROM ${this.envConfigService.schema}.frame WHERE link_id IS NULL ORDER BY record_id ASC;`,
    )) as RecordRow[];

    for (const record of records) {
      const recordId = record.record_id;

      const recordProcessStart = this.loggingUtil.processStartTime(
        `matchFramesByGroup - Record ${recordId}`,
      );
      this.logger.info(`[MAP-MATCHING] Processing record_id: ${recordId}`);
      type FrameRow = { id: number; geom: string; yaw: number };
      const frames = (await this.frameRepository.query(
        `SELECT id, geom, yaw FROM ${this.envConfigService.schema}.frame WHERE record_id = $1 AND link_id IS NULL ORDER BY id ASC;`,
        [recordId],
      )) as FrameRow[];

      type BBoxResultRow = { expanded: string }; // ST_Envelope 결과는 geometry(WKT 혹은 WKB로)

      const bboxResult = (await this.frameRepository.query(
        `SELECT ST_Envelope(ST_Expand(ST_Collect(geom), 0.09)) AS expanded
         FROM ${this.envConfigService.schema}.frame
         WHERE record_id = $1 AND link_id IS NULL;`,
        [recordId],
      )) as BBoxResultRow[];

      const expandedBBox = bboxResult[0]?.expanded;
      this.logger.info(
        `[MAP-MATCHING] expandedBBox: ${JSON.stringify(expandedBBox)}`,
      );

      type LinkRow = {
        linkid: number;
        link_geom: string;
        start_node: number;
        end_node: number;
      };

      const filteredLinks = (await this.linkRepository.query(
        `SELECT id AS linkid, geom AS link_geom, start_node, end_node FROM ${this.envConfigService.schema}.link WHERE ST_Intersects(geom, $1);`,
        [expandedBBox],
      )) as LinkRow[];

      this.logger.info(`[MAP-MATCHING] bboxResult : ${bboxResult.length}`);
      this.logger.info(
        `[MAP-MATCHING] filteredLinks : ${filteredLinks.length}`,
      );
      this.logger.info(`[MAP-MATCHING] Frames : ${frames.length}`);

      let lastProcessedFrameIndex = 0;
      let currentNode: { id: number; geom: string } | null = null;
      while (lastProcessedFrameIndex < frames.length) {
        // 첫 Frame 데이터인 경우에만 findClosestNode 실행
        if (!currentNode) {
          currentNode = await this.mapMatchingHelper.findClosestNode(
            frames[lastProcessedFrameIndex].geom,
          );

          if (!currentNode) {
            this.logger.warn(
              `[MATCHING WARNING] No closest node found for the initial frame. : ${recordId}`,
            );
            return; // 더 이상 처리할 데이터가 없음을 의미
          }
        }
        // Frame 데이터 매칭
        const result = await this.matchFramesToLinks(
          frames,
          lastProcessedFrameIndex,
          currentNode,
          filteredLinks,
        );
        lastProcessedFrameIndex = result.lastProcessedFrameIndex;
        currentNode = result.currentNode; // 업데이트된 currentNode 사용
        this.logger.info(
          `[MAP-MATCHING] lastProcessedFrameIndex : ${lastProcessedFrameIndex} | frames.length : ${frames.length}`,
        );
      }
      this.loggingUtil.processEndTime(
        `matchFramesByGroup - Record ${recordId}`,
        recordProcessStart,
      );
    }
  }
  // 전체 Frame 데이터를 처리하여 각 Frame이 속하는 Link를 매칭
  async matchFramesToLinks(
    frames: FrameRow[],
    lastProcessedFrameIndex: number,
    currentNode: { id: number; geom: string } | null,
    candidateLinks: Array<{
      linkid: number;
      link_geom: string;
      start_node: number;
      end_node: number;
    }>,
  ): Promise<{
    lastProcessedFrameIndex: number;
    currentNode: { id: number; geom: string } | null;
  }> {
    // // 1. 첫 번째 또는 이후 Frame에서 가장 가까운 Node 찾기
    const processingFrameId = frames[lastProcessedFrameIndex]?.id ?? -1;

    this.logger.info(
      `[MAP-MATCHING] Starting matchFramesToLinks with initial currentNode: ${JSON.stringify(currentNode, null, 2)}`,
    );

    if (!currentNode) {
      this.logger.warn(
        `[MATCHING WARNING] No closest node found for the initial frame. : ${processingFrameId}`,
      );
      return {
        lastProcessedFrameIndex: frames.length,
        currentNode: { id: -1, geom: '' }, // 의미 없는 기본값
      };
    }

    this.logger.info(
      `[MAP-MATCHING] Processing from Frame ID ${processingFrameId}`,
    );

    // 2. 현재 Node와 연결된 Link와 각 Link의 반대편 Node 가져오기
    const candidateLinkIds = candidateLinks.map((l) => l.linkid);
    const links: LinkWithOppositeNode[] =
      await this.mapMatchingHelper.getLinksAndOppositeNodesFromCandidates(
        candidateLinkIds,
        currentNode.id,
      );

    this.logger.info(`[MAP-MATCHING] currentNode.id : ${currentNode.id}`);
    this.logger.info(`[MAP-MATCHING] links.length : ${links.length}`);

    const nearbyLinks: LinkWithOppositeNode[] =
      await this.mapMatchingHelper.getNearbyLinksFromCandidates(
        candidateLinkIds,
        frames[lastProcessedFrameIndex].geom,
        currentNode.id,
      );
    this.logger.info(
      `[MAP-MATCHING] nearbyLinks.length : ${nearbyLinks.length}`,
    );
    links.push(...nearbyLinks);

    // 짧은 Link 검사
    const shortLinks: LinkWithOppositeNode[] = [];
    for (const link of links) {
      const length = await this.mapMatchingHelper.calculateLineStringLength(
        link.linkGeom,
      );

      this.logger.info(
        `[MAP-MATCHING] file: matchFrameAndLinkData.ts:138 ~ MatchFrameToLinkData ~ length: ${length} | ${JSON.stringify(link)}`,
      );

      if (length < 7) {
        shortLinks.push(link);
      }
    }
    // 짧은 Link가 있는 경우 해당 반대편 Node에서 추가적인 Link들 가져옴
    for (const shortLink of shortLinks) {
      this.logger.info(
        `[MAP-MATCHING] file: matchFrameAndLinkData.ts:117 ~ MatchFrameToLinkData ~ shortLink:${JSON.stringify(shortLink)},`,
      );
      const oppositeLinks =
        await this.mapMatchingHelper.getLinksAndOppositeNodesFromCandidates(
          candidateLinkIds,
          shortLink.oppositeNode.id,
        );
      this.logger.info(
        `[MAP-MATCHING] oppositeLinks.length : ${oppositeLinks.length}`,
      );

      links.push(...oppositeLinks); // 기존 links에 추가
    }

    // 중복 제거
    const uniqueLinks = this.mapMatchingHelper.removeDuplicateLinks(links);
    this.logger.info(
      `[MAP-MATCHING] Fetched links connected to Node ${currentNode.id}: ${JSON.stringify(uniqueLinks, null, 2)}`,
    );
    // 3. 각 oppositeNode에 대해 LineString 생성 및 변곡점 계산
    const lineStringsWithNodes =
      await this.mapMatchingHelper.createLineStringForOppositeNodes(
        frames,
        lastProcessedFrameIndex,
        uniqueLinks,
      );

    // 4. 각 LineString에 대해 Hausdorff 거리 측정
    const bestLink =
      await this.mapMatchingHelper.findBestLinkForLineStrings(
        lineStringsWithNodes,
      );

    this.logger.info(
      `[MAP-MATCHING] Best matching Link found: ${JSON.stringify(bestLink, null, 2)}`,
    );

    // 5. 매칭된 Link에 대해 Frame 매칭 후 다음 Node로 이동
    if (bestLink) {
      const { link, lastFrameInSegment, distances } = bestLink as {
        link: LinkWithOppositeNode;
        lastFrameInSegment: number;
        distances: number[];
      };

      const matchedFrameId = frames[lastProcessedFrameIndex]?.id;
      const startIdx = lastProcessedFrameIndex;
      const endIdx = frames.findIndex(
        (frame) => frame.id === lastFrameInSegment,
      );

      await this.updateFrameLinkWithDistanceFilter(
        frames,
        link.linkid,
        startIdx,
        endIdx,
        distances,
      );

      lastProcessedFrameIndex = endIdx + 1;
      currentNode = link.oppositeNode;

      this.logger.info(
        `[MAP-MATCHING] Updated currentNode to Node ${currentNode.id}, continuing from Frame ID ${matchedFrameId}`,
      );
    } else {
      const unmatchedFrameId = frames[lastProcessedFrameIndex]?.id;
      this.logger.warn(
        `[MATCHING WARNING] No matching Link found for Frame ID ${unmatchedFrameId}`,
      );
      this.logger.warn(
        `[UNMATCHED] No matching Link found for Frame ID ${unmatchedFrameId}`,
      );
      this.logger.info(
        `[MAP-MATCHING] No matching Link found for Frame ID ${unmatchedFrameId}`,
      );

      this.logger.info(
        `[MAP-MATCHING] Finding new closest Node from Frame ID ${unmatchedFrameId}`,
        this.envConfigService.matchedLog,
      );

      lastProcessedFrameIndex++;
      currentNode = await this.mapMatchingHelper.findClosestNode(
        frames[lastProcessedFrameIndex]?.geom,
      );
    }
    return { lastProcessedFrameIndex, currentNode };
  }

  // Frame의 Link ID를 업데이트
  private async updateFrameLink(
    frameId: number,
    linkId: number,
  ): Promise<void> {
    await this.frameRepository.query(
      `UPDATE ${this.envConfigService.schema}.frame SET link_id = $1 WHERE id = $2;`,
      [linkId, frameId],
    );

    this.logger.info(
      `[MAP-MATCHING] Frame ${frameId} matched to Link ${linkId}`,
      this.envConfigService.matchedLog,
    );
    this.logger.info(
      `[RESULT] Frame ${frameId} matched to Link ${linkId}`,
      this.envConfigService.matchedLog,
    );
  }

  private async updateFrameLinkWithDistanceFilter(
    frames: { id: number }[],
    linkId: number,
    startIdx: number,
    endIdx: number,
    distances: number[],
  ): Promise<void> {
    for (let i = startIdx; i <= endIdx; i++) {
      const frameId = frames[i].id;
      const distance = distances[i - startIdx];
      if (distance <= 30) {
        await this.updateFrameLink(frameId, linkId);
      } else {
        await this.updateFrameLink(frameId, null as unknown as number);
        this.logger.warn(
          `[UNMATCHED] Frame ${frameId} skipped due to distance ${distance}m > 30m`,
        );
      }
    }
  }
}

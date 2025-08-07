import { InjectRepository } from '@nestjs/typeorm';
import { Injectable } from '@nestjs/common';
import { Link } from 'src/shared/entities/link.entity';
import { Node } from 'src/shared/entities/node.entity';
import { Repository } from 'typeorm';
import { Frame } from 'src/shared/entities/frame.entity';
import { FrameRow } from './types/map-matching-types.interface';
import { MapMatchingHelper } from './utils/map-matching-helper';
import { EnvConfigService } from 'src/config/env-config.service';
import { WINSTON_MODULE_PROVIDER } from 'nest-winston';
import { Inject } from '@nestjs/common';
import { Logger } from 'winston';
import { LoggingUtil } from 'src/modules/map-matching/utils/logger.util';
import { LinkWithOppositeNodeDto } from './dto/link-with-opposite-node.dto';

/**
 * 맵매칭 서비스 제공 클래스
 * 각 Record 단위로 처리하며, 후보 링크 필터링 및 방향성 검증, Hausdorff 거리 기반의 최적 링크 선택 수행
 */
@Injectable()
export class MapMatchingService {
  constructor(
    @Inject(WINSTON_MODULE_PROVIDER)
    private readonly logger: Logger,

    @InjectRepository(Link)
    private readonly linkRepository: Repository<Link>,

    @InjectRepository(Frame)
    private readonly frameRepository: Repository<Frame>,
    @InjectRepository(Node)
    private readonly nodeRepository: Repository<Node>,

    private readonly loggingUtil: LoggingUtil,
    private readonly mapMatchingHelper: MapMatchingHelper,
    private readonly envConfigService: EnvConfigService,
  ) {}

  /**
   * Record 단위로 Frame들을 순차적으로 Link와 맵매칭하는 메인 함수
   *
   * 1. 아직 매칭되지 않은 record_id 목록을 조회하고
   * 2. 각 record에 대해 BBox 영역을 계산한 뒤 후보 링크를 필터링하고
   * 3. 프레임 단위로 적절한 Link를 찾아 `link_id`를 설정함
   */
  async matchFramesByGroup() {
    await this.loggingUtil.logDatabaseInfo();
    type RecordRow = { record_id: number };

    const totalFrameCountResult = (await this.frameRepository.query(
      `SELECT COUNT(*) FROM ${this.envConfigService.schema}.frame;`,
    )) as { count: number }[];
    const totalFrameCount = totalFrameCountResult[0]?.count;
    console.log(`Total Frame count: ${totalFrameCount}`);
    this.loggingUtil.logToFile(
      `[MAP-MATCHING] Total Frame count: ${totalFrameCount}`,
      this.envConfigService.matchedLog,
    );

    const totalLinkCountResult = (await this.linkRepository.query(
      `SELECT COUNT(*) FROM ${this.envConfigService.schema}.link;`,
    )) as { count: number }[];
    const totalLinkCount = totalLinkCountResult[0]?.count;
    console.log(`Total Link count: ${totalLinkCount}`);
    this.loggingUtil.logToFile(
      `[MAP-MATCHING] Total Link count: ${totalLinkCount}`,
      this.envConfigService.matchedLog,
    );

    const totalNodeCountResult = (await this.nodeRepository.query(
      `SELECT COUNT(*) FROM ${this.envConfigService.schema}.node;`,
    )) as { count: number }[];
    const totalNodeCount = totalNodeCountResult[0]?.count;
    console.log(`Total Node count: ${totalNodeCount}`);
    this.loggingUtil.logToFile(
      `[MAP-MATCHING] Total Node count: ${totalNodeCount}`,
      this.envConfigService.matchedLog,
    );

    // const records = (await this.frameRepository.query(
    //   `SELECT DISTINCT record_id FROM ${this.envConfigService.schema}.frame WHERE link_id IS NULL ORDER BY record_id ASC;`,
    // )) as RecordRow[];
    const records = (await this.frameRepository.query(
      `SELECT DISTINCT record_id FROM ${this.envConfigService.schema}.frame WHERE link_id IS NULL AND record_id >= 1455 ORDER BY record_id ASC;`,
    )) as RecordRow[];

    for (const record of records) {
      const recordId = record.record_id;

      const recordProcessStart = this.loggingUtil.processStartTime(
        `matchFramesByGroup - Record ${recordId}`,
      );
      this.logger.info(`[MAP-MATCHING] Processing record_id: ${recordId}`);
      type FrameRow = {
        id: number;
        geom: string;
        yaw: number;
        x: number;
        y: number;
      };

      // const frames = (await this.frameRepository.query(
      //   `SELECT id, geom, ST_X(geom) AS x, ST_Y(geom) AS y, yaw FROM ${this.envConfigService.schema}.frame WHERE record_id = $1 AND link_id IS NULL ORDER BY id ASC;`,
      //   [recordId],
      // )) as FrameRow[];

      let frames: FrameRow[];

      if (recordId === 1455) {
        frames = (await this.frameRepository.query(
          `SELECT id, geom, ST_X(geom) AS x, ST_Y(geom) AS y, yaw FROM ${this.envConfigService.schema}.frame WHERE record_id = $1 AND id >= 1475118 AND link_id IS NULL ORDER BY id ASC;`,
          [recordId],
        )) as FrameRow[];
      } else {
        frames = (await this.frameRepository.query(
          `SELECT id, geom, ST_X(geom) AS x, ST_Y(geom) AS y, yaw FROM ${this.envConfigService.schema}.frame WHERE record_id = $1 AND link_id IS NULL ORDER BY id ASC;`,
          [recordId],
        )) as FrameRow[];
      }

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
        this.envConfigService.matchedLog,
      );

      type LinkRow = {
        linkid: number;
        link_geom: string;
        source: number;
        target: number;
      };

      const filteredLinks = (await this.linkRepository.query(
        `SELECT id AS linkid, geom AS link_geom, source, target FROM ${this.envConfigService.schema}.link WHERE ST_Intersects(geom, $1);`,
        [expandedBBox],
      )) as LinkRow[];

      this.logger.info(`[MAP-MATCHING] bboxResult : ${bboxResult.length}`);
      this.logger.info(
        `[MAP-MATCHING] filteredLinks : ${filteredLinks.length}`,
        this.envConfigService.matchedLog,
      );
      this.logger.info(
        `[MAP-MATCHING] Frames : ${frames.length}`,
        this.envConfigService.matchedLog,
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
          this.envConfigService.matchedLog,
        );
      }
      this.loggingUtil.processEndTime(
        `matchFramesByGroup - Record ${recordId}`,
        recordProcessStart,
      );
    }
  }

  /**
   * 현재 Node를 기준으로 Frame 구간을 후보 Link들과 비교하여 가장 적절한 Link와 매칭 수행
   *
   * @param frames Frame 데이터 목록 (특정 record에 속함)
   * @param lastProcessedFrameIndex 현재 처리 중인 Frame의 시작 인덱스
   * @param currentNode 기준 Node (처리 시작점)
   * @param candidateLinks BBox 기반으로 필터링된 후보 Link 목록
   * @returns 매칭 이후 다음 처리 인덱스와 기준 Node를 담은 객체
   *
   * @remarks
   * - 주요 도로는 방향성 필터링, 고가도로는 중간 진입 필터링 적용
   * - 짧은 Link는 반대 노드 기준 추가 탐색 수행
   * - Hausdorff 거리 기반으로 가장 유사한 Link를 선택
   * - 매칭 실패 시 다음 Frame에서 새 Node를 탐색
   */
  async matchFramesToLinks(
    frames: FrameRow[],
    lastProcessedFrameIndex: number,
    currentNode: { id: number; geom: string } | null,
    candidateLinks: Array<{
      linkid: number;
      link_geom: string;
      source: number;
      target: number;
    }>,
  ): Promise<{
    lastProcessedFrameIndex: number;
    currentNode: { id: number; geom: string } | null;
  }> {
    // // 1. 첫 번째 또는 이후 Frame에서 가장 가까운 Node 찾기
    const processingFrameId = frames[lastProcessedFrameIndex]?.id ?? -1;

    this.logger.info(
      `[MAP-MATCHING] Starting matchFramesToLinks with initial currentNode: ${JSON.stringify(currentNode, null, 2)}`,
      this.envConfigService.matchedLog,
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
      this.envConfigService.matchedLog,
    );

    // 2. 현재 Node와 연결된 Link와 각 Link의 반대편 Node 가져오기
    const candidateLinkIds = candidateLinks.map((l) => l.linkid);
    const links: LinkWithOppositeNodeDto[] =
      await this.mapMatchingHelper.getLinksAndOppositeNodesFromCandidates(
        candidateLinkIds,
        currentNode.id,
      );

    this.logger.info(
      `[MAP-MATCHING] currentNode.id : ${currentNode.id}`,
      this.envConfigService.matchedLog,
    );
    this.logger.info(
      `[MAP-MATCHING] links.length : ${links.length}`,
      this.envConfigService.matchedLog,
    );

    const nearbyLinks: LinkWithOppositeNodeDto[] =
      await this.mapMatchingHelper.getNearbyLinksFromCandidates(
        candidateLinkIds,
        frames[lastProcessedFrameIndex].geom,
        currentNode.id,
      );
    this.logger.info(
      `[MAP-MATCHING] nearbyLinks.length : ${nearbyLinks.length}`,
      this.envConfigService.matchedLog,
    );
    links.push(...nearbyLinks);

    // // 중복 제거
    // const uniqueLinks = await this.mapMatchingHelper.filterAndExpandValidLinks(
    //   links,
    //   currentNode,
    //   candidateLinkIds,
    // );

    // this.logger.info(
    //   `[MAP-MATCHING] Fetched links connected to Node ${currentNode.id}: ${JSON.stringify(uniqueLinks, null, 2)}`,
    //   this.envConfigService.matchedLog,
    // );

    // 짧은 Link 검사
    const cleanedLinks: LinkWithOppositeNodeDto[] = [];
    const excludedLinkIds = new Set<number>();
    for (const link of links) {
      const length = await this.mapMatchingHelper.calculateLineStringLength(
        link.linkGeom,
      );
      this.logger.info(
        `[MAP-MATCHING] Link ${link.linkid} length: ${length}`,
        this.envConfigService.matchedLog,
      );
      this.logger.info(
        `[MAP-MATCHING] file: matchFrameAndLinkData.ts:138 ~ MatchFrameToLinkData ~ length: ${length} | ${JSON.stringify(link)}`,
        this.envConfigService.matchedLog,
      );

      const shouldExclude =
        await this.mapMatchingHelper.shouldExcludeLinkDueToMidEntryOnLayerLink(
          link,
          frames[lastProcessedFrameIndex].geom,
          this.frameRepository,
          currentNode.id,
        );

      this.logger.info(
        `[MAP-MATCHING] AdvancedMapMatching ~ shouldExclude : ${shouldExclude}`,
        this.envConfigService.matchedLog,
      );

      if (shouldExclude) {
        this.logger.info(
          `Link ${link.linkid} excluded due to mid-entry on elevated link`,
          this.envConfigService.matchedLog,
        );
        excludedLinkIds.add(link.linkid);
        continue;
      }

      // 주요 도로에서 방향성이 반대인 Link는 제외
      const highway = link.highway?.toLowerCase();
      const isMajorRoad = [
        'motorway',
        'primary',
        'secondary',
        'tertiary',
        'trunk',
        'motorway_link',
        'primary_link',
        'secondary_link',
        'tertiary_link',
        'trunk_link',
      ].includes(link.highway?.toLowerCase());
      this.logger.info(
        `[MAP-MATCHING] AdvancedMapMatching ~ highway:${highway}`,
        this.envConfigService.matchedLog,
      );
      this.logger.info(
        `[MAP-MATCHING] AdvancedMapMatching ~ isMajorRoad: ${isMajorRoad}`,
        this.envConfigService.matchedLog,
      );

      if (isMajorRoad) {
        this.logger.info(
          `[MAP-MATCHING] call isLinkDirectionInvalid - isMajorRoad: ${isMajorRoad}`,
          this.envConfigService.matchedLog,
        );
        const isInvalid = await this.mapMatchingHelper.isLinkDirectionInvalid(
          link,
          frames,
          lastProcessedFrameIndex,
        );
        this.logger.info(
          `[MAP-MATCHING] isLinkDirectionInvalid() returned: ${isInvalid}`,
          this.envConfigService.matchedLog,
        );
        if (isInvalid) {
          this.logger.info(
            `[MAP-MATCHING] Link ${link.linkid} excluded due to invalid direction`,
            this.envConfigService.matchedLog,
          );
          excludedLinkIds.add(link.linkid);
          continue;
        }
      }
      cleanedLinks.push(link);

      // 짧은 경우 oppositeLinks 즉시 추가
      if (length < 7) {
        const oppositeLinks =
          await this.mapMatchingHelper.getLinksAndOppositeNodesFromCandidates(
            candidateLinkIds,
            link.oppositeNode.id,
          );
        this.logger.info(
          `[MAP-MATCHING] oppositeLinks.length : ${oppositeLinks.length}`,
          this.envConfigService.matchedLog,
        );
        cleanedLinks.push(...oppositeLinks);
      }
    }

    // 필터링된 Link들 중에서 제외 대상 제거
    const finalLinks = this.mapMatchingHelper.removeDuplicateLinks(
      cleanedLinks.filter((l) => !excludedLinkIds.has(l.linkid)),
    );

    // 중복 제거
    const uniqueLinks = this.mapMatchingHelper.removeDuplicateLinks(finalLinks);

    this.logger.info(
      `[MAP-MATCHING] Fetched links connected to Node ${currentNode.id}: ${JSON.stringify(uniqueLinks, null, 2)}`,
      this.envConfigService.matchedLog,
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
      this.envConfigService.matchedLog,
    );

    // 5. 매칭된 Link에 대해 Frame 매칭 후 다음 Node로 이동
    if (bestLink) {
      const { link, lastFrameInSegment, distances } = bestLink as {
        link: LinkWithOppositeNodeDto;
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
        this.envConfigService.matchedLog,
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
        this.envConfigService.matchedLog,
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

  /**
   * 단일 Frame의 link_id를 DB에 업데이트
   *
   * @param frameId 업데이트 대상 Frame ID
   * @param linkId 연결할 Link ID (null이면 매칭 불가로 판단됨)
   *
   * @remarks
   * - linkId가 null인 경우는 거리 초과 또는 후보 없음 등 매칭 실패로 판단됨
   */
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

  /**
   * 일정 거리 기준(30m 이하)을 만족하는 구간의 Frame에만 link_id를 설정
   *
   * @param frames 전체 Frame 목록
   * @param linkId 최종 선택된 Link ID
   * @param startIdx 처리 구간 시작 인덱스
   * @param endIdx 처리 구간 종료 인덱스
   * @param distances 각 Frame과 Link 간의 거리 (startIdx 기준으로 offset 적용됨)
   *
   * @remarks
   * - 거리 기준은 실측 GPS 오차를 고려한 30m
   * - 기준 초과 시 해당 Frame은 link_id를 null로 설정하여 제외 처리
   */
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

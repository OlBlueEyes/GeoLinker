// import { Injectable, Logger } from '@nestjs/common';
import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Frame } from 'src/shared/entities/frame.entity';
import { Node } from 'src/shared/entities/node.entity';
import { Link } from 'src/shared/entities/link.entity';
import { FrameRow } from '../types/map-matching-types.interface';
import { LoggingUtil } from 'src/modules/map-matching/utils/logger.util';
import {
  LinkWithOppositeNodeDto,
  QueryResultDto,
} from '../dto/link-with-opposite-node.dto';
import { LineStringWithNodeDto } from '../dto/line-string-with-node.dto';
import { BestLinkResultDto } from '../dto/best-link-result.dto';
import { EnvConfigService } from 'src/config/env-config.service';
import { WINSTON_MODULE_PROVIDER } from 'nest-winston';
import { Inject } from '@nestjs/common';
import { Logger } from 'winston';

@Injectable()
export class MapMatchingHelper {
  // private readonly logger = new Logger(MapMatchingHelper.name);
  constructor(
    @Inject(WINSTON_MODULE_PROVIDER)
    private readonly logger: Logger,

    @InjectRepository(Node)
    private readonly nodeRepository: Repository<Node>,
    @InjectRepository(Frame)
    private readonly frameRepository: Repository<Frame>,
    @InjectRepository(Link)
    private readonly linkRepository: Repository<Link>,

    private readonly loggingUtil: LoggingUtil,
    private readonly envConfigService: EnvConfigService,
  ) {}

  /**
   * 주어진 Point 배열을 이용해 PostGIS에서 LineString을 생성
   *
   * @param points WKT 형식의 Point 문자열 배열
   * @param repo 사용할 TypeORM Repository (일반적으로 FrameRepository)
   * @returns 생성된 LineString WKT 문자열
   */
  async createLineString(
    points: string[],
    repo: Repository<any>,
  ): Promise<string> {
    const { end } = this.loggingUtil.startTimer('createLineString', 'MATCHING');
    const result = (await repo.query(
      `SELECT ST_MakeLine(ARRAY[${points.map((p) => `'${p}'`).join(', ')}]) AS line;`,
    )) as { line: string }[];
    end();

    return result[0].line;
  }

  /**
   * 각 후보 링크(oppositeNode 기준)에 대해 해당 프레임 구간의 LineString과 Hausdorff 거리 비교용 projectedLineString을 생성
   *
   * @param frames GPS Frame 배열
   * @param startIdx 처리 시작 인덱스
   * @param links 후보 링크 목록
   * @returns 각 링크별 LineString, ProjectedLineString, 마지막 Frame ID, 거리 배열이 담긴 객체 배열
   *
   * @remarks
   * - 각 Link에 대해 Frame → Node 거리 변화가 증가하는 시점까지를 한 세그먼트로 인식
   * - 해당 구간의 점들을 모아 LineString 생성
   * - 예외적으로 2개 미만일 경우 비교 Frame을 추가로 삽입할 수 있음
   */
  async createLineStringForOppositeNodes(
    frames: FrameRow[],
    startIdx: number,
    links: LinkWithOppositeNodeDto[],
  ): Promise<LineStringWithNodeDto[]> {
    const lineStringsWithNodes: LineStringWithNodeDto[] = [];
    for (const link of links) {
      const points: string[] = [];
      const projectedPoints: string[] = [];
      const distances: number[] = [];
      let lastFrameInSegment = startIdx;
      let previousDistance = Number.MAX_VALUE;
      for (let i = startIdx; i < frames.length; i++) {
        const frame = frames[i];
        const projectedPoint = await this.getProjectedPointOnLink(
          frame.geom,
          link.linkGeom,
        );
        const frameToPoint = await this.calculateDistanceBetweenPoints(
          frame.geom,
          projectedPoint,
        );
        distances.push(frameToPoint);
        const currentDistance = await this.calculateDistanceToNode(
          frame.geom,
          link.oppositeNode.id,
        );
        this.logger.info(
          `[MAP-MATCHING] Distance from Frame ${frame.id} to Node ${link.oppositeNode.id}: ${currentDistance}`,
          this.envConfigService.matchedLog,
        );
        // 거리 변화의 방향 확인 (가까워지다가 멀어지는 시점에서 멈춤)
        if (currentDistance > previousDistance) break;
        points.push(frame.geom);
        projectedPoints.push(projectedPoint);
        previousDistance = currentDistance;
        lastFrameInSegment = frame.id;
      }
      if (points.length < 2 && frames.length > startIdx + 1) {
        const comparisonFrame =
          startIdx === 0 ? frames[startIdx + 1] : frames[startIdx - 1];
        const distanceToComparison = await this.calculateDistanceBetweenPoints(
          points[points.length - 1],
          comparisonFrame.geom,
        );
        if (distanceToComparison < this.envConfigService.gpsThreshold) {
          points.push(comparisonFrame.geom);
          const projectedPoint = await this.getProjectedPointOnLink(
            comparisonFrame.geom,
            link.linkGeom,
          );
          projectedPoints.push(projectedPoint);
        } else {
          this.logger.warn(
            `[UNMATCHED] Skipping frame ${comparisonFrame.id} due to distance > ${this.envConfigService.gpsThreshold}m`,
          );
        }
      }
      const frameLineString: string = await this.createLineString(
        points,
        this.frameRepository,
      );
      const projectedLineString: string = await this.createLineString(
        projectedPoints,
        this.frameRepository,
      );

      const projectedLineStringLength =
        await this.calculateLineStringLength(projectedLineString);
      this.logger.info(
        `[MAP-MATCHING] Link ${link.linkid} <--> ProjectedLineStringLength is : ${projectedLineStringLength}m`,
        this.envConfigService.matchedLog,
      );
      if (projectedLineStringLength < 3) {
        this.logger.info(
          `[MAP-MATCHING] Link ${link.linkid} length is less than 5m: ${projectedLineStringLength}m`,
          this.envConfigService.matchedLog,
        );
      }
      this.logger.info(
        `[MAP-MATCHING] file: matchFrameAndLinkData.ts:131 ~ MatchFrameToLinkData ~ lineString:${JSON.stringify(
          frameLineString,
          null,
          2,
        )} | lastProcessedFrameIndex : ${JSON.stringify(startIdx)}`,
        this.envConfigService.matchedLog,
      );
      this.logger.info(
        `[MAP-MATCHING] file: matchFrameAndLinkData.ts:131 ~ MatchFrameToLinkData ~ projectedLineString:${JSON.stringify(
          projectedLineString,
          null,
          2,
        )} | lastProcessedFrameIndex : ${JSON.stringify(startIdx)}`,
        this.envConfigService.matchedLog,
      );
      lineStringsWithNodes.push({
        frameLineString,
        projectedLineString,
        lastFrameInSegment,
        link,
        distances,
      });
    }
    return lineStringsWithNodes;
  }

  /**
   * PostGIS의 ST_Length를 사용하여 LineString 길이(m)를 계산
   *
   * @param lineString WKT 형식의 LineString 문자열
   * @returns 거리(m). 계산 실패 시 0 반환
   */
  async calculateLineStringLength(lineString: string): Promise<number> {
    const { end } = this.loggingUtil.startTimer(
      'calculateLineStringLength',
      'MATCHING',
    );
    const result = (await this.frameRepository.query(
      `SELECT ST_Length($1::geography) AS length;`,
      [lineString],
    )) as Array<{ length: number | null }>;
    end();
    return result[0]?.length || 0;
  }

  /**
   * 두 LineString 간의 Hausdorff 거리 계산
   *
   * @param lineString 원본 Frame 기반 LineString
   * @param projectedLineString 링크에 투영된 Point 기반 LineString
   * @returns Hausdorff 거리 (m)
   */
  async calculateHausdorffDistance(
    lineString: string,
    projectedLineString: string,
  ): Promise<number> {
    const { end } = this.loggingUtil.startTimer(
      'calculateHausdorffDistance',
      'MATCHING',
    );
    const result = (await this.frameRepository.query(
      `SELECT ST_HausdorffDistance($1, $2) AS distance;`,
      [lineString, projectedLineString],
    )) as Array<{ distance: number | null }>;
    end();
    return result[0]?.distance || Number.MAX_VALUE;
  }

  /**
   * 두 점(Point) 간의 거리 계산
   *
   * @param pointGeom1 첫 번째 점 (WKT)
   * @param pointGeom2 두 번째 점 (WKT)
   * @returns 거리(m). 계산 실패 시 MAX_VALUE 반환
   */
  async calculateDistanceBetweenPoints(
    pointGeom1: string,
    pointGeom2: string,
  ): Promise<number> {
    const result = (await this.frameRepository.query(
      `SELECT ST_Distance($1::geography, $2::geography) AS distance;`,
      [pointGeom1, pointGeom2],
    )) as { distance: number }[];
    return result[0]?.distance || Number.MAX_VALUE;
  }

  /**
   * 주어진 Node와 Frame 간의 거리 계산
   *
   * @param frameGeom Frame의 위치 (WKT)
   * @param nodeId 거리 측정 대상 Node ID
   * @returns 거리(m)
   */
  private async calculateDistanceToNode(
    frameGeom: string,
    nodeId: number,
  ): Promise<number> {
    const result = (await this.nodeRepository.query(
      `SELECT ST_Distance($1, geom) AS distance FROM ${this.envConfigService.schema}.node WHERE id = $2;`,
      [frameGeom, nodeId],
    )) as Array<{ distance: number | null }>;

    return result[0]?.distance || Number.MAX_VALUE;
  }

  /**
   * 주어진 Frame 위치에 대해 해당 링크 상의 가장 가까운 지점을 계산
   *
   * @param frameGeom Frame Point WKT
   * @param linkGeom Link LineString WKT
   * @returns 해당 링크 위의 투영된 지점 (WKT)
   */
  async getProjectedPointOnLink(
    frameGeom: string,
    linkGeom: string,
  ): Promise<string> {
    const result = (await this.frameRepository.query(
      `SELECT ST_ClosestPoint($1, $2) AS point;`,
      [linkGeom, frameGeom],
    )) as { point: string }[];
    return result[0]?.point;
  }

  /**
   * 링크 ID 기준으로 중복 제거
   *
   * @param links 중복 가능성이 있는 링크 배열
   * @returns 중복 제거된 링크 배열
   */
  removeDuplicateLinks(
    links: LinkWithOppositeNodeDto[],
  ): LinkWithOppositeNodeDto[] {
    const uniqueLinksMap = new Map<number, LinkWithOppositeNodeDto>();
    for (const link of links) {
      uniqueLinksMap.set(link.linkid, link); // linkid를 키로 사용
    }
    return Array.from(uniqueLinksMap.values());
  }

  /**
   * Frame 위치 기준으로 가장 가까운 Node를 검색 (PostGIS <-> 연산 사용)
   *
   * @param frameGeom WKT 형식의 Frame 지오메트리
   * @returns 가장 가까운 Node 객체 { id, geom }
   */
  async findClosestNode(
    frameGeom: string,
  ): Promise<{ id: number; geom: string } | null> {
    const result = (await this.nodeRepository.query(
      `SELECT id, geom FROM ${this.envConfigService.schema}.node ORDER BY geom <-> $1 LIMIT 1;`,
      [frameGeom],
    )) as { id: number; geom: string }[];

    return result[0] || null;
  }

  /**
   * 각 LineString과 링크 사이의 유사도를 측정하여 가장 유사한 Link 반환
   *
   * @param lineStringsWithNodes 각 링크별 Frame/Projected LineString 정보
   * @returns 최적 링크 정보 (BestLinkResultDto) 또는 null
   *
   * @remarks
   * - 모든 링크가 너무 짧은 경우 fallback으로 가장 긴 링크를 선택할 수 있음
   * - 유사도는 Hausdorff 거리 기반으로 평가
   */
  async findBestLinkForLineStrings(
    lineStringsWithNodes: LineStringWithNodeDto[],
  ): Promise<BestLinkResultDto | null> {
    let bestLink: BestLinkResultDto | null = null;

    let fallbackLink: BestLinkResultDto | null = null;

    let bestHausdorffDistance = Number.MAX_VALUE;
    let maxProjectedLineStringLength = 0;
    for (const {
      frameLineString,
      projectedLineString,
      lastFrameInSegment,
      link,
      distances,
    } of lineStringsWithNodes) {
      // projectedLineString의 길이 계산
      const projectedLineStringLength =
        await this.calculateLineStringLength(projectedLineString);
      if (projectedLineStringLength < 3) {
        this.logger.info(
          `[MAP-MATCHING] Link ${link.linkid} is excluded due to short length: ${projectedLineStringLength}m`,
          this.envConfigService.matchedLog,
        );
        // 가장 긴 길이를 가진 Link를 추적하여 fallbackLink 설정
        if (projectedLineStringLength > maxProjectedLineStringLength) {
          maxProjectedLineStringLength = projectedLineStringLength;
          fallbackLink = { link, lastFrameInSegment, distances: [] };
          this.logger.info(
            `[MAP-MATCHING] file: matchFrameAndLinkData.ts:321 ~ fallbackLink:${JSON.stringify(fallbackLink, null, 2)}`,
            this.envConfigService.matchedLog,
          );
        }
        continue; // 다음 Link로 넘어감
      }
      const hausdorffDistance = await this.calculateHausdorffDistance(
        frameLineString,
        projectedLineString,
      );

      this.logger.info(
        `[MAP-MATCHING] file: matchFrameAndLinkData.ts:283 ~ projectedLineString: ${JSON.stringify(
          projectedLineString,
        )}`,
        this.envConfigService.matchedLog,
      );
      this.logger.info(
        `[MAP-MATCHING] file: matchFrameAndLinkData.ts:283 ~ frameLineString: ${JSON.stringify(frameLineString)}`,
        this.envConfigService.matchedLog,
      );
      this.logger.info(
        `[MAP-MATCHING] Hausdorff distance between lineString and Link ${link.linkid}: ${hausdorffDistance}`,
        this.envConfigService.matchedLog,
      );

      if (hausdorffDistance < bestHausdorffDistance) {
        bestHausdorffDistance = hausdorffDistance;
        bestLink = { link, lastFrameInSegment, distances };
      }

      if (!bestLink && fallbackLink) {
        this.logger.info(
          `[MAP-MATCHING] All links are too short, selecting the fallback link: ${JSON.stringify(
            fallbackLink,
            null,
            2,
          )}`,
          this.envConfigService.matchedLog,
        );
        bestLink = fallbackLink;
      }
    }
    return bestLink;
  }

  /**
   * 기준 Node 기준으로 BBox 내부의 후보 링크들 중 가까운 링크 반환
   *
   * @param candidateLinkIds 후보 링크 ID 배열
   * @param frameGeom 현재 Frame 위치 (WKT)
   * @param currentNodeId 현재 기준 Node ID
   * @returns 후보 링크와 반대 Node 정보를 포함한 배열
   */
  async getNearbyLinksFromCandidates(
    candidateLinkIds: number[],
    frameGeom: string,
    currentNodeId: number,
  ): Promise<LinkWithOppositeNodeDto[]> {
    const links = (await this.linkRepository.query(
      `
        WITH candidate_links AS (
          SELECT * FROM ${this.envConfigService.schema}.link WHERE id = ANY($1)
        ),
        node_distances AS (
          SELECT
            cl.id AS linkid,
            cl.geom AS link_geom,
            ST_AsText(cl.geom) AS link_geom_text,
            cl.oneway,
            cl.highway,
            cl.layer,
            cl.source,
            cl.target,
            ST_Distance(ns.geom, (SELECT geom FROM ${this.envConfigService.schema}.node WHERE id = $3)) AS distance_to_start,
            ST_Distance(ne.geom, (SELECT geom FROM ${this.envConfigService.schema}.node WHERE id = $3)) AS distance_to_end
          FROM candidate_links cl
          JOIN ${this.envConfigService.schema}.node ns ON cl.source = ns.id
          JOIN ${this.envConfigService.schema}.node ne ON cl.target = ne.id
          WHERE ST_DWithin(cl.geom, $2::geography, 25)
        )
        SELECT
          linkid,
          link_geom,
          link_geom_text,
          oneway,
          highway,
          layer,
          source,
          target,
          CASE
            WHEN $3 = source THEN target
            WHEN $3 = target THEN source
            ELSE CASE
              WHEN distance_to_start > distance_to_end THEN source
              ELSE target
            END
          END AS opposite_node_id,
          (SELECT geom FROM ${this.envConfigService.schema}.node WHERE id =
            CASE
              WHEN $3 = source THEN target
              WHEN $3 = target THEN source
              ELSE CASE
                WHEN distance_to_start > distance_to_end THEN source
                ELSE target
              END
            END
          ) AS opposite_node_geom
        FROM node_distances;
        `,
      [candidateLinkIds, frameGeom, currentNodeId],
    )) as QueryResultDto[];
    return links.map((link) => ({
      linkid: link.linkid,
      linkGeom: link.link_geom,
      linkGeomText: link.link_geom_text,
      oneway: link.oneway,
      highway: link.highway,
      layer: link.layer,
      source: link.source,
      target: link.target,
      oppositeNode: {
        id: link.opposite_node_id,
        geom: link.opposite_node_geom,
      },
    }));
  }

  /**
   * 현재 Node에 연결된 링크들과 해당 링크의 반대편 Node 정보 조회
   *
   * @param candidateLinkIds 후보 링크 ID 목록
   * @param nodeId 기준이 되는 Node ID
   * @returns 각 링크와 반대 Node 정보를 담은 배열
   */
  async getLinksAndOppositeNodesFromCandidates(
    candidateLinkIds: number[],
    nodeId: number,
  ): Promise<LinkWithOppositeNodeDto[]> {
    const links = (await this.linkRepository.query(
      `
        WITH candidate_links AS (
          SELECT * FROM ${this.envConfigService.schema}.link WHERE id = ANY($1)
        )
        SELECT
          cl.id AS linkid, 
          cl.geom AS link_geom, 
          ST_AsText(cl.geom) AS link_geom_text,
          cl.name_ko,
          cl.name_en,
          cl.oneway,
          cl.highway,
          cl.layer,
          cl.source, 
          cl.target,
          CASE
            WHEN cl.source = $2 THEN cl.target
            ELSE cl.source
          END AS opposite_node_id,
          n.id AS node_id,
          n.geom AS opposite_node_geom
        FROM candidate_links cl
        JOIN ${this.envConfigService.schema}.node n ON n.id =
          CASE
            WHEN cl.source = $2 THEN cl.target
            ELSE cl.source
          END
        WHERE cl.source = $2 OR cl.target = $2;
        `,
      [candidateLinkIds, nodeId],
    )) as QueryResultDto[];

    return links.map((link) => ({
      linkid: link.linkid,
      linkGeom: link.link_geom,
      linkGeomText: link.link_geom_text,
      oneway: link.oneway,
      highway: link.highway,
      layer: link.layer,
      source: link.source,
      target: link.target,
      oppositeNode: {
        id: link.opposite_node_id,
        geom: link.opposite_node_geom,
      },
    }));
  }

  /**
   * 인접한 프레임 2개 이상을 활용하여 차량의 주행 방향 벡터 추정
   *
   * @param frames 전체 Frame 목록
   * @param currentIndex 현재 기준 인덱스
   * @returns 방향 벡터 [dx, dy] 또는 null
   *
   * @remarks
   * - 유효한 방향 벡터를 구할 수 없는 경우 null 반환
   * - 거리 기준은 gpsThreshold(m) 이하일 때만 사용
   */
  async getValidDirectionVector(
    frames: FrameRow[],
    currentIndex: number,
  ): Promise<[number, number] | null> {
    const current = frames[currentIndex];
    this.logger.info(
      `[MAP-MATCHING] AdvancedMapMatching ~ getValidDirectionVector ~ current:${JSON.stringify(current)}`,
      this.envConfigService.matchedLog,
    );
    const prev = currentIndex > 0 ? frames[currentIndex - 1] : null;
    this.logger.info(
      `[MAP-MATCHING] AdvancedMapMatching ~ getValidDirectionVector ~ prev:${JSON.stringify(prev)}`,
      this.envConfigService.matchedLog,
    );
    const next =
      currentIndex < frames.length - 1 ? frames[currentIndex + 1] : null;
    this.logger.info(
      `[MAP-MATCHING] AdvancedMapMatching ~ getValidDirectionVector ~ next:${JSON.stringify(next)}`,
      this.envConfigService.matchedLog,
    );

    const getDistance = async (p1: { geom: string }, p2: { geom: string }) =>
      this.calculateDistanceBetweenPoints(p1.geom, p2.geom);

    let vector: [number, number] | null = null;
    if (prev && next) {
      const distPrev = await getDistance(prev, current);
      this.logger.info(
        `[MAP-MATCHING] AdvancedMapMatching ~ getValidDirectionVector ~ distPrev:${distPrev}`,
        this.envConfigService.matchedLog,
      );
      const distNext = await getDistance(current, next);
      this.logger.info(
        `[MAP-MATCHING] AdvancedMapMatching ~ getValidDirectionVector ~ distNext:${distNext}`,
        this.envConfigService.matchedLog,
      );
      if (
        distPrev < this.envConfigService.gpsThreshold &&
        distNext < this.envConfigService.gpsThreshold
      ) {
        vector = this.calculateDirectionVectorFromXY(
          [prev.x, prev.y],
          [next.x, next.y],
        );
        this.logger.info(
          `[MAP-MATCHING] AdvancedMapMatching ~ getValidDirectionVector ~ vector1:${JSON.stringify(vector)}`,
          this.envConfigService.matchedLog,
        );
      } else if (distPrev < this.envConfigService.gpsThreshold) {
        vector = this.calculateDirectionVectorFromXY(
          [prev.x, prev.y],
          [current.x, current.y],
        );
        this.logger.info(
          `[MAP-MATCHING] AdvancedMapMatching ~ getValidDirectionVector ~ vector2:${JSON.stringify(vector)}`,
          this.envConfigService.matchedLog,
        );
      } else if (distNext < this.envConfigService.gpsThreshold) {
        vector = this.calculateDirectionVectorFromXY(
          [current.x, current.y],
          [next.x, next.y],
        );
        this.logger.info(
          `[MAP-MATCHING] AdvancedMapMatching ~ getValidDirectionVector ~ vector3:${JSON.stringify(vector)}`,
          this.envConfigService.matchedLog,
        );
      }
    } else if (prev) {
      const dist = await getDistance(prev, current);
      if (dist < 10) {
        vector = this.calculateDirectionVectorFromXY(
          [prev.x, prev.y],
          [current.x, current.y],
        );
        this.logger.info(
          `[MAP-MATCHING] AdvancedMapMatching ~ getValidDirectionVector ~ vector4:${JSON.stringify(vector)}`,
          this.envConfigService.matchedLog,
        );
      }
    } else if (next) {
      const dist = await getDistance(current, next);
      if (dist < 10) {
        vector = this.calculateDirectionVectorFromXY(
          [current.x, current.y],
          [next.x, next.y],
        );
        this.logger.info(
          `[MAP-MATCHING] AdvancedMapMatching ~ getValidDirectionVector ~ vector5:${JSON.stringify(vector)}`,
          this.envConfigService.matchedLog,
        );
      }
    }

    return vector;
  }

  /**
   * 두 점 좌표 간 방향 벡터(normalized)를 계산
   *
   * @param p1 시작점 [x, y]
   * @param p2 끝점 [x, y]
   * @returns 단위 방향 벡터 [dx, dy]
   */
  private calculateDirectionVectorFromXY(
    p1: [number, number],
    p2: [number, number],
  ): [number, number] {
    this.logger.info(
      `[MAP-MATCHING] AdvancedMapMatching ~ isLinkDirectionInvalid - vehicleVector: p1=${JSON.stringify(p1)}`,
      this.envConfigService.matchedLog,
    );
    this.logger.info(
      `[MAP-MATCHING] AdvancedMapMatching ~ isLinkDirectionInvalid - vehicleVector: p2=${JSON.stringify(p2)}`,
      this.envConfigService.matchedLog,
    );
    const dx = p2[0] - p1[0];
    const dy = p2[1] - p1[1];
    const length = Math.sqrt(dx * dx + dy * dy);
    return length === 0 ? [0, 0] : [dx / length, dy / length];
  }

  /**
   * 두 방향 벡터 간 코사인 유사도를 계산 (1에 가까울수록 방향이 동일)
   *
   * @param v1 벡터1
   * @param v2 벡터2
   * @returns 유사도 (-1 ~ 1)
   */
  private calculateCosineSimilarity(
    v1: [number, number],
    v2: [number, number],
  ): number {
    const dot = v1[0] * v2[0] + v1[1] * v2[1];
    const mag1 = Math.sqrt(v1[0] * v1[0] + v1[1] * v1[1]);
    const mag2 = Math.sqrt(v2[0] * v2[0] + v2[1] * v2[1]);
    if (mag1 === 0 || mag2 === 0) return 1;
    return dot / (mag1 * mag2);
  }

  /**
   * 현재 차량 진행 방향과 링크 방향이 반대인 경우 해당 링크를 제외할지 판단
   *
   * @param link 후보 링크 정보
   * @param frames Frame 목록
   * @param currentIndex 현재 기준 Frame 인덱스
   * @returns 반대 방향일 경우 true, 아니면 false
   */
  async isLinkDirectionInvalid(
    link: LinkWithOppositeNodeDto,
    frames: FrameRow[],
    currentIndex: number,
  ): Promise<boolean> {
    const highwayType = link.highway?.toLowerCase();
    this.logger.info(
      `[MAP-MATCHING] MapMatchingHelper ~ highwayType:${highwayType}`,
      this.envConfigService.matchedLog,
    );
    const isOneWay = link.oneway === 'yes';
    const isMajor = [
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
    ].includes(highwayType);
    if (!isMajor || !isOneWay) return false;

    const vehicleVector = await this.getValidDirectionVector(
      frames,
      currentIndex,
    );
    this.logger.info(
      `[MAP-MATCHING] AdvancedMapMatching ~ isLinkDirectionInvalid - vehicleVector: frame=${
        frames[currentIndex].id
      } - ${JSON.stringify(vehicleVector)}`,
      this.envConfigService.matchedLog,
    );
    if (!vehicleVector || (vehicleVector[0] === 0 && vehicleVector[1] === 0))
      return false;
    this.logger.info(
      `[MAP-MATCHING] AdvancedMapMatching ~ isLinkDirectionInvalid - link.linkGeomText: ${link.linkGeomText}`,
      this.envConfigService.matchedLog,
    );
    const coords = link.linkGeomText.match(/[-\d.]+ [-\d.]+/g);
    this.logger.info(
      `[MAP-MATCHING] AdvancedMapMatching ~ isLinkDirectionInvalid - coords: coords=${JSON.stringify(coords)} - ${
        link.linkGeomText
      }`,
      this.envConfigService.matchedLog,
    );
    if (!Array.isArray(coords) || coords.length < 2) return false;

    const [srcCoord, tgtCoord] = [coords[0], coords[coords.length - 1]];
    const src = srcCoord.split(' ').map(Number);
    const tgt = tgtCoord.split(' ').map(Number);
    const linkVector = this.calculateDirectionVectorFromXY(
      [src[0], src[1]],
      [tgt[0], tgt[1]],
    );
    this.logger.info(
      `[MAP-MATCHING] AdvancedMapMatching ~ isLinkDirectionInvalid - linkVector: link=${link.linkid} - ${JSON.stringify(
        linkVector,
      )}`,
      this.envConfigService.matchedLog,
    );

    const similarity = this.calculateCosineSimilarity(
      vehicleVector,
      linkVector,
    );
    this.logger.info(
      `[MAP-MATCHING] AdvancedMapMatching ~ isLinkDirectionInvalid - similarity: frame=${frames[currentIndex].id} ~ link=${link.linkid} - ${similarity}`,
      this.envConfigService.matchedLog,
    );
    if (isNaN(similarity)) return false;
    return similarity < 0;
  }

  /**
   * 링크의 중간 지점으로 진입했는지 판단하여 해당 링크를 제외할지 결정
   *
   * @param link 검사할 링크
   * @param frameGeom 현재 Frame 위치 (WKT)
   * @param frameRepo Frame Repository
   * @param currentNodeId 현재 기준 Node ID
   * @returns 중간 진입으로 간주되는 경우 true
   *
   * @remarks
   * - LineLocatePoint 위치가 0.3~0.7 사이 & 양끝점과의 거리가 10m 이상인 경우 중간 진입으로 간주
   */
  async shouldExcludeLinkDueToMidEntryOnLayerLink(
    link: LinkWithOppositeNodeDto,
    frameGeom: string,
    frameRepo: Repository<Frame>,
    currentNodeId: number,
  ): Promise<boolean> {
    if (link.layer == null) return false;

    // 연결된 Link는 제외하지 않음
    if (link.source === currentNodeId || link.target === currentNodeId) {
      this.logger.info(
        `[MAP-MATCHING] AdvancedMapMatching ~ Link ${link.linkid} is connected to currentNode ${currentNodeId}, not excluded despite layer.`,
        this.envConfigService.matchedLog,
      );
      return false;
    }

    const ratioResult = (await frameRepo.query(
      `SELECT ST_LineLocatePoint($1, $2)::float AS ratio;`,
      [link.linkGeom, frameGeom],
    )) as { ratio: string }[];

    this.logger.info(
      `[MAP-MATCHING] AdvancedMapMatching ~ ratioResult : link-${link.linkid} ${JSON.stringify(ratioResult)}`,
      this.envConfigService.matchedLog,
    );

    const sourceDistResult = (await frameRepo.query(
      `SELECT ST_Distance(ST_StartPoint($1)::geography, $2::geography)::float AS dist;`,
      [link.linkGeom, frameGeom],
    )) as { dist: string }[];

    this.logger.info(
      `[MAP-MATCHING] AdvancedMapMatching ~ sourceDistResult : link-${link.linkid} ${JSON.stringify(sourceDistResult)}`,
      this.envConfigService.matchedLog,
    );

    const targetDistResult = (await frameRepo.query(
      `SELECT ST_Distance(ST_EndPoint($1)::geography, $2::geography)::float AS dist;`,
      [link.linkGeom, frameGeom],
    )) as { dist: string }[];

    this.logger.info(
      `[MAP-MATCHING] AdvancedMapMatching ~ targetDistResult : link-${link.linkid} ${JSON.stringify(targetDistResult)}`,
      this.envConfigService.matchedLog,
    );

    const ratio = parseFloat(ratioResult?.[0]?.ratio ?? '0');
    this.logger.info(
      `[MAP-MATCHING] AdvancedMapMatching ~ ratio : link-${link.linkid} ${ratio}`,
      this.envConfigService.matchedLog,
    );

    const distToSource = parseFloat(sourceDistResult?.[0]?.dist ?? '0');
    this.logger.info(
      `[MAP-MATCHING] AdvancedMapMatching ~ distToSource : link-${link.linkid} ${distToSource}`,
      this.envConfigService.matchedLog,
    );

    const distToTarget = parseFloat(targetDistResult?.[0]?.dist ?? '0');
    this.logger.info(
      `[MAP-MATCHING] AdvancedMapMatching ~ distToTarget : link-${link.linkid} ${distToTarget}`,
      this.envConfigService.matchedLog,
    );

    return ratio > 0.3 && ratio < 0.7 && distToSource > 10 && distToTarget > 10;
  }
}

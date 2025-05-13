import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Frame } from 'src/shared/entities/frame.entity';
import { Node } from 'src/shared/entities/node.entity';
import { Link } from 'src/shared/entities/link.entity';
import {
  LinkWithOppositeNode,
  FrameRow,
  LineStringWithNode,
  LinkRowWithNode,
} from '../types/map-matching-types.interface';
import { LoggingUtil } from './logger.util';
import { EnvConfigService } from 'src/config/env-config.service';
import { WINSTON_MODULE_PROVIDER } from 'nest-winston';
import { Inject } from '@nestjs/common';
import { Logger } from 'winston';

@Injectable()
export class MapMatchingHelper {
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

  // LineString 생성
  async createLineString(
    points: string[],
    repo: Repository<any>,
  ): Promise<string> {
    const { end } = this.loggingUtil.startTimer('createLineString', 'MATCHING');
    type LineQueryResult = { line: string };
    const result = (await repo.query(
      `SELECT ST_MakeLine(ARRAY[${points.map((p) => `'${p}'`).join(', ')}]) AS line;`,
    )) as LineQueryResult[];
    end();

    return result[0].line;
  }

  // 각 oppositeNode에 대해 LineString을 생성하고 변곡점을 계산하여 반환
  async createLineStringForOppositeNodes(
    frames: FrameRow[],
    startIdx: number,
    links: LinkWithOppositeNode[],
  ): Promise<
    {
      lineString: string;
      projectedLineString: string;
      lastFrameInSegment: number;
      link: LinkWithOppositeNode;
      distances: number[];
    }[]
  > {
    const lineStringsWithNodes: LineStringWithNode[] = [];
    for (const link of links) {
      const points: string[] = [];
      const projectedPoints: string[] = [];
      const distances: number[] = []; // 250219
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
        ); // 250219
        distances.push(frameToPoint); // 250219
        const currentDistance = await this.calculateDistanceToNode(
          frame.geom,
          link.oppositeNode.id,
        );
        this.logger.info(
          `[MAP-MATCHING] Distance from Frame ${frame.id} to Node ${link.oppositeNode.id}: ${currentDistance}`,
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
      const lineString: string = await this.createLineString(
        points,
        this.frameRepository,
      );
      const projectedLineString: string = await this.createLineString(
        projectedPoints,
        this.frameRepository,
      );
      // projectedLineString 길이 계산
      const projectedLineStringLength =
        await this.calculateLineStringLength(projectedLineString);
      this.logger.info(
        `[MAP-MATCHING] Link ${link.linkid} <--> ProjectedLineStringLength is : ${projectedLineStringLength}m`,
      );
      if (projectedLineStringLength < 3) {
        this.logger.info(
          `[MAP-MATCHING] Link ${link.linkid} length is less than 5m: ${projectedLineStringLength}m`,
        );
      }
      this.logger.info(
        `[MAP-MATCHING] file: matchFrameAndLinkData.ts:131 ~ MatchFrameToLinkData ~ lineString:${JSON.stringify(
          lineString,
          null,
          2,
        )} | lastProcessedFrameIndex : ${JSON.stringify(startIdx)}`,
      );
      this.logger.info(
        `[MAP-MATCHING] file: matchFrameAndLinkData.ts:131 ~ MatchFrameToLinkData ~ projectedLineString:${JSON.stringify(
          projectedLineString,
          null,
          2,
        )} | lastProcessedFrameIndex : ${JSON.stringify(startIdx)}`,
      );
      lineStringsWithNodes.push({
        lineString,
        projectedLineString,
        lastFrameInSegment,
        link,
        distances,
      });
    }
    return lineStringsWithNodes;
  }

  // LineString 길이 계산 함수
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

  // Hausdorff 거리 계산
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

  // Node와 Frame 간의 거리 계산
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

  removeDuplicateLinks(links: LinkWithOppositeNode[]): LinkWithOppositeNode[] {
    const uniqueLinksMap = new Map<number, LinkWithOppositeNode>();
    for (const link of links) {
      uniqueLinksMap.set(link.linkid, link); // linkid를 키로 사용
    }
    return Array.from(uniqueLinksMap.values());
  }

  // Frame에서 가장 가까운 Node 찾기
  async findClosestNode(
    frameGeom: string,
  ): Promise<{ id: number; geom: string } | null> {
    const result = (await this.nodeRepository.query(
      `SELECT id, geom FROM ${this.envConfigService.schema}.node ORDER BY geom <-> $1 LIMIT 1;`,
      [frameGeom],
    )) as { id: number; geom: string }[];

    return result[0] || null;
  }

  // 각 LineString에 대해 Hausdorff 거리 계산 및 최적 Link 선택
  async findBestLinkForLineStrings(
    lineStringsWithNodes: {
      lineString: string;
      projectedLineString: string;
      lastFrameInSegment: number;
      link: LinkWithOppositeNode;
      distances: number[];
    }[],
  ): Promise<{
    link: LinkWithOppositeNode;
    lastFrameInSegment: number;
    distances: number[];
  } | null> {
    let bestLink: {
      link: LinkWithOppositeNode;
      lastFrameInSegment: number;
      distances: number[];
    } | null = null;

    let fallbackLink: {
      link: LinkWithOppositeNode;
      lastFrameInSegment: number;
      distances: number[];
    } | null = null;

    let bestHausdorffDistance = Number.MAX_VALUE;
    let maxProjectedLineStringLength = 0;
    for (const {
      lineString,
      projectedLineString,
      lastFrameInSegment,
      link,
      distances,
    } of lineStringsWithNodes as {
      lineString: string;
      projectedLineString: string;
      lastFrameInSegment: number;
      link: LinkWithOppositeNode;
      distances: number[];
    }[]) {
      // projectedLineString의 길이 계산
      const projectedLineStringLength =
        await this.calculateLineStringLength(projectedLineString);
      if (projectedLineStringLength < 3) {
        this.logger.info(
          `[MAP-MATCHING] Link ${link.linkid} is excluded due to short length: ${projectedLineStringLength}m`,
        );
        // 가장 긴 길이를 가진 Link를 추적하여 fallbackLink 설정
        if (projectedLineStringLength > maxProjectedLineStringLength) {
          maxProjectedLineStringLength = projectedLineStringLength;
          fallbackLink = { link, lastFrameInSegment, distances: [] };
          this.logger.info(
            `[MAP-MATCHING] file: matchFrameAndLinkData.ts:321 ~ fallbackLink:${JSON.stringify(fallbackLink, null, 2)}`,
          );
        }
        continue; // 다음 Link로 넘어감
      }
      const hausdorffDistance = await this.calculateHausdorffDistance(
        lineString,
        projectedLineString,
      );

      this.logger.info(
        `[MAP-MATCHING] file: matchFrameAndLinkData.ts:283 ~ projectedLineString: ${JSON.stringify(projectedLineString)}`,
      );
      this.logger.info(
        `[MAP-MATCHING] file: matchFrameAndLinkData.ts:283 ~ lineString: ${JSON.stringify(lineString)}`,
      );
      this.logger.info(
        `[MAP-MATCHING] Hausdorff distance between lineString and Link ${link.linkid}: ${hausdorffDistance}`,
      );

      if (hausdorffDistance < bestHausdorffDistance) {
        bestHausdorffDistance = hausdorffDistance;
        bestLink = { link, lastFrameInSegment, distances };
      }

      if (!bestLink && fallbackLink) {
        this.logger.info(
          `[MAP-MATCHING] All links are too short, selecting the fallback link: ${JSON.stringify(fallbackLink, null, 2)}`,
        );
        bestLink = fallbackLink;
      }
    }
    return bestLink;
  }

  async getNearbyLinksFromCandidates(
    candidateLinkIds: number[],
    frameGeom: string,
    currentNodeId: number,
  ): Promise<LinkWithOppositeNode[]> {
    const links = (await this.linkRepository.query(
      `
        WITH candidate_links AS (
          SELECT * FROM ${this.envConfigService.schema}.link WHERE id = ANY($1)
        ),
        node_distances AS (
          SELECT
            cl.id AS linkid,
            cl.geom AS link_geom,
            cl.start_node,
            cl.end_node,
            ST_Distance(ns.geom, (SELECT geom FROM ${this.envConfigService.schema}.node WHERE id = $3)) AS distance_to_start,
            ST_Distance(ne.geom, (SELECT geom FROM ${this.envConfigService.schema}.node WHERE id = $3)) AS distance_to_end
          FROM candidate_links cl
          JOIN ${this.envConfigService.schema}.node ns ON cl.start_node = ns.id
          JOIN ${this.envConfigService.schema}.node ne ON cl.end_node = ne.id
          WHERE ST_DWithin(cl.geom, $2::geography, 25)
        )
        SELECT
          linkid,
          link_geom,
          start_node,
          end_node,
          CASE
            WHEN $3 = start_node THEN end_node
            WHEN $3 = end_node THEN start_node
            ELSE CASE
              WHEN distance_to_start > distance_to_end THEN start_node
              ELSE end_node
            END
          END AS opposite_node_id,
          (SELECT geom FROM ${this.envConfigService.schema}.node WHERE id =
            CASE
              WHEN $3 = start_node THEN end_node
              WHEN $3 = end_node THEN start_node
              ELSE CASE
                WHEN distance_to_start > distance_to_end THEN start_node
                ELSE end_node
              END
            END
          ) AS opposite_node_geom
        FROM node_distances;
        `,
      [candidateLinkIds, frameGeom, currentNodeId],
    )) as LinkRowWithNode[];
    return links.map((link) => ({
      linkid: link.linkid,
      linkGeom: link.link_geom,
      startNode: link.start_node,
      endNode: link.end_node,
      oppositeNode: {
        id: link.opposite_node_id,
        geom: link.opposite_node_geom,
      },
    }));
  }

  // Node와 연결된 Link 및 반대 Node를 가져오기
  async getLinksAndOppositeNodesFromCandidates(
    candidateLinkIds: number[],
    nodeId: number,
  ): Promise<LinkWithOppositeNode[]> {
    const links = (await this.linkRepository.query(
      `
        WITH candidate_links AS (
          SELECT * FROM ${this.envConfigService.schema}.link WHERE id = ANY($1)
        )
        SELECT
          cl.id AS linkid,
          cl.geom AS link_geom,
          cl.start_node,
          cl.end_node,
          CASE
            WHEN cl.start_node = $2 THEN cl.end_node
            ELSE cl.start_node
          END AS opposite_node_id,
          n.id AS node_id,
          n.geom AS opposite_node_geom
        FROM candidate_links cl
        JOIN ${this.envConfigService.schema}.node n ON n.id =
          CASE
            WHEN cl.start_node = $2 THEN cl.end_node
            ELSE cl.start_node
          END
        WHERE cl.start_node = $2 OR cl.end_node = $2;
        `,
      [candidateLinkIds, nodeId],
    )) as LinkRowWithNode[];

    return links.map((link) => ({
      linkid: link.linkid,
      linkGeom: link.link_geom,
      startNode: link.start_node,
      endNode: link.end_node,
      oppositeNode: {
        id: link.opposite_node_id,
        geom: link.opposite_node_geom,
      },
    }));
  }
}

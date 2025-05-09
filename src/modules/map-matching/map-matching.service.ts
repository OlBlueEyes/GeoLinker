import { InjectRepository } from '@nestjs/typeorm';
import { Injectable, Logger } from '@nestjs/common';
import { Link } from 'src/shared/entities/link.entity';
import { Node } from 'src/shared/entities/node.entity';
import { Repository } from 'typeorm';
import { Frame } from 'src/shared/entities/frame.entity';
import { ConfigService } from '@nestjs/config';
import * as fs from 'fs';
import * as path from 'path';
import {
  getRequiredEnvStr,
  getRequiredEnvInt,
} from 'src/common/utils/get-required-env';
import {
  FrameRow,
  LinkWithOppositeNode,
  LineStringWithNode,
  LinkRowWithNode,
} from 'src/common/types/map-matching-types.interface';

@Injectable()
export class MapMatchingService {
  private readonly logger = new Logger(MapMatchingService.name);
  public logDir: string;
  public MATCHED_LOG: string;
  public RESULT_LOG: string;
  public UNMATCHED_LOG: string;
  public PROCESS_TIME: string;
  public gpsDistanceThreshold: number;
  public schema: string;
  constructor(
    @InjectRepository(Node)
    private readonly nodeRepository: Repository<Node>,
    @InjectRepository(Link)
    private readonly linkRepository: Repository<Link>,
    @InjectRepository(Frame)
    private readonly frameRepository: Repository<Frame>,
    private configService: ConfigService,
  ) {
    this.logDir = getRequiredEnvStr(this.configService, 'MAP_MATCHING_LOG');
    this.MATCHED_LOG = getRequiredEnvStr(this.configService, 'MATCHED_LOG');
    this.RESULT_LOG = getRequiredEnvStr(this.configService, 'RESULT_LOG');
    this.UNMATCHED_LOG = getRequiredEnvStr(this.configService, 'UNMATCHED_LOG');
    this.PROCESS_TIME = getRequiredEnvStr(this.configService, 'PROCESS_TIME');
    this.schema = getRequiredEnvStr(this.configService, 'DATABASE_SCHEMA');
    this.gpsDistanceThreshold = getRequiredEnvInt(
      this.configService,
      'GPS_DISTANCE_THRESHOLD',
    );
    // this.configService.get<string>('DATABASE_SCHEMA') || 'datahub_dev';
  }
  public async logDatabaseInfo() {
    const dbType = this.configService.get<string>('DB_TYPE');
    const dbHost = this.configService.get<string>('DB_HOST');
    const dbPort = this.configService.get<string>('DB_PORT');
    const dbUsername = this.configService.get<string>('DB_USERNAME');
    const dbDatabase = this.configService.get<string>('DB_DATABASE');
    console.log('Connected to Database:');
    console.log(`Type: ${dbType}`);
    console.log(`Host: ${dbHost}`);
    console.log(`Port: ${dbPort}`);
    console.log(`Username: ${dbUsername}`);
    console.log(`Database Name: ${dbDatabase}`);
    // 현재 사용 중인 스키마 확인 쿼리
    const currentSchemaQuery = `
       SHOW search_path;
   `;
    await this.frameRepository.query(`SET search_path TO ${this.schema};`);
    try {
      type SchemaQueryResult = { search_path: string };

      const result = (await this.frameRepository.query(
        currentSchemaQuery,
      )) as SchemaQueryResult[];

      // 결과는 일반적으로 `"$user", public` 형태로 반환되므로 처리
      const searchPath = result[0]?.search_path || '';

      console.log(`Current Schema (search_path) : ${searchPath}`);
      this.logToFile(
        `Current Schema (search_path) : ${searchPath}`,
        this.MATCHED_LOG,
      );
      // 개별 스키마를 분리하여 출력
      const schemas = searchPath.split(',').map((schema) => schema.trim());
      console.log('Schemas in search_path:');
      schemas.forEach((schema, index) => {
        console.log(`${index + 1}. ${schema}`);
      });
    } catch (error) {
      if (error instanceof Error) {
        console.error('Failed to fetch schema information:', error.message);
      } else {
        console.error('Unknown error occurred:', error);
      }
    }
    // 스키마 정보를 가져오기 위한 쿼리
    const schemaQuery = `
          SELECT schema_name
          FROM information_schema.schemata
          ORDER BY schema_name;
      `;
    try {
      type SchemaRow = { schema_name: string };
      const schemas = (await this.frameRepository.query(
        schemaQuery,
      )) as SchemaRow[];
      console.log('Available Schemas:');
      this.logToFile('Available Schemas:', this.MATCHED_LOG);
      schemas.forEach((schema) => {
        console.log(`- ${schema.schema_name}`);
        this.logToFile(`- ${schema.schema_name}`, this.MATCHED_LOG);
      });
    } catch (error) {
      if (error instanceof Error) {
        console.error('Failed to fetch schema information:', error.message);
      }
    }
  }
  async matchFramesByGroup() {
    await this.logDatabaseInfo();
    type RecordRow = { record_id: number };

    const records = (await this.frameRepository.query(
      `SELECT DISTINCT record_id FROM ${this.schema}.frame WHERE link_id IS NULL ORDER BY record_id ASC;`,
    )) as RecordRow[];

    for (const record of records) {
      const recordId = record.record_id;
      const recordProcessStart = this.processStartTime(
        `matchFramesByGroup - Record ${recordId}`,
      );
      this.logToFile(`Processing record_id: ${recordId}`, this.MATCHED_LOG);
      // const frames = await this.frameRepository.query(
      //   `SELECT id, geom, yaw FROM ${this.schema}.frame WHERE record_id = $1 AND id > 200000 AND link_id IS NULL ORDER BY id ASC;`,
      //   [recordId],
      // );
      type FrameRow = { id: number; geom: string; yaw: number };
      const frames = (await this.frameRepository.query(
        `SELECT id, geom, yaw FROM ${this.schema}.frame WHERE record_id = $1 AND link_id IS NULL ORDER BY id ASC;`,
        [recordId],
      )) as FrameRow[];

      type BBoxResultRow = { expanded: string }; // ST_Envelope 결과는 geometry(WKT 혹은 WKB로)

      const bboxResult = (await this.frameRepository.query(
        `SELECT ST_Envelope(ST_Expand(ST_Collect(geom), 0.09)) AS expanded
         FROM ${this.schema}.frame
         WHERE record_id = $1 AND link_id IS NULL;`,
        [recordId],
      )) as BBoxResultRow[];

      const expandedBBox = bboxResult[0]?.expanded;
      console.log(`expandedBBox: ${JSON.stringify(expandedBBox)}`);

      type LinkRow = {
        linkid: number;
        link_geom: string;
        start_node: number;
        end_node: number;
      };

      const filteredLinks = (await this.linkRepository.query(
        `SELECT id AS linkid, geom AS link_geom, start_node, end_node FROM ${this.schema}.link WHERE ST_Intersects(geom, $1);`,
        [expandedBBox],
      )) as LinkRow[];
      console.log(`bboxResult : ${bboxResult.length}`);
      this.logToFile(`bboxResult : ${bboxResult.length}`, this.MATCHED_LOG);
      console.log(`filteredLinks : ${filteredLinks.length}`);
      this.logToFile(
        `filteredLinks : ${filteredLinks.length}`,
        this.MATCHED_LOG,
      );
      console.log(`Frames : ${frames.length}`);
      this.logToFile(`Frames : ${frames.length}`, this.MATCHED_LOG);
      let lastProcessedFrameIndex = 0;
      let currentNode: { id: number; geom: string } | null = null;
      while (lastProcessedFrameIndex < frames.length) {
        // 첫 Frame 데이터인 경우에만 findClosestNode 실행
        if (!currentNode) {
          currentNode = await this.findClosestNode(
            frames[lastProcessedFrameIndex].geom,
          );
          this.logToFile(
            `Starting matchFramesToLinks with initial currentNode: ${JSON.stringify(currentNode, null, 2)}`,
            this.MATCHED_LOG,
          );
          if (!currentNode) {
            this.logger.warn(`No closest node found for the initial frame.`);
            this.logToFile(
              `No closest node found for the initial frame. : ${recordId}`,
              this.MATCHED_LOG,
            );
            return; // 더 이상 처리할 데이터가 없음을 의미
          }
        }
        // Frame 데이터 매칭
        // const result = await this.matchFramesToLinks(frames, lastProcessedFrameIndex, currentNode);
        const result = await this.matchFramesToLinks(
          frames,
          lastProcessedFrameIndex,
          currentNode,
          filteredLinks,
        );
        lastProcessedFrameIndex = result.lastProcessedFrameIndex;
        currentNode = result.currentNode; // 업데이트된 currentNode 사용
        this.logToFile(
          `lastProcessedFrameIndex : ${lastProcessedFrameIndex} | frames.length : ${frames.length}`,
          this.MATCHED_LOG,
        );
        console.log(
          `lastProcessedFrameIndex : ${lastProcessedFrameIndex} | frames.length : ${frames.length}`,
        );
      }
      this.processEndTime(
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
    this.logToFile(
      `Starting matchFramesToLinks with initial currentNode: ${JSON.stringify(currentNode, null, 2)}`,
      this.MATCHED_LOG,
    );
    if (!currentNode) {
      this.logger.warn(`No closest node found for the initial frame.`);
      this.logToFile(
        `No closest node found for the initial frame. : ${processingFrameId}`,
        this.MATCHED_LOG,
      );
      return {
        lastProcessedFrameIndex: frames.length,
        currentNode: { id: -1, geom: '' }, // 의미 없는 기본값
      };
    }
    this.logToFile(
      `Processing from Frame ID ${processingFrameId}`,
      this.MATCHED_LOG,
    );
    // 2. 현재 Node와 연결된 Link와 각 Link의 반대편 Node 가져오기
    const candidateLinkIds = candidateLinks.map((l) => l.linkid);
    const links: LinkWithOppositeNode[] =
      await this.getLinksAndOppositeNodesFromCandidates(
        candidateLinkIds,
        currentNode.id,
      );
    console.log(`currentNode.id : ${currentNode.id}`);
    this.logToFile(`links.length : ${links.length}`, this.MATCHED_LOG);
    // const nearbyLinks = await this.getNearbyLinks(frames[lastProcessedFrameIndex].geom, currentNode.id);
    const nearbyLinks: LinkWithOppositeNode[] =
      await this.getNearbyLinksFromCandidates(
        candidateLinkIds,
        frames[lastProcessedFrameIndex].geom,
        currentNode.id,
      );
    this.logToFile(
      `nearbyLinks.length : ${nearbyLinks.length}`,
      this.MATCHED_LOG,
    );
    links.push(...nearbyLinks);
    // 짧은 Link 검사
    const shortLinks: LinkWithOppositeNode[] = [];
    for (const link of links) {
      const length = await this.calculateLineStringLength(link.linkGeom);
      this.logToFile(
        `file: matchFrameAndLinkData.ts:138 ~ MatchFrameToLinkData ~ length: ${length} | ${JSON.stringify(link)}`,
        this.MATCHED_LOG,
      );
      if (length < 7) {
        shortLinks.push(link);
      }
    }
    // 짧은 Link가 있는 경우 해당 반대편 Node에서 추가적인 Link들 가져옴
    for (const shortLink of shortLinks) {
      console.log(
        `file: matchFrameAndLinkData.ts:117 ~ MatchFrameToLinkData ~ shortLink:${JSON.stringify(shortLink)},`,
      );
      const oppositeLinks = await this.getLinksAndOppositeNodesFromCandidates(
        candidateLinkIds,
        shortLink.oppositeNode.id,
      );
      this.logToFile(
        `oppositeLinks.length : ${oppositeLinks.length}`,
        this.MATCHED_LOG,
      );
      links.push(...oppositeLinks); // 기존 links에 추가
    }
    // 중복 제거
    const uniqueLinks = this.removeDuplicateLinks(links);
    this.logToFile(
      `Fetched links connected to Node ${currentNode.id}: ${JSON.stringify(uniqueLinks, null, 2)}`,
      this.MATCHED_LOG,
    );
    // 3. 각 oppositeNode에 대해 LineString 생성 및 변곡점 계산
    const lineStringsWithNodes = await this.createLineStringForOppositeNodes(
      frames,
      lastProcessedFrameIndex,
      uniqueLinks,
    );
    // 4. 각 LineString에 대해 Hausdorff 거리 측정
    const bestLink = await this.findBestLinkForLineStrings(
      lineStringsWithNodes,
      // frames,
    );
    this.logToFile(
      `Best matching Link found: ${JSON.stringify(bestLink, null, 2)}`,
      this.MATCHED_LOG,
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
      // for (let i = startIdx; i <= endIdx; i++) {
      //   await this.updateFrameLink(frames[i].id, bestLink.link.linkid);
      // }
      lastProcessedFrameIndex = endIdx + 1;
      currentNode = link.oppositeNode;
      this.logToFile(
        `Updated currentNode to Node ${currentNode.id}, continuing from Frame ID ${matchedFrameId}`,
        this.MATCHED_LOG,
      );
    } else {
      const unmatchedFrameId = frames[lastProcessedFrameIndex]?.id;
      this.logger.warn(
        `No matching Link found for Frame ID ${unmatchedFrameId}`,
      );
      this.logToFile(
        `No matching Link found for Frame ID ${unmatchedFrameId}`,
        this.UNMATCHED_LOG,
      );
      this.logToFile(
        `No matching Link found for Frame ID ${unmatchedFrameId}`,
        this.MATCHED_LOG,
      );
      this.logToFile(
        `Finding new closest Node from Frame ID ${unmatchedFrameId}`,
        this.MATCHED_LOG,
      );
      lastProcessedFrameIndex++;
      currentNode = await this.findClosestNode(
        frames[lastProcessedFrameIndex]?.geom,
      );
    }
    return { lastProcessedFrameIndex, currentNode };
  }
  // 각 oppositeNode에 대해 LineString을 생성하고 변곡점을 계산하여 반환
  private async createLineStringForOppositeNodes(
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
        this.logToFile(
          `Distance from Frame ${frame.id} to Node ${link.oppositeNode.id}: ${currentDistance}`,
          this.MATCHED_LOG,
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
        if (distanceToComparison < this.gpsDistanceThreshold) {
          points.push(comparisonFrame.geom);
          const projectedPoint = await this.getProjectedPointOnLink(
            comparisonFrame.geom,
            link.linkGeom,
          );
          projectedPoints.push(projectedPoint);
        } else {
          this.logToFile(
            `Skipping frame ${comparisonFrame.id} due to distance > ${this.gpsDistanceThreshold}m`,
            this.UNMATCHED_LOG,
          );
        }
      }
      const lineString: string = await this.createLineString(points);
      const projectedLineString: string =
        await this.createLineString(projectedPoints);
      // projectedLineString 길이 계산
      const projectedLineStringLength =
        await this.calculateLineStringLength(projectedLineString);
      this.logToFile(
        `Link ${link.linkid} <--> ProjectedLineStringLength is : ${projectedLineStringLength}m`,
        this.MATCHED_LOG,
      );
      if (projectedLineStringLength < 3) {
        this.logToFile(
          `Link ${link.linkid} length is less than 5m: ${projectedLineStringLength}m`,
          this.MATCHED_LOG,
        );
      }
      this.logToFile(
        `file: matchFrameAndLinkData.ts:131 ~ MatchFrameToLinkData ~ lineString:${JSON.stringify(
          lineString,
          null,
          2,
        )} | lastProcessedFrameIndex : ${JSON.stringify(startIdx)}`,
        this.MATCHED_LOG,
      );
      this.logToFile(
        `file: matchFrameAndLinkData.ts:131 ~ MatchFrameToLinkData ~ projectedLineString:${JSON.stringify(
          projectedLineString,
          null,
          2,
        )} | lastProcessedFrameIndex : ${JSON.stringify(startIdx)}`,
        this.MATCHED_LOG,
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
  // LineString 생성
  private async createLineString(points: string[]): Promise<string> {
    type LineQueryResult = { line: string };
    const result = (await this.frameRepository.query(
      `SELECT ST_MakeLine(ARRAY[${points.map((p) => `'${p}'`).join(', ')}]) AS line;`,
    )) as LineQueryResult[];

    return result[0].line;
  }
  // 각 LineString에 대해 Hausdorff 거리 계산 및 최적 Link 선택
  private async findBestLinkForLineStrings(
    lineStringsWithNodes: {
      lineString: string;
      projectedLineString: string;
      lastFrameInSegment: number;
      link: LinkWithOppositeNode;
      distances: number[];
    }[],
    // frames: any[],
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
    // let bestFrechetDistance = Number.MAX_VALUE;
    let maxProjectedLineStringLength = 0;
    // let bestMatchScore = Number.MAX_VALUE;
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
        this.logToFile(
          `Link ${link.linkid} is excluded due to short length: ${projectedLineStringLength}m`,
          this.MATCHED_LOG,
        );
        // 가장 긴 길이를 가진 Link를 추적하여 fallbackLink 설정
        if (projectedLineStringLength > maxProjectedLineStringLength) {
          maxProjectedLineStringLength = projectedLineStringLength;
          fallbackLink = { link, lastFrameInSegment, distances: [] };
          this.logToFile(
            `file: matchFrameAndLinkData.ts:321 ~ fallbackLink:${JSON.stringify(fallbackLink, null, 2)}`,
            this.MATCHED_LOG,
          );
        }
        continue; // 다음 Link로 넘어감
      }
      const startHausdorffTime = this.processStartTime(
        'calculateHausdorffDistance',
      );
      const hausdorffDistance = await this.calculateHausdorffDistance(
        lineString,
        projectedLineString,
      );
      this.processEndTime('calculateHausdorffDistance', startHausdorffTime);
      this.logToFile(
        `file: matchFrameAndLinkData.ts:283 ~ projectedLineString:${JSON.stringify(projectedLineString)}`,
        this.RESULT_LOG,
      );
      this.logToFile(
        `file: matchFrameAndLinkData.ts:283 ~ lineString:${JSON.stringify(lineString)}`,
        this.RESULT_LOG,
      );
      this.logToFile(
        `file: matchFrameAndLinkData.ts:283 ~ projectedLineString:${JSON.stringify(projectedLineString)}`,
        this.MATCHED_LOG,
      );
      this.logToFile(
        `file: matchFrameAndLinkData.ts:283 ~ lineString:${JSON.stringify(lineString)}`,
        this.MATCHED_LOG,
      );
      this.logToFile(
        `Hausdorff distance between lineString and Link ${link.linkid}: ${hausdorffDistance}`,
        this.MATCHED_LOG,
      );
      if (hausdorffDistance < bestHausdorffDistance) {
        bestHausdorffDistance = hausdorffDistance;
        bestLink = { link, lastFrameInSegment, distances };
      }
      if (!bestLink && fallbackLink) {
        this.logToFile(
          `All links are too short, selecting the fallback link: ${JSON.stringify(fallbackLink, null, 2)}`,
          this.MATCHED_LOG,
        );
        bestLink = fallbackLink;
      }
    }
    return bestLink;
  }
  // Hausdorff 거리 계산
  private async calculateHausdorffDistance(
    lineString: string,
    projectedLineString: string,
  ): Promise<number> {
    const result = (await this.frameRepository.query(
      `SELECT ST_HausdorffDistance($1, $2) AS distance;`,
      [lineString, projectedLineString],
    )) as Array<{ distance: number | null }>;
    return result[0]?.distance || Number.MAX_VALUE;
  }
  // Frame에서 가장 가까운 Node 찾기
  private async findClosestNode(
    frameGeom: string,
  ): Promise<{ id: number; geom: string } | null> {
    const result = (await this.nodeRepository.query(
      `SELECT id, geom FROM ${this.schema}.node ORDER BY geom <-> $1 LIMIT 1;`,
      [frameGeom],
    )) as { id: number; geom: string }[];

    return result[0] || null;
  }
  // Node와 Frame 간의 거리 계산
  private async calculateDistanceToNode(
    frameGeom: string,
    nodeId: number,
  ): Promise<number> {
    const result = (await this.nodeRepository.query(
      `SELECT ST_Distance($1, geom) AS distance FROM ${this.schema}.node WHERE id = $2;`,
      [frameGeom, nodeId],
    )) as Array<{ distance: number | null }>;

    return result[0]?.distance || Number.MAX_VALUE;
  }
  // Frame의 Link ID를 업데이트
  private async updateFrameLink(
    frameId: number,
    linkId: number,
  ): Promise<void> {
    await this.frameRepository.query(
      `UPDATE ${this.schema}.frame SET link_id = $1 WHERE id = $2;`,
      [linkId, frameId],
    );
    this.logToFile(
      `Frame ${frameId} matched to Link ${linkId}`,
      this.MATCHED_LOG,
    );
    this.logToFile(
      `Frame ${frameId} matched to Link ${linkId}`,
      this.RESULT_LOG,
    );
  }
  // Node와 연결된 Link 및 반대 Node를 가져오기
  private async getLinksAndOppositeNodesFromCandidates(
    candidateLinkIds: number[],
    nodeId: number,
  ): Promise<LinkWithOppositeNode[]> {
    const links = (await this.linkRepository.query(
      `
        WITH candidate_links AS (
          SELECT * FROM ${this.schema}.link WHERE id = ANY($1)
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
        JOIN ${this.schema}.node n ON n.id =
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
  // LineString 길이 계산 함수
  private async calculateLineStringLength(lineString: string): Promise<number> {
    const result = (await this.frameRepository.query(
      `SELECT ST_Length($1::geography) AS length;`,
      [lineString],
    )) as Array<{ length: number | null }>;

    return result[0]?.length || 0;
  }
  // 로그 메시지를 기록하는 함수
  // private logToFile(message: string, filePath: string) {
  //   console.log(message);
  //   const logmsg = `${new Date().toISOString()} - ${message}`;
  //   fs.appendFileSync(filePath, logmsg + '\n');
  // }
  private logToFile(message: string, fileName: string) {
    console.log(message);
    const logmsg = `${new Date().toISOString()} - ${message}`;
    const fullPath = path.join(this.logDir, fileName);
    // 로그 디렉토리 없으면 생성
    const dir = path.dirname(fullPath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    fs.appendFileSync(fullPath, logmsg + '\n');
  }
  private async getNearbyLinksFromCandidates(
    candidateLinkIds: number[],
    frameGeom: string,
    currentNodeId: number,
  ): Promise<LinkWithOppositeNode[]> {
    const links = (await this.linkRepository.query(
      `
        WITH candidate_links AS (
          SELECT * FROM ${this.schema}.link WHERE id = ANY($1)
        ),
        node_distances AS (
          SELECT
            cl.id AS linkid,
            cl.geom AS link_geom,
            cl.start_node,
            cl.end_node,
            ST_Distance(ns.geom, (SELECT geom FROM ${this.schema}.node WHERE id = $3)) AS distance_to_start,
            ST_Distance(ne.geom, (SELECT geom FROM ${this.schema}.node WHERE id = $3)) AS distance_to_end
          FROM candidate_links cl
          JOIN ${this.schema}.node ns ON cl.start_node = ns.id
          JOIN ${this.schema}.node ne ON cl.end_node = ne.id
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
          (SELECT geom FROM ${this.schema}.node WHERE id =
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

  private removeDuplicateLinks(
    links: LinkWithOppositeNode[],
  ): LinkWithOppositeNode[] {
    const uniqueLinksMap = new Map<number, LinkWithOppositeNode>();
    for (const link of links) {
      uniqueLinksMap.set(link.linkid, link); // linkid를 키로 사용
    }
    return Array.from(uniqueLinksMap.values());
  }

  private async getProjectedPointOnLink(
    frameGeom: string,
    linkGeom: string,
  ): Promise<string> {
    const result = (await this.frameRepository.query(
      `SELECT ST_ClosestPoint($1, $2) AS point;`,
      [linkGeom, frameGeom],
    )) as { point: string }[];
    return result[0]?.point;
  }

  private async calculateDistanceBetweenPoints(
    pointGeom1: string,
    pointGeom2: string,
  ): Promise<number> {
    const result = (await this.frameRepository.query(
      `SELECT ST_Distance($1::geography, $2::geography) AS distance;`,
      [pointGeom1, pointGeom2],
    )) as { distance: number }[];
    // this.logToFile(`calculateDistanceBetweenPoints ~ result[0]?.distance: ${result[0]?.distance}`, this.UNMATCHED_LOG);
    return result[0]?.distance || Number.MAX_VALUE;
  }

  private processStartTime(funcName: string): number {
    const processStartMessage = `Start ${funcName}`;
    console.log(processStartMessage);
    this.logToFile(processStartMessage, this.PROCESS_TIME);
    return Date.now(); // 시작 시간을 반환
  }
  private processEndTime(funcName: string, startTime: number): void {
    const processEndMessage = `End ${funcName}`;
    console.log(processEndMessage);
    this.logToFile(processEndMessage, this.PROCESS_TIME);
    const endTime = Date.now();
    const durationMessage = `${funcName} took ${endTime - startTime}ms`;
    console.log(durationMessage);
    this.logToFile(durationMessage, this.PROCESS_TIME);
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
        this.logToFile(
          `Frame ${frameId} skipped due to distance ${distance}m > 30m`,
          this.UNMATCHED_LOG,
        );
      }
    }
  }
}

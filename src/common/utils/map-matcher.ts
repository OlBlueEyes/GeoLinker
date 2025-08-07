import { InjectRepository } from '@nestjs/typeorm';
import { Injectable, Logger } from '@nestjs/common';
import { Link } from 'src/shared/entities/link.entity';
import { Node } from 'src/shared/entities/node.entity';
import { Repository } from 'typeorm';
import { Frame } from 'src/shared/entities/frame.entity';
import { ConfigService } from '@nestjs/config';
import { EnvConfigService } from 'src/config/env-config.service';
import * as fs from 'fs';
import * as path from 'path';
import { FrameRow } from 'src/modules/map-matching/types/map-matching-types.interface';
import {
  LinkWithOppositeNodeDto,
  QueryResultDto,
} from 'src/modules/map-matching/dto/link-with-opposite-node.dto';
import { LineStringWithNodeDto } from 'src/modules/map-matching/dto/line-string-with-node.dto';

@Injectable()
export class AdvancedMapMatching {
  private readonly logger = new Logger(AdvancedMapMatching.name);
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
    private readonly envConfigService: EnvConfigService,
  ) {
    this.logDir = this.envConfigService.mapMatchingLogPath;
    this.MATCHED_LOG = this.envConfigService.matchedLog;
    this.RESULT_LOG = this.envConfigService.resultLog;
    this.UNMATCHED_LOG = this.envConfigService.unmatchedLog;
    this.PROCESS_TIME = this.envConfigService.matchingProcess;
    this.schema = this.envConfigService.schema;
    this.gpsDistanceThreshold = this.envConfigService.gpsThreshold;
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
    await this.frameRepository.query(
      `SET search_path TO ${this.schema}, public;`,
    );

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
        console.error(
          `Failed to fetch current schema information:${error.message}`,
        );
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

    const totalFrameCountResult = (await this.frameRepository.query(
      `SELECT COUNT(*) FROM ${this.schema}.frame;`,
    )) as { count: number }[];
    const totalFrameCount = totalFrameCountResult[0]?.count;
    console.log(`Total Frame count: ${totalFrameCount}`);
    this.logToFile(`Total Frame count: ${totalFrameCount}`, this.MATCHED_LOG);

    const totalLinkCountResult = (await this.linkRepository.query(
      `SELECT COUNT(*) FROM ${this.schema}.link;`,
    )) as { count: number }[];
    const totalLinkCount = totalLinkCountResult[0]?.count;
    console.log(`Total Link count: ${totalLinkCount}`);
    this.logToFile(`Total Link count: ${totalLinkCount}`, this.MATCHED_LOG);

    const totalNodeCountResult = (await this.nodeRepository.query(
      `SELECT COUNT(*) FROM ${this.schema}.node;`,
    )) as { count: number }[];
    const totalNodeCount = totalNodeCountResult[0]?.count;
    console.log(`Total Node count: ${totalNodeCount}`);
    this.logToFile(`Total Node count: ${totalNodeCount}`, this.MATCHED_LOG);

    const records = (await this.frameRepository.query(
      `SELECT DISTINCT record_id FROM ${this.schema}.frame WHERE link_id IS NULL AND record_id >= 223 ORDER BY record_id ASC;`,
    )) as RecordRow[];

    for (const record of records) {
      const recordId = record.record_id;
      const recordProcessStart = this.processStartTime(
        `matchFramesByGroup - Record ${recordId}`,
      );
      this.logToFile(`Processing record_id: ${recordId}`, this.MATCHED_LOG);

      let frames: FrameRow[] = [];

      type FrameRow = {
        id: number;
        geom: string;
        yaw: number;
        x: number;
        y: number;
      };

      if (recordId === 223) {
        frames = (await this.frameRepository.query(
          `SELECT id, geom, ST_X(geom) AS x, ST_Y(geom) AS y, yaw FROM ${this.schema}.frame WHERE record_id = $1 AND id >= 4238566 AND link_id IS NULL ORDER BY id ASC;`,
          [recordId],
        )) as FrameRow[];
      } else {
        frames = (await this.frameRepository.query(
          `SELECT id, geom, ST_X(geom) AS x, ST_Y(geom) AS y, yaw FROM ${this.schema}.frame WHERE record_id = $1 AND link_id IS NULL ORDER BY id ASC;`,
          [recordId],
        )) as FrameRow[];
      }
      type BBoxResultRow = { expanded: string };

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
        source: number;
        target: number;
      };

      const filteredLinks = (await this.linkRepository.query(
        `SELECT id AS linkid, geom AS link_geom, source, target FROM ${this.schema}.link WHERE ST_Intersects(geom, $1);`,
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

      let currentNode: { id: number; geom: string } | null = null; // 초기화된 currentNode

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
      source: number;
      target: number;
    }>,
  ): Promise<{
    lastProcessedFrameIndex: number;
    currentNode: { id: number; geom: string } | null;
  }> {
    // 1. 첫 번째 또는 이후 Frame에서 가장 가까운 Node 찾기
    const processingFrameId = frames[lastProcessedFrameIndex]?.id;

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
        lastProcessedFrameIndex: frames.length, // 더 이상 처리할 데이터가 없음을 의미
        currentNode: { id: -1, geom: '' }, // 의미 없는 기본값
      };
    }

    this.logToFile(
      `Processing from Frame ID ${processingFrameId}`,
      this.MATCHED_LOG,
    );

    // 2. 현재 Node와 연결된 Link와 각 Link의 반대편 Node 가져오기
    const candidateLinkIds = candidateLinks.map((l) => l.linkid);
    const links: LinkWithOppositeNodeDto[] =
      await this.getLinksAndOppositeNodesFromCandidates(
        candidateLinkIds,
        currentNode.id,
      );
    console.log(`currentNode.id : ${currentNode.id}`);
    this.logToFile(`links.length : ${links.length}`, this.MATCHED_LOG);
    const nearbyLinks: LinkWithOppositeNodeDto[] =
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
    const cleanedLinks: LinkWithOppositeNodeDto[] = [];
    const excludedLinkIds = new Set<number>();
    for (const link of links) {
      const length = await this.calculateLineStringLength(link.linkGeom);
      this.logToFile(`Link ${link.linkid} length: ${length}`, this.MATCHED_LOG);
      this.logToFile(
        `file: matchFrameAndLinkData.ts:138 ~ MatchFrameToLinkData ~ length: ${length} | ${JSON.stringify(link)}`,
        this.MATCHED_LOG,
      );

      const shouldExclude =
        await this.shouldExcludeLinkDueToMidEntryOnLayerLink(
          link,
          frames[lastProcessedFrameIndex].geom,
          this.frameRepository,
          currentNode.id,
        );

      this.logToFile(
        ` AdvancedMapMatching ~ shouldExclude : ${shouldExclude}`,
        this.MATCHED_LOG,
      );
      if (shouldExclude) {
        this.logToFile(
          `Link ${link.linkid} excluded due to mid-entry on elevated link`,
          this.MATCHED_LOG,
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
      this.logToFile(
        `AdvancedMapMatching ~ highway:${highway}`,
        this.MATCHED_LOG,
      );
      this.logToFile(
        `AdvancedMapMatching ~ isMajorRoad: ${isMajorRoad}`,
        this.MATCHED_LOG,
      );

      if (isMajorRoad) {
        if (
          await this.isLinkDirectionInvalid(
            link,
            frames,
            lastProcessedFrameIndex,
          )
        ) {
          this.logToFile(
            `Link ${link.linkid} excluded due to invalid direction`,
            this.MATCHED_LOG,
          );
          excludedLinkIds.add(link.linkid);
          continue;
        }
      }
      cleanedLinks.push(link);

      // 짧은 경우 oppositeLinks 즉시 추가
      if (length < 7) {
        const oppositeLinks = await this.getLinksAndOppositeNodesFromCandidates(
          candidateLinkIds,
          link.oppositeNode.id,
        );
        this.logToFile(
          `oppositeLinks.length : ${oppositeLinks.length}`,
          this.MATCHED_LOG,
        );
        cleanedLinks.push(...oppositeLinks);
      }
    }

    // 필터링된 Link들 중에서 제외 대상 제거
    const finalLinks = this.removeDuplicateLinks(
      cleanedLinks.filter((l) => !excludedLinkIds.has(l.linkid)),
    );

    // 중복 제거
    const uniqueLinks = this.removeDuplicateLinks(finalLinks);

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
    const bestLink =
      await this.findBestLinkForLineStrings(lineStringsWithNodes);
    this.logToFile(
      `Best matching Link found: ${JSON.stringify(bestLink, null, 2)}`,
      this.MATCHED_LOG,
    );

    // 5. 매칭된 Link에 대해 Frame 매칭 후 다음 Node로 이동
    if (bestLink) {
      const matchedFrameId = frames[lastProcessedFrameIndex]?.id;
      const startIdx = lastProcessedFrameIndex;
      const endIdx = frames.findIndex(
        (frame) => frame.id === bestLink.lastFrameInSegment,
      );

      await this.updateFrameLinkWithDistanceFilter(
        frames,
        bestLink.link.linkid,
        startIdx,
        endIdx,
        bestLink.distances,
      );

      lastProcessedFrameIndex = endIdx + 1;
      currentNode = bestLink.link.oppositeNode;
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
    links: LinkWithOppositeNodeDto[],
  ): Promise<
    {
      frameLineString: string;
      projectedLineString: string;
      lastFrameInSegment: number;
      link: LinkWithOppositeNodeDto;
      distances: number[];
    }[]
  > {
    const lineStringsWithNodes: LineStringWithNodeDto[] = [];

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

      const frameLineString: string = await this.createLineString(
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
          frameLineString,
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
        frameLineString,
        projectedLineString,
        lastFrameInSegment,
        link,
        distances,
      });
    }

    return lineStringsWithNodes;
  }

  // LineString 생성
  private async createLineString(
    points: string[],
    repo: Repository<any>,
  ): Promise<string> {
    // 유효한 포인트만 필터링
    const validPoints = points.filter(
      (p) => typeof p === 'string' && p.toLowerCase() !== 'null',
    );

    // 유효한 포인트가 2개 미만이면 ST_MakeLine 불가능
    if (validPoints.length < 2) {
      this.logToFile(
        `createLineString: Not enough valid points to make a LineString. Received ${validPoints.length} points.`,
        this.UNMATCHED_LOG,
      );
      return 'LINESTRING EMPTY'; // 또는 빈 string 반환
    }
    type LineQueryResult = { line: string };
    const result = (await repo.query(
      `SELECT ST_MakeLine(ARRAY[${points.map((p) => `'${p}'`).join(', ')}]) AS line;`,
    )) as LineQueryResult[];
    return result[0].line;
  }

  // 각 LineString에 대해 Hausdorff 거리 계산 및 최적 Link 선택
  private async findBestLinkForLineStrings(
    lineStringsWithNodes: {
      frameLineString: string;
      projectedLineString: string;
      lastFrameInSegment: number;
      link: LinkWithOppositeNodeDto;
      distances: number[];
    }[],
  ): Promise<{
    link: LinkWithOppositeNodeDto;
    lastFrameInSegment: number;
    distances: number[];
  } | null> {
    let bestLink: {
      link: LinkWithOppositeNodeDto;
      lastFrameInSegment: number;
      distances: number[];
    } | null = null;
    let fallbackLink: {
      link: LinkWithOppositeNodeDto;
      lastFrameInSegment: number;
      distances: number[];
    } | null = null;
    let bestHausdorffDistance = Number.MAX_VALUE;
    let maxProjectedLineStringLength = 0;

    for (const {
      frameLineString,
      projectedLineString,
      lastFrameInSegment,
      link,
      distances,
    } of lineStringsWithNodes as {
      frameLineString: string;
      projectedLineString: string;
      lastFrameInSegment: number;
      link: LinkWithOppositeNodeDto;
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
        frameLineString,
        projectedLineString,
      );
      this.processEndTime('calculateHausdorffDistance', startHausdorffTime);

      this.logToFile(
        `file: matchFrameAndLinkData.ts:283 ~ projectedLineString:${JSON.stringify(projectedLineString)}`,
        this.RESULT_LOG,
      );
      this.logToFile(
        `file: matchFrameAndLinkData.ts:283 ~ frameLineString:${JSON.stringify(frameLineString)}`,
        this.RESULT_LOG,
      );
      this.logToFile(
        `file: matchFrameAndLinkData.ts:283 ~ projectedLineString:${JSON.stringify(projectedLineString)}`,
        this.MATCHED_LOG,
      );
      this.logToFile(
        `file: matchFrameAndLinkData.ts:283 ~ lineString:${JSON.stringify(frameLineString)}`,
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
    lineString: any,
    projectedLineString: any,
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
    frameGeom: any,
    nodeId: number,
  ): Promise<number> {
    const result = (await this.nodeRepository.query(
      `SELECT ST_Distance($1::geography, geom::geography) AS distance FROM ${this.schema}.node WHERE id = $2;`,
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

  private async getLinksAndOppositeNodesFromCandidates(
    candidateLinkIds: number[],
    nodeId: number,
  ): Promise<LinkWithOppositeNodeDto[]> {
    const links = (await this.linkRepository.query(
      `
      WITH candidate_links AS (
        SELECT * FROM ${this.schema}.link WHERE id = ANY($1)
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
      JOIN ${this.schema}.node n ON n.id = 
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

  // LineString 길이 계산 함수
  private async calculateLineStringLength(lineString: string): Promise<number> {
    const result = (await this.frameRepository.query(
      `SELECT ST_Length($1::geography) AS length;`,
      [lineString],
    )) as Array<{ length: number | null }>;
    return result[0]?.length || 0;
  }

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

  // Node와 연결된 Link 및 가까운 Link를 가져오기

  private async getNearbyLinksFromCandidates(
    candidateLinkIds: number[],
    frameGeom: string,
    currentNodeId: number,
  ): Promise<LinkWithOppositeNodeDto[]> {
    const links = (await this.linkRepository.query(
      `
      WITH candidate_links AS (
        SELECT * FROM ${this.schema}.link WHERE id = ANY($1)
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
          ST_Distance(ns.geom, (SELECT geom FROM ${this.schema}.node WHERE id = $3)) AS distance_to_start,
          ST_Distance(ne.geom, (SELECT geom FROM ${this.schema}.node WHERE id = $3)) AS distance_to_end
        FROM candidate_links cl
        JOIN ${this.schema}.node ns ON cl.source = ns.id
        JOIN ${this.schema}.node ne ON cl.target = ne.id
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
        (SELECT geom FROM ${this.schema}.node WHERE id = 
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

  private removeDuplicateLinks(
    links: LinkWithOppositeNodeDto[],
  ): LinkWithOppositeNodeDto[] {
    const uniqueLinksMap = new Map<number, LinkWithOppositeNodeDto>();
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

  private async getValidDirectionVector(
    frames: FrameRow[],
    currentIndex: number,
  ): Promise<[number, number] | null> {
    const current = frames[currentIndex];
    this.logToFile(
      `AdvancedMapMatching ~ getValidDirectionVector ~ current:${JSON.stringify(current)}`,
      this.MATCHED_LOG,
    );
    const prev = currentIndex > 0 ? frames[currentIndex - 1] : null;
    this.logToFile(
      `AdvancedMapMatching ~ getValidDirectionVector ~ prev:${JSON.stringify(prev)}`,
      this.MATCHED_LOG,
    );
    const next =
      currentIndex < frames.length - 1 ? frames[currentIndex + 1] : null;
    this.logToFile(
      `AdvancedMapMatching ~ getValidDirectionVector ~ next:${JSON.stringify(next)}`,
      this.MATCHED_LOG,
    );

    const getDistance = async (p1: { geom: string }, p2: { geom: string }) =>
      this.calculateDistanceBetweenPoints(p1.geom, p2.geom);

    let vector: [number, number] | null = null;

    if (prev && next) {
      const distPrev = await getDistance(prev, current);
      this.logToFile(
        `AdvancedMapMatching ~ getValidDirectionVector ~ distPrev:${distPrev}`,
        this.MATCHED_LOG,
      );
      const distNext = await getDistance(current, next);
      this.logToFile(
        `AdvancedMapMatching ~ getValidDirectionVector ~ distNext:${distNext}`,
        this.MATCHED_LOG,
      );
      if (
        distPrev < this.gpsDistanceThreshold &&
        distNext < this.gpsDistanceThreshold
      ) {
        vector = this.calculateDirectionVectorFromXY(
          [prev.x, prev.y],
          [next.x, next.y],
        );
        this.logToFile(
          `AdvancedMapMatching ~ getValidDirectionVector ~ vector1:${JSON.stringify(vector)}`,
          this.MATCHED_LOG,
        );
      } else if (distPrev < this.gpsDistanceThreshold) {
        vector = this.calculateDirectionVectorFromXY(
          [prev.x, prev.y],
          [current.x, current.y],
        );
        this.logToFile(
          `AdvancedMapMatching ~ getValidDirectionVector ~ vector2:${JSON.stringify(vector)}`,
          this.MATCHED_LOG,
        );
      } else if (distNext < this.gpsDistanceThreshold) {
        vector = this.calculateDirectionVectorFromXY(
          [current.x, current.y],
          [next.x, next.y],
        );
        this.logToFile(
          `AdvancedMapMatching ~ getValidDirectionVector ~ vector3:${JSON.stringify(vector)}`,
          this.MATCHED_LOG,
        );
      }
    } else if (prev) {
      const dist = await getDistance(prev, current);
      if (dist < 10) {
        vector = this.calculateDirectionVectorFromXY(
          [prev.x, prev.y],
          [current.x, current.y],
        );
        this.logToFile(
          `AdvancedMapMatching ~ getValidDirectionVector ~ vector4:${JSON.stringify(vector)}`,
          this.MATCHED_LOG,
        );
      }
    } else if (next) {
      const dist = await getDistance(current, next);
      if (dist < 10) {
        vector = this.calculateDirectionVectorFromXY(
          [current.x, current.y],
          [next.x, next.y],
        );
        this.logToFile(
          `AdvancedMapMatching ~ getValidDirectionVector ~ vector5:${JSON.stringify(vector)}`,
          this.MATCHED_LOG,
        );
      }
    }

    return vector;
  }

  private calculateDirectionVectorFromXY(
    p1: [number, number],
    p2: [number, number],
  ): [number, number] {
    this.logToFile(
      `AdvancedMapMatching ~ isLinkDirectionInvalid - vehicleVector: p1=${JSON.stringify(p1)}`,
      this.MATCHED_LOG,
    );
    this.logToFile(
      `AdvancedMapMatching ~ isLinkDirectionInvalid - vehicleVector: p2=${JSON.stringify(p2)}`,
      this.MATCHED_LOG,
    );
    const dx = p2[0] - p1[0];
    const dy = p2[1] - p1[1];
    const length = Math.sqrt(dx * dx + dy * dy);
    return length === 0 ? [0, 0] : [dx / length, dy / length];
  }

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

  // 2. 기존 isLinkDirectionInvalid 수정
  private async isLinkDirectionInvalid(
    link: LinkWithOppositeNodeDto,
    frames: FrameRow[],
    currentIndex: number,
  ): Promise<boolean> {
    const highwayType = link.highway?.toLowerCase();
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
    this.logToFile(
      `AdvancedMapMatching ~ isLinkDirectionInvalid - vehicleVector: frame=${frames[currentIndex].id} - ${JSON.stringify(vehicleVector)}`,
      this.MATCHED_LOG,
    );
    if (!vehicleVector || (vehicleVector[0] === 0 && vehicleVector[1] === 0))
      return false;
    this.logToFile(
      `AdvancedMapMatching ~ isLinkDirectionInvalid - link.linkGeomText: ${link.linkGeomText}`,
      this.MATCHED_LOG,
    );
    const coords = link.linkGeomText.match(/[-\d.]+ [-\d.]+/g);
    this.logToFile(
      `AdvancedMapMatching ~ isLinkDirectionInvalid - coords: coords=${JSON.stringify(coords)} - ${link.linkGeomText}`,
      this.MATCHED_LOG,
    );
    if (!Array.isArray(coords) || coords.length < 2) return false;

    const [srcCoord, tgtCoord] = [coords[0], coords[coords.length - 1]];
    const src = srcCoord.split(' ').map(Number);
    const tgt = tgtCoord.split(' ').map(Number);
    const linkVector = this.calculateDirectionVectorFromXY(
      [src[0], src[1]],
      [tgt[0], tgt[1]],
    );
    this.logToFile(
      `AdvancedMapMatching ~ isLinkDirectionInvalid - linkVector: link=${link.linkid} - ${JSON.stringify(linkVector)}`,
      this.MATCHED_LOG,
    );

    const similarity = this.calculateCosineSimilarity(
      vehicleVector,
      linkVector,
    );
    this.logToFile(
      `AdvancedMapMatching ~ isLinkDirectionInvalid - similarity: frame=${frames[currentIndex].id} ~ link=${link.linkid} - ${similarity}`,
      this.MATCHED_LOG,
    );
    if (isNaN(similarity)) return false;
    return similarity < 0;
  }

  private async shouldExcludeLinkDueToMidEntryOnLayerLink(
    link: LinkWithOppositeNodeDto,
    frameGeom: string,
    frameRepo: Repository<Frame>,
    currentNodeId: number,
  ): Promise<boolean> {
    if (link.layer == null) return false;

    // 연결된 Link는 제외하지 않음
    if (link.source === currentNodeId || link.target === currentNodeId) {
      this.logToFile(
        ` AdvancedMapMatching ~ Link ${link.linkid} is connected to currentNode ${currentNodeId}, not excluded despite layer.`,
        this.MATCHED_LOG,
      );
      return false;
    }

    const ratioResult = (await frameRepo.query(
      `SELECT ST_LineLocatePoint($1, $2)::float AS ratio;`,
      [link.linkGeom, frameGeom],
    )) as { ratio: string }[];
    this.logToFile(
      ` AdvancedMapMatching ~ ratioResult : link-${link.linkid} ${JSON.stringify(ratioResult)}`,
      this.MATCHED_LOG,
    );

    const sourceDistResult = (await frameRepo.query(
      `SELECT ST_Distance(ST_StartPoint($1)::geography, $2::geography)::float AS dist;`,
      [link.linkGeom, frameGeom],
    )) as { dist: string }[];
    this.logToFile(
      ` AdvancedMapMatching ~ sourceDistResult : link-${link.linkid} ${JSON.stringify(sourceDistResult)}`,
      this.MATCHED_LOG,
    );

    const targetDistResult = (await frameRepo.query(
      `SELECT ST_Distance(ST_EndPoint($1)::geography, $2::geography)::float AS dist;`,
      [link.linkGeom, frameGeom],
    )) as { dist: string }[];
    this.logToFile(
      ` AdvancedMapMatching ~ targetDistResult : link-${link.linkid} ${JSON.stringify(targetDistResult)}`,
      this.MATCHED_LOG,
    );

    const ratio = parseFloat(ratioResult?.[0]?.ratio ?? '0');
    this.logToFile(
      ` AdvancedMapMatching ~ ratio : link-${link.linkid} ${ratio}`,
      this.MATCHED_LOG,
    );
    const distToSource = parseFloat(sourceDistResult?.[0]?.dist ?? '0');
    this.logToFile(
      ` AdvancedMapMatching ~ distToSource : link-${link.linkid} ${distToSource}`,
      this.MATCHED_LOG,
    );
    const distToTarget = parseFloat(targetDistResult?.[0]?.dist ?? '0');
    this.logToFile(
      ` AdvancedMapMatching ~ distToTarget : link-${link.linkid} ${distToTarget}`,
      this.MATCHED_LOG,
    );

    return ratio > 0.3 && ratio < 0.7 && distToSource > 10 && distToTarget > 10;
  }
}

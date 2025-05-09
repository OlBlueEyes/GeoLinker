import * as fs from 'fs';
import * as path from 'path';
import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { DataSource } from 'typeorm';
import { featureCollection } from '@turf/turf';
import { FeatureCollection, LineString, Point } from 'geojson';
import { getRequiredEnvStr } from 'src/common/utils/get-required-env';
import {
  SplitLinkSegment,
  OsmLinkRow,
} from 'src/common/types/link-data.interface';

@Injectable()
export class SplitOsmDataService {
  public splitError: string;
  public linkSplitLog: string;
  public splitProgress: string;
  public processTime: string;
  public osmDataPath: string;
  public targetCountry: string;
  constructor(
    private configService: ConfigService,
    private dataSource: DataSource,
  ) {
    this.splitError = getRequiredEnvStr(this.configService, 'SPLIT_ERROR');
    this.linkSplitLog = getRequiredEnvStr(this.configService, 'LINK_SPLIT');
    this.splitProgress = getRequiredEnvStr(
      this.configService,
      'SPLIT_PROGRESS',
    );
    this.processTime = getRequiredEnvStr(this.configService, 'PROCESS_TIME');
    this.osmDataPath = getRequiredEnvStr(this.configService, 'OSM_DATA_PATH');
    this.targetCountry = getRequiredEnvStr(
      this.configService,
      'TARGET_COUNTRY_KOREA',
    );
    // this.targetCountry = getRequiredEnvStr(
    //   this.configService,
    //   'TARGET_COUNTRY_SAUDI',
    // );
    // this.targetCountry = getRequiredEnvStr(
    //   this.configService,
    //   'TARGET_COUNTRY_SINGAPORE',
    // );
    // this.targetCountry = getRequiredEnvStr(
    //   this.configService,
    //   'TARGET_COUNTRY_UAE',
    // );
  }

  async processSplitForAllAreas(): Promise<void> {
    const startSplit = this.processStartTime('processSplitForAllAreas');
    const rootPath = this.getOutputFolder();
    const targetCountry = this.getTargetCountry();
    const countryPath = path.join(rootPath, targetCountry);

    if (!fs.existsSync(countryPath)) {
      const cnfMsg = `Country folder not found: ${countryPath}`;
      console.log(cnfMsg);
      this.logToFile(cnfMsg, this.splitError);
      return;
    }

    const areaDirs = fs
      .readdirSync(countryPath, { withFileTypes: true })
      .filter((d) => d.isDirectory());
    const totalAreas = areaDirs.length;

    const startTime = Date.now();
    fs.writeFileSync(
      this.splitProgress,
      `Split Link Progress Log\nStart Time: ${new Date().toISOString()}\n`,
      'utf-8',
    );

    for (let i = 0; i < areaDirs.length; i++) {
      const area = areaDirs[i];
      const areaPath = path.join(countryPath, area.name);
      const files = fs
        .readdirSync(areaPath)
        .filter((f) => f.endsWith('.geojson') && !f.includes('_node'));

      for (const linkFile of files) {
        const nodeFile = linkFile.replace('.geojson', '_node.geojson');
        const linkPath = path.join(areaPath, linkFile);
        const nodePath = path.join(areaPath, nodeFile);
        const outputPath = path.join(
          areaPath,
          linkFile.replace('.geojson', '_link.geojson'),
        );

        if (!fs.existsSync(nodePath)) {
          const skipMsg = `Node file not found, skipping: ${nodePath}`;
          console.warn(skipMsg);
          this.logToFile(skipMsg, this.splitError);
          fs.appendFileSync(this.splitProgress, `${skipMsg}\n`);
          continue;
        }

        const currentTime = Date.now();
        const elapsed = (currentTime - startTime) / 1000; // 초 단위
        const progress = ((i + 1) / totalAreas) * 100;
        const estimatedTotalTime = (elapsed / (i + 1)) * totalAreas;
        const eta = estimatedTotalTime - elapsed;

        const progressMsg = `[${i + 1}/${totalAreas}] ${area.name} / ${linkFile} | ${progress.toFixed(
          2,
        )}% complete | ETA ${this.formatSeconds(eta)}`;
        console.log(progressMsg);
        this.logToFile(progressMsg, this.splitProgress);
        fs.appendFileSync(this.splitProgress, `${progressMsg}\n`);

        await this.splitLinkDataByNode(linkPath, nodePath, outputPath);
      }
    }

    const endMsg = `All areas processed successfully! Total Time: ${this.formatSeconds(
      (Date.now() - startTime) / 1000,
    )}`;
    console.log(endMsg);
    this.logToFile(endMsg, this.splitProgress);
    // fs.appendFileSync(this.splitProgress, `${endMsg}\n`);
    this.processEndTime('processSplitForAllAreas', startSplit);
  }

  private getTargetCountry(): string {
    if (!this.targetCountry) {
      const tnfMsg = 'TARGET_COUNTRY not set, using default "South_Korea"';
      console.warn(tnfMsg);
      this.logToFile(tnfMsg, this.splitError);
      return 'South_Korea';
    }
    return this.targetCountry;
  }

  async splitLinkDataByNode(
    linkPath: string,
    nodePath: string,
    outputPath: string,
  ) {
    const start = this.processStartTime('splitLinksByNodes');
    const areaKey = this.sanitizeTableName(
      path.basename(outputPath).replace('.geojson', ''),
    );

    const tempLinkTable = `temp_link_${areaKey}`;
    const tempNodeTable = `temp_node_${areaKey}`;
    const splitLinksTable = `split_links_${areaKey}`;

    const startCreateTempTables = this.processStartTime('createTempTables');
    await this.createTempTables(tempLinkTable, tempNodeTable, splitLinksTable);
    this.processEndTime('createTempTables', startCreateTempTables);

    const startInsertDataIntoTempTables = this.processStartTime(
      'insertDataIntoTempTables',
    );
    await this.insertDataIntoTempTables(
      tempLinkTable,
      tempNodeTable,
      linkPath,
      nodePath,
    );
    this.processEndTime(
      'insertDataIntoTempTables',
      startInsertDataIntoTempTables,
    );

    const startInitialSplitLinks = this.processStartTime('initialSplitLinks');
    await this.initialSplitLinks(tempLinkTable, tempNodeTable, splitLinksTable);
    this.processEndTime('initialSplitLinks', startInitialSplitLinks);

    const startPostResplitLinks = this.processStartTime('postResplitLinks');
    // await this.postResplitLinks(splitLinksTable, tempNodeTable, tempLinkTable);
    await this.postResplitLinks(splitLinksTable, tempNodeTable);
    this.processEndTime('postResplitLinks', startPostResplitLinks);

    const startFinalSelfIntersectionSplit = this.processStartTime(
      'finalSelfIntersectionSplit',
    );
    await this.finalSelfIntersectionSplit(splitLinksTable);
    this.processEndTime(
      'finalSelfIntersectionSplit',
      startFinalSelfIntersectionSplit,
    );

    const finalGeoJson = await this.exportSplitLinks(splitLinksTable);
    this.saveJSONToFile(finalGeoJson, outputPath);

    await this.dropTempTables(tempLinkTable, tempNodeTable, splitLinksTable);

    this.processEndTime('splitLinksByNodes', start);
  }

  private sanitizeTableName(name: string): string {
    return name.toLowerCase().replace(/[^a-z0-9_]/g, '_');
  }

  private async createTempTables(
    tempLinkTable: string,
    tempNodeTable: string,
    splitLinksTable: string,
  ) {
    await this.dataSource.query(`
      DROP TABLE IF EXISTS ${tempLinkTable}, ${tempNodeTable}, ${splitLinksTable};
      CREATE TEMP TABLE ${tempLinkTable} (
        id SERIAL PRIMARY KEY,
        geom geometry(LineString, 4326),
        osm_id BIGINT,
        osm_type VARCHAR(255),
        highway VARCHAR(255),
        oneway VARCHAR(255),
        name_ko VARCHAR(255),
        name_en VARCHAR(255)
      );
      CREATE INDEX ON ${tempLinkTable} USING GIST(geom);
      CREATE TEMP TABLE ${tempNodeTable} (id SERIAL PRIMARY KEY, geom geometry(Point, 4326));
      CREATE INDEX ON ${tempNodeTable} USING GIST(geom);
      CREATE TEMP TABLE ${splitLinksTable} (
        id SERIAL PRIMARY KEY,
        geom geometry(LineString, 4326),
        osm_id BIGINT,
        osm_type VARCHAR(255),
        highway VARCHAR(255),
        oneway VARCHAR(255),
        name_ko VARCHAR(255),
        name_en VARCHAR(255)
      );
      CREATE INDEX ON ${splitLinksTable} USING GIST(geom);
    `);
  }

  private async insertDataIntoTempTables(
    tempLinkTable: string,
    tempNodeTable: string,
    linkPath: string,
    nodePath: string,
  ) {
    const rawLink = fs.readFileSync(linkPath, 'utf-8');
    const rawNode = fs.readFileSync(nodePath, 'utf-8');
    const parsedLink = JSON.parse(rawLink) as FeatureCollection<LineString>;
    const parsedNode = JSON.parse(rawNode) as FeatureCollection<Point>;

    await this.dataSource.query(
      `
      INSERT INTO ${tempLinkTable} (geom, osm_id, osm_type, highway, oneway, name_ko, name_en)
      SELECT ST_SetSRID(ST_GeomFromGeoJSON(feature->'geometry')::geometry, 4326),
        (feature->'properties'->>'osm_id')::BIGINT,
        feature->'properties'->>'osm_type',
        feature->'properties'->>'highway',
        feature->'properties'->>'oneway',
        feature->'properties'->>'name_ko',
        feature->'properties'->>'name_en'
      FROM jsonb_array_elements($1::jsonb->'features') AS feature
    `,
      [parsedLink],
    );

    await this.dataSource.query(
      `
      INSERT INTO ${tempNodeTable} (geom)
      SELECT ST_SetSRID(ST_GeomFromGeoJSON(feature->'geometry')::geometry, 4326)
      FROM jsonb_array_elements($1::jsonb->'features') AS feature
    `,
      [parsedNode],
    );
  }

  private async initialSplitLinks(
    tempLinkTable: string,
    tempNodeTable: string,
    splitLinksTable: string,
  ) {
    await this.dataSource.query(`
      INSERT INTO ${splitLinksTable} (geom, osm_id, osm_type, highway, oneway, name_ko, name_en)
      SELECT (ST_Dump(ST_Split(tl.geom, ST_Collect(tn.geom)))).geom,
      tl.osm_id, tl.osm_type, tl.highway, tl.oneway, tl.name_ko, tl.name_en
      FROM ${tempLinkTable} tl
      LEFT JOIN ${tempNodeTable} tn ON ST_DWithin(tl.geom, tn.geom, 0.00001)
      GROUP BY tl.id, tl.geom, tl.osm_id, tl.osm_type, tl.highway, tl.oneway, tl.name_ko, tl.name_en
    `);
  }

  private async postResplitLinks(
    splitLinksTable: string,
    tempNodeTable: string,
  ) {
    const problematicSegments: SplitLinkSegment[] = await this.dataSource
      .query(`
      SELECT id, geom, osm_id, osm_type, highway, oneway, name_ko, name_en
      FROM ${splitLinksTable}
      WHERE NOT ST_IsSimple(geom)
        OR (SELECT COUNT(*) FROM ${tempNodeTable} n WHERE ST_DWithin(n.geom, ${splitLinksTable}.geom, 0.00001)) >= 3
    `);

    const segCountMsg = `[PostResplit] Found ${problematicSegments.length} problematic segments.`;
    console.log(segCountMsg);
    this.logToFile(segCountMsg, this.linkSplitLog);

    let resplitCount = 0;

    for (const segment of problematicSegments) {
      const { id, geom, osm_id, osm_type, highway, oneway, name_ko, name_en } =
        segment;

      // 주변 Node 모으기
      const nodesResult: { geom: string }[] = await this.dataSource.query(`
        SELECT ST_Collect(geom) AS geom
        FROM ${tempNodeTable}
        WHERE ST_DWithin(geom, ST_GeomFromEWKT('SRID=4326;${geom}'), 0.00001)
        `);

      if (!nodesResult[0] || !nodesResult[0].geom) {
        const nodeNotFoundMsg = `[PostResplit] No nearby nodes found for segment ID ${id}, skipping.`;
        console.warn(nodeNotFoundMsg);
        this.logToFile(nodeNotFoundMsg, this.splitError);
        continue;
      }

      // Node가 너무 적으면 (0~1개) split 의미 없으니 패스
      const nodeCountResult: { count: string }[] = await this.dataSource.query(`
        SELECT COUNT(*) AS count
        FROM ${tempNodeTable}
        WHERE ST_DWithin(geom, ST_GeomFromEWKT('SRID=4326;${geom}'), 0.00001)
      `);

      const nodeCount = parseInt(nodeCountResult[0].count, 10);
      if (nodeCount <= 1) {
        const skipSplitMsg = `[PostResplit] Only ${nodeCount} node(s) near segment ID ${id}, skipping split.`;
        console.log(skipSplitMsg);
        this.logToFile(skipSplitMsg, this.linkSplitLog);
        continue;
      }

      // Split 시도
      const splitResult: { geom: string }[] = await this.dataSource.query(`
        SELECT (ST_Dump(
          ST_Split(ST_GeomFromEWKT('SRID=4326;${geom}'), ST_GeomFromEWKT('SRID=4326;${nodesResult[0].geom}'))
        )).geom AS geom
      `);

      if (splitResult.length > 1) {
        // 기존 segment 삭제
        await this.dataSource.query(
          `DELETE FROM ${splitLinksTable} WHERE id = $1`,
          [id],
        );

        // 분할된 segment 저장 (속성 직접 넣기)
        for (const r of splitResult) {
          await this.dataSource.query(
            `
            INSERT INTO ${splitLinksTable} (geom, osm_id, osm_type, highway, oneway, name_ko, name_en)
            VALUES (
              $1::geometry,
              $2::bigint, $3::varchar, $4::varchar, $5::varchar, $6::varchar, $7::varchar
            )
          `,
            [r.geom, osm_id, osm_type, highway, oneway, name_ko, name_en],
          );
        }

        resplitCount++;
      }
    }
    const resplitMsg = `[PostResplit] Successfully re-split ${resplitCount} segments out of ${problematicSegments.length}.`;
    console.log(resplitMsg);
    this.logToFile(resplitMsg, this.linkSplitLog);
  }

  private async finalSelfIntersectionSplit(splitLinksTable: string) {
    const beforeResult: Array<{ count: string }> = await this.dataSource.query(`
      SELECT COUNT(*) AS count
      FROM ${splitLinksTable}
      WHERE NOT ST_IsSimple(geom)
    `);
    const beforeCount = parseInt(beforeResult[0].count, 10);
    const countSiMsg = `[SelfIntersection] Before fixing: ${beforeCount} self-intersected segments.`;
    console.log(countSiMsg);
    this.logToFile(countSiMsg, this.linkSplitLog);

    const selfIntersectedSegments: SplitLinkSegment[] = await this.dataSource
      .query(`
      SELECT id, ST_AsGeoJSON(geom) AS geom,
             osm_id, osm_type, highway, oneway, name_ko, name_en
      FROM ${splitLinksTable}
      WHERE NOT ST_IsSimple(geom)
    `);

    for (const segment of selfIntersectedSegments) {
      const { id, geom, osm_id, osm_type, highway, oneway, name_ko, name_en } =
        segment;
      const geomObj = JSON.parse(geom) as {
        type: 'LineString';
        coordinates: [number, number][];
      };
      const coords = geomObj.coordinates;

      const seen = new Map<string, number>();
      let currentSegment: [number, number][] = [];
      const segments: [number, number][][] = [];

      for (let i = 0; i < coords.length; i++) {
        const coord = coords[i];
        const coordKey = coord.join(',');

        currentSegment.push(coord);

        if (seen.has(coordKey)) {
          if (currentSegment.length >= 2) {
            segments.push([...currentSegment]);
          }
          currentSegment = [coord];
          seen.clear();
        } else {
          seen.set(coordKey, i);
        }
      }

      if (currentSegment.length >= 2) {
        segments.push(currentSegment);
      }

      // 기존 self-intersected segment 삭제
      await this.dataSource.query(
        `
        DELETE FROM ${splitLinksTable}
        WHERE id = $1
      `,
        [id],
      );

      // 잘라낸 segments를 LineString으로 다시 INSERT (바인딩 파라미터로)
      for (const segmentCoords of segments) {
        const pointsSql = segmentCoords
          .map(([lng, lat]) => `ST_MakePoint(${lng}, ${lat})`)
          .join(', ');

        const insertSql = `
          INSERT INTO ${splitLinksTable} (geom, osm_id, osm_type, highway, oneway, name_ko, name_en)
          VALUES (
            ST_SetSRID(ST_MakeLine(ARRAY[${pointsSql}]), 4326),
            $1, $2, $3, $4, $5, $6
          )
        `;

        await this.dataSource.query(insertSql, [
          osm_id,
          osm_type,
          highway,
          oneway,
          name_ko,
          name_en,
        ]);
      }
    }

    const afterResult: Array<{ count: string }> = await this.dataSource.query(`
      SELECT COUNT(*) AS count
      FROM ${splitLinksTable}
      WHERE NOT ST_IsSimple(geom)
    `);

    const afterCount = parseInt(afterResult[0].count, 10);

    const afterFixMsg = `[SelfIntersection] After fixing: ${afterCount} self-intersected segments remaining.`;
    const fixedSegCountMsg = `[SelfIntersection] Fixed ${beforeCount - afterCount} segments out of ${beforeCount}.`;
    console.log(afterFixMsg);
    this.logToFile(afterFixMsg, this.linkSplitLog);
    console.log(fixedSegCountMsg);
    this.logToFile(fixedSegCountMsg, this.linkSplitLog);
  }

  private async exportSplitLinks(
    splitLinksTable: string,
  ): Promise<FeatureCollection<LineString>> {
    const rows: OsmLinkRow[] = await this.dataSource.query(`
      SELECT ST_AsGeoJSON(geom) AS geometry, osm_id, osm_type, highway, oneway, name_ko, name_en
      FROM ${splitLinksTable}
    `);

    const features: Array<GeoJSON.Feature<LineString>> = rows.map((row) => ({
      type: 'Feature',
      geometry: JSON.parse(row.geometry) as LineString,
      properties: {
        osm_id: row.osm_id,
        osm_type: row.osm_type,
        highway: row.highway,
        oneway: row.oneway,
        name_ko: row.name_ko,
        name_en: row.name_en,
      },
    }));

    return featureCollection(features);
  }

  private saveJSONToFile(
    data: FeatureCollection<LineString>,
    outputPath: string,
  ) {
    const folder = path.dirname(outputPath);
    if (!fs.existsSync(folder)) {
      fs.mkdirSync(folder, { recursive: true });
    }
    fs.writeFileSync(outputPath, JSON.stringify(data, null, 2), 'utf-8');
    const saveJsonMsg = `Saved GeoJSON to ${outputPath}`;
    console.log(saveJsonMsg);
    this.logToFile(saveJsonMsg, this.linkSplitLog);
  }

  private async dropTempTables(...tables: string[]) {
    for (const table of tables) {
      await this.dataSource.query(`DROP TABLE IF EXISTS ${table}`);
    }
  }

  private getOutputFolder(): string {
    if (!this.osmDataPath) {
      throw new Error('OSM_DATA_PATH is not defined in environment variables.');
    }
    const today = new Date();
    const formatted = `${today.getFullYear()}${String(today.getMonth() + 1).padStart(2, '0')}${String(
      today.getDate(),
    ).padStart(2, '0')}`;
    return path.join(this.osmDataPath, `${formatted}_OSM`);
  }

  private processStartTime(funcName: string): number {
    const startMsg = `Start ${funcName}`;
    console.log(startMsg);
    this.logToFile(startMsg, this.processTime);
    return Date.now();
  }

  private processEndTime(funcName: string, startTime: number) {
    const endMsg = `End ${funcName}, took ${Date.now() - startTime} ms`;
    console.log(endMsg);
    this.logToFile(endMsg, this.processTime);
    console.log();
  }

  private formatSeconds(seconds: number): string {
    const m = Math.floor(seconds / 60);
    const s = Math.floor(seconds % 60);
    return `${m}m ${s}s`;
  }

  private getLogFolder(): string {
    const basePath = this.configService.get<string>('OSM_DATA_PATH');
    if (!basePath) {
      throw new Error(
        'OSM_DATA_PATH is not defined in the environment variables.',
      );
    }
    return path.join(this.getOutputFolder(), 'log', this.targetCountry);
  }

  // 로그 파일에 메시지 기록하는 함수 수정
  private logToFile(message: string, fileName: string) {
    const logFolderPath = this.getLogFolder();
    const filePath = path.join(logFolderPath, fileName);

    try {
      if (!fs.existsSync(logFolderPath)) {
        fs.mkdirSync(logFolderPath, { recursive: true });
      }
      const logmsg = `${new Date().toISOString()} - ${message}`;
      fs.appendFileSync(filePath, logmsg + '\n', 'utf-8');
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : String(error);
      const logErrorMsg = `Failed to write log to file: ${errorMessage}`;
      console.error(logErrorMsg);
      this.logToFile(logErrorMsg, this.splitError);
    }
  }
}

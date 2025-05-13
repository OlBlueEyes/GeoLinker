import * as fs from 'fs';
import * as path from 'path';
import { Injectable } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { featureCollection } from '@turf/turf';
import { FeatureCollection, LineString, Point } from 'geojson';
import {
  SplitLinkSegment,
  OsmLinkRow,
} from 'src/common/types/link-data.interface';
import { LoggingUtil } from 'src/common/utils/logger.util';
import { OSM_COUNTRIES } from 'src/common/constants/osm-country.constants';
import { WINSTON_MODULE_PROVIDER } from 'nest-winston';
import { Inject } from '@nestjs/common';
import { Logger } from 'winston';
import { EnvConfigService } from 'src/config/env-config.service';

@Injectable()
export class SplitOsmDataService {
  public targetCountry: string;
  constructor(
    @Inject(WINSTON_MODULE_PROVIDER)
    private readonly logger: Logger,
    private dataSource: DataSource,
    private readonly loggingUtil: LoggingUtil,
    private readonly envConfigService: EnvConfigService,
  ) {}

  async processSplitForAllAreas(countryName: string): Promise<void> {
    const normalize = (str: string) =>
      str.toLowerCase().replace(/[^a-z0-9]/gi, '');

    const matched = OSM_COUNTRIES.find(
      (c) => normalize(c.name) === normalize(countryName),
    );

    if (!matched) {
      const errMsg = `Invalid country name: ${countryName}`;
      this.logSplit(errMsg, this.envConfigService.splitError);
      console.error(errMsg);
      this.logger.error(`[SPLIT ERROR] Invalid country name: ${countryName}`);
      return;
    }
    this.targetCountry = matched.name;

    this.logger.info(`[SPLIT TIME] Start processSplitForAllAreas`);

    const rootPath = this.loggingUtil.getOutputFolder();
    const countryPath = path.join(rootPath, this.targetCountry);

    if (!fs.existsSync(countryPath)) {
      const cnfMsg = `Country folder not found: ${countryPath}`;
      console.log(cnfMsg);
      this.logSplit(cnfMsg, this.envConfigService.splitError);
      this.logger.error(
        `[SPLIT ERROR] Country folder not found: ${countryPath}`,
      );
      return;
    }

    const areaDirs = fs
      .readdirSync(countryPath, { withFileTypes: true })
      .filter((d) => d.isDirectory());
    const totalAreas = areaDirs.length;

    const startTime = Date.now();
    fs.writeFileSync(
      this.envConfigService.splitProgress,
      `Split Link Progress Log - Start Time: ${new Date().toISOString()}\n`,
      'utf-8',
    );
    this.logger.info(
      `[SPLIT] Split Link Progress Log - Start Time: ${new Date().toISOString()}\n`,
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
          this.logSplit(skipMsg, this.envConfigService.splitError);
          fs.appendFileSync(
            this.envConfigService.splitProgress,
            `${skipMsg}\n`,
          );
          this.logger.warn(
            `[SPLIT WARNING] Node file not found, skipping: ${nodePath}`,
          );
          continue;
        }

        const currentTime = Date.now();
        const elapsed = (currentTime - startTime) / 1000; // 초 단위
        const progress = ((i + 1) / totalAreas) * 100;
        const estimatedTotalTime = (elapsed / (i + 1)) * totalAreas;
        const eta = estimatedTotalTime - elapsed;

        const progressMsg = `[${i + 1}/${totalAreas}] ${area.name} / ${linkFile} | ${progress.toFixed(
          2,
        )}% complete | ETA ${this.loggingUtil.formatSeconds(eta)}`;
        console.log(progressMsg);
        this.logSplit(progressMsg, this.envConfigService.splitProgress);
        fs.appendFileSync(
          this.envConfigService.splitProgress,
          `${progressMsg}\n`,
        );
        this.logger.info(
          `[SPLIT] [${i + 1}/${totalAreas}] ${area.name} / ${linkFile} | ${progress.toFixed(
            2,
          )}% complete | ETA ${this.loggingUtil.formatSeconds(eta)}`,
        );

        await this.splitLinkDataByNode(linkPath, nodePath, outputPath);
      }
    }

    const endMsg = `All areas processed successfully! Total Time: ${this.loggingUtil.formatSeconds(
      (Date.now() - startTime) / 1000,
    )}`;
    console.log(endMsg);
    this.logSplit(endMsg, this.envConfigService.splitProgress);
    this.logger.info(
      `[SPLIT] All areas processed successfully! Total Time: ${this.loggingUtil.formatSeconds(
        (Date.now() - startTime) / 1000,
      )}`,
    );
    // fs.appendFileSync(this.envConfigService.splitProgress, `${endMsg}\n`);
    // this.loggingUtil.processEndTime('processSplitForAllAreas', startSplit);
  }

  async splitLinkDataByNode(
    linkPath: string,
    nodePath: string,
    outputPath: string,
  ) {
    // const start = this.loggingUtil.processStartTime('splitLinksByNodes');
    const areaKey = this.sanitizeTableName(
      path.basename(outputPath).replace('.geojson', ''),
    );

    const tempLinkTable = `temp_link_${areaKey}`;
    const tempNodeTable = `temp_node_${areaKey}`;
    const splitLinksTable = `split_links_${areaKey}`;

    // const startCreateTempTables =
    //   this.loggingUtil.processStartTime('createTempTables');
    await this.createTempTables(tempLinkTable, tempNodeTable, splitLinksTable);
    // this.loggingUtil.processEndTime('createTempTables', startCreateTempTables);

    // const startInsertDataIntoTempTables = this.loggingUtil.processStartTime(
    //   'insertDataIntoTempTables',
    // );
    await this.insertDataIntoTempTables(
      tempLinkTable,
      tempNodeTable,
      linkPath,
      nodePath,
    );
    // this.loggingUtil.processEndTime(
    //   'insertDataIntoTempTables',
    //   startInsertDataIntoTempTables,
    // );

    // const startInitialSplitLinks =
    //   this.loggingUtil.processStartTime('initialSplitLinks');
    await this.initialSplitLinks(tempLinkTable, tempNodeTable, splitLinksTable);
    // this.loggingUtil.processEndTime(
    //   'initialSplitLinks',
    //   startInitialSplitLinks,
    // );

    // const startPostResplitLinks =
    //   this.loggingUtil.processStartTime('postResplitLinks');
    // await this.postResplitLinks(splitLinksTable, tempNodeTable, tempLinkTable);
    await this.postResplitLinks(splitLinksTable, tempNodeTable);
    // this.loggingUtil.processEndTime('postResplitLinks', startPostResplitLinks);

    // const startFinalSelfIntersectionSplit = this.loggingUtil.processStartTime(
    //   'finalSelfIntersectionSplit',
    // );
    await this.finalSelfIntersectionSplit(splitLinksTable);
    // this.loggingUtil.processEndTime(
    //   'finalSelfIntersectionSplit',
    //   startFinalSelfIntersectionSplit,
    // );

    const finalGeoJson = await this.exportSplitLinks(splitLinksTable);
    this.saveJSONToFile(finalGeoJson, outputPath);

    await this.dropTempTables(tempLinkTable, tempNodeTable, splitLinksTable);

    // this.loggingUtil.processEndTime('splitLinksByNodes', start);
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
    this.logSplit(segCountMsg, this.envConfigService.linkSplit);
    this.logger.info(
      `[SPLIT] PostResplit - Found ${problematicSegments.length} problematic segments.`,
    );

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
        this.logSplit(nodeNotFoundMsg, this.envConfigService.splitError);
        this.logger.warn(
          `[SPLIT WARNING] PostResplit - No nearby nodes found for segment ID ${id}, skipping.`,
        );
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
        this.logSplit(skipSplitMsg, this.envConfigService.linkSplit);
        this.logger.info(
          `[SPLIT] PostResplit - Only ${nodeCount} node(s) near segment ID ${id}, skipping split.`,
        );
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
    this.logSplit(resplitMsg, this.envConfigService.linkSplit);
    this.logger.info(
      `[SPLIT] PostResplit - Successfully re-split ${resplitCount} segments out of ${problematicSegments.length}.`,
    );
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
    this.logSplit(countSiMsg, this.envConfigService.linkSplit);
    this.logger.info(
      `[SPLIT] SelfIntersection - Before fixing: ${beforeCount} self-intersected segments.`,
    );

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
    this.logSplit(afterFixMsg, this.envConfigService.linkSplit);
    console.log(fixedSegCountMsg);
    this.logSplit(fixedSegCountMsg, this.envConfigService.linkSplit);
    this.logger.info(
      `[SPLIT] SelfIntersection - After fixing: ${afterCount} self-intersected segments remaining.`,
    );
    this.logger.info(
      `[SPLIT] SelfIntersection - Fixed ${beforeCount - afterCount} segments out of ${beforeCount}.`,
    );
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
    this.logSplit(saveJsonMsg, this.envConfigService.linkSplit);
    this.logger.info(`[SPLIT] Saved GeoJSON to ${outputPath}`);
  }

  private async dropTempTables(...tables: string[]) {
    for (const table of tables) {
      await this.dataSource.query(`DROP TABLE IF EXISTS ${table}`);
    }
  }

  private logSplit(message: string, fileName: string) {
    const safeCountry = this.targetCountry ?? 'unknown';
    this.loggingUtil.splitLogToFile(message, fileName, safeCountry);
  }
}

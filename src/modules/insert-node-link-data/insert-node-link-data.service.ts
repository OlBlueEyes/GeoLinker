import * as fs from 'fs';
import * as path from 'path';
import { Injectable } from '@nestjs/common';
import { DataSource, EntityManager, IsNull, Repository } from 'typeorm';
import { FeatureCollection, Point, LineString } from 'geojson';
import { InjectRepository } from '@nestjs/typeorm';
import { FinalNodeTable } from 'src/shared/entities/final_node_table.entity';
import { FinalLinkTable } from 'src/shared/entities/final_link_table.entity';
import { LoggingUtil } from 'src/modules/map-matching/utils/logger.util';
import { WINSTON_MODULE_PROVIDER } from 'nest-winston';
import { Inject } from '@nestjs/common';
import { Logger } from 'winston';
import { OSM_COUNTRIES } from 'src/common/constants/osm-country.constants';
import { EnvConfigService } from 'src/config/env-config.service';

@Injectable()
export class InsertNodeLinkDataService {
  private osmDataPath: string;
  private batchSize = 1000;
  private targetCountry: string;

  constructor(
    @Inject(WINSTON_MODULE_PROVIDER)
    private readonly logger: Logger,

    @InjectRepository(FinalNodeTable)
    private readonly nodeRepository: Repository<FinalNodeTable>,

    @InjectRepository(FinalLinkTable)
    private readonly linkRepository: Repository<FinalLinkTable>,

    private dataSource: DataSource,
    private loggingUtil: LoggingUtil,
    private readonly envConfigService: EnvConfigService,
  ) {}

  async insertAllNodesAndLinks(countryName: string): Promise<void> {
    const normalize = (str: string) =>
      str.toLowerCase().replace(/[^a-z0-9]/gi, '');

    const matched = OSM_COUNTRIES.find(
      (c) => normalize(c.name) === normalize(countryName),
    );

    if (!matched) {
      const errMsg = `Invalid country name: ${countryName}`;
      console.error(errMsg);
      this.logger.error(`[SPLIT ERROR] Invalid country name: ${countryName}`);
      return;
    }
    this.targetCountry = matched.name;
    await this.loggingUtil.logDatabaseInfo();

    await this.createFinalTablesIfNotExist();
    this.osmDataPath = this.loggingUtil.getOutputFolder();
    const basePath = path.join(this.osmDataPath, this.targetCountry);

    if (!fs.existsSync(basePath)) {
      throw new Error(`Base path not found: ${basePath}`);
    }

    const areaDirs = fs
      .readdirSync(basePath, { withFileTypes: true })
      .filter((d) => d.isDirectory());
    const total = areaDirs.length;

    await this.createTempTables();

    for (let i = 0; i < areaDirs.length; i++) {
      const area = areaDirs[i];
      const areaPath = path.join(basePath, area.name);
      const files = fs.readdirSync(areaPath);

      const nodeFile = files.find((f) => f.endsWith('_node.geojson'));
      const linkFile = files.find((f) => f.endsWith('_link.geojson'));

      if (!nodeFile || !linkFile) {
        console.warn(`Skipping area ${area.name} (missing node or split file)`);
        continue;
      }

      console.log(`[${i + 1}/${total}] Processing ${area.name}...`);

      const nodePath = path.join(areaPath, nodeFile);
      const linkPath = path.join(areaPath, linkFile);

      const areaStart = Date.now();
      await this.dataSource.transaction(async (manager) => {
        await this.insertNodesFromFile(manager, nodePath);
        await this.insertLinksFromFile(manager, linkPath);
      });

      const areaDuration = Date.now() - areaStart;

      console.log(
        `[${i + 1}/${total}] Finished ${area.name} in ${areaDuration} ms`,
      );
    }

    await this.deduplicateAndInsertFinal();
    await this.dropTempTables();

    console.log('All nodes and links inserted successfully!');
  }

  private async createTempTables() {
    await this.dataSource.query(`
      DROP TABLE IF EXISTS temp_node, temp_link;
      CREATE TEMP TABLE temp_node (
        id SERIAL PRIMARY KEY,
        geom geometry(Point, 4326)
      );
      CREATE TEMP TABLE temp_link (
        id SERIAL PRIMARY KEY,
        geom geometry(LineString, 4326),
        osm_id VARCHAR(255),
        osm_type VARCHAR(255),
        highway VARCHAR(255),
        oneway VARCHAR(255),
        layer VARCHAR(255),
        name_ko VARCHAR(255),
        name_en VARCHAR(255)
      );
      CREATE INDEX ON temp_node USING GIST(geom);
      CREATE INDEX ON temp_link USING GIST(geom);
    `);
  }

  private async insertNodesFromFile(manager: EntityManager, nodePath: string) {
    const raw = fs.readFileSync(nodePath, 'utf-8');
    const parsed = JSON.parse(raw) as FeatureCollection<Point>;
    const features = parsed.features.filter(
      (f) => f.geometry?.type === 'Point',
    );

    for (let i = 0; i < features.length; i += this.batchSize) {
      const batch = features.slice(i, i + this.batchSize);
      await manager.query(
        `INSERT INTO temp_node (geom)
         SELECT ST_SetSRID(ST_GeomFromGeoJSON(feature->'geometry')::geometry, 4326)
         FROM jsonb_array_elements($1::jsonb) AS feature`,
        [JSON.stringify(batch)],
      );
    }
  }

  private async insertLinksFromFile(manager: EntityManager, linkPath: string) {
    const raw = fs.readFileSync(linkPath, 'utf-8');
    const parsed = JSON.parse(raw) as FeatureCollection<LineString>;
    const features = parsed.features.filter(
      (f) => f.geometry?.type === 'LineString',
    );

    for (let i = 0; i < features.length; i += this.batchSize) {
      const batch = features.slice(i, i + this.batchSize);
      await manager.query(
        `INSERT INTO temp_link (geom, osm_id, osm_type, highway, oneway, layer, name_ko, name_en)
         SELECT 
           ST_SetSRID(ST_GeomFromGeoJSON(feature->'geometry')::geometry, 4326),
           feature->'properties'->>'osm_id',
           feature->'properties'->>'osm_type',
           feature->'properties'->>'highway',
           feature->'properties'->>'oneway',
           feature->'properties'->>'layer',
           feature->'properties'->>'name_ko',
           feature->'properties'->>'name_en'
         FROM jsonb_array_elements($1::jsonb) AS feature`,
        [JSON.stringify(batch)],
      );
    }
  }

  private async deduplicateAndInsertFinal() {
    await this.dataSource.query(`
      INSERT INTO ${this.envConfigService.schema}.final_node_table (geom)
      SELECT DISTINCT ON (ST_AsText(geom)) geom
      FROM temp_node;
    `);

    await this.dataSource.query(`
      INSERT INTO ${this.envConfigService.schema}.final_link_table (geom, osm_id, osm_type, highway, oneway, layer, name_ko, name_en, source, target, expiration_date)
      SELECT geom, osm_id, osm_type, highway, oneway, layer, name_ko, name_en, NULL, NULL, NULL
      FROM (
        SELECT DISTINCT ON (geom_hash) geom, osm_id, osm_type, highway, oneway, layer, name_ko, name_en
        FROM (
          SELECT geom, osm_id, osm_type, highway, oneway, layer, name_ko, name_en,
                 md5(ST_AsText(geom)) AS geom_hash
          FROM temp_link
        ) sub
      ) sub2;
    `);
  }

  private async dropTempTables() {
    await this.dataSource.query(`DROP TABLE IF EXISTS temp_node, temp_link`);
  }

  private getTodayFolder(): string {
    const today = new Date();
    return `${today.getFullYear()}${String(today.getMonth() + 1).padStart(2, '0')}${String(
      today.getDate(),
    ).padStart(2, '0')}_OSM`;
  }

  private async createFinalTablesIfNotExist() {
    await this.dataSource.query(`
      DO $$
      BEGIN
        -- Create final_node_table if not exists
        IF NOT EXISTS (
          SELECT FROM information_schema.tables 
          WHERE table_schema = '${this.envConfigService.schema}' AND table_name = 'final_node_table'
        ) THEN
          EXECUTE '
            CREATE TABLE ${this.envConfigService.schema}.final_node_table (
              id SERIAL PRIMARY KEY,
              geom geometry(Point, 4326)
            );
          ';
          EXECUTE '
            CREATE INDEX final_node_geom_idx 
            ON ${this.envConfigService.schema}.final_node_table USING GIST (geom);
          ';
        END IF;
  
        -- Create final_link_table if not exists
        IF NOT EXISTS (
          SELECT FROM information_schema.tables 
          WHERE table_schema = '${this.envConfigService.schema}' AND table_name = 'final_link_table'
        ) THEN
          EXECUTE '
            CREATE TABLE ${this.envConfigService.schema}.final_link_table (
              id SERIAL PRIMARY KEY,
              geom geometry(LineString, 4326),
              osm_id VARCHAR(255),
              osm_type VARCHAR(255),
              highway VARCHAR(255),
              oneway VARCHAR(255),
              layer VARCHAR(255),
              name_ko VARCHAR(255),
              name_en VARCHAR(255),
              source INTEGER,
              target INTEGER,
              expiration_date TIMESTAMPTZ
            );
          ';
          EXECUTE '
            CREATE INDEX final_link_geom_idx 
            ON ${this.envConfigService.schema}.final_link_table USING GIST (geom);
          ';
        END IF;
      END
      $$;
    `);
  }

  async insertNodeIdsInFinal(): Promise<void> {
    await this.loggingUtil.logDatabaseInfo();

    try {
      this.logger.info(`[INSERT TIME] Start Insert Node ID In Link`);
      const totalLinks = await this.linkRepository.count({
        where: [{ source: IsNull() }, { target: IsNull() }],
      });
      this.logger.info(`[INSERT] Total Links to process: ${totalLinks}`);

      // 전체 노드 개수 확인
      const totalNodes = await this.nodeRepository.count();
      this.logger.info(`[INSERT] Total Nodes in database: ${totalNodes}`);

      if (totalLinks === 0) return;

      this.logger.info(
        '[INSERT] Starting process to insert Node IDs into Links.',
      );

      // Start Node 업데이트
      this.logger.info('[INSERT] Updating source in link table...');
      const startNodeResult: unknown = await this.linkRepository.query(`
          UPDATE ${this.envConfigService.schema}.final_link_table
          SET source = sub.node_id
          FROM (
              SELECT l.id AS link_id, n.id AS node_id
              FROM ${this.envConfigService.schema}.final_link_table l
              JOIN ${this.envConfigService.schema}.final_node_table n
              ON n.geom && ST_Expand(ST_StartPoint(l.geom), 0.00001)
              AND ST_DWithin(ST_StartPoint(l.geom), n.geom, 0.00001)
              
              ORDER BY ST_Distance(ST_StartPoint(l.geom), n.geom) ASC
          ) AS sub
          WHERE ${this.envConfigService.schema}.final_link_table.id = sub.link_id;
        `);

      if (
        Array.isArray(startNodeResult) &&
        typeof startNodeResult[1] === 'number'
      ) {
        this.logger.info(`[INSERT] Updated source: ${startNodeResult[1]} rows`);
      } else {
        this.logger.warn(
          `[INSERT WARNING] Unexpected startNodeResult: ${JSON.stringify(startNodeResult)}`,
        );
      }

      // End Node 업데이트
      this.logger.info('[INSERT] Updating target in link table...');
      const endNodeResult: unknown = await this.linkRepository.query(`
          UPDATE ${this.envConfigService.schema}.final_link_table
          SET target = sub.node_id
          FROM (
              SELECT l.id AS link_id, n.id AS node_id
              FROM ${this.envConfigService.schema}.final_link_table l
              JOIN ${this.envConfigService.schema}.final_node_table n
              ON n.geom && ST_Expand(ST_EndPoint(l.geom), 0.00001)
              AND ST_DWithin(ST_EndPoint(l.geom), n.geom, 0.00001)
              
              ORDER BY ST_Distance(ST_EndPoint(l.geom), n.geom) ASC
          ) AS sub
          WHERE ${this.envConfigService.schema}.final_link_table.id = sub.link_id;
        `);
      if (
        Array.isArray(endNodeResult) &&
        typeof endNodeResult[1] === 'number'
      ) {
        this.logger.info(`[INSERT] Updated target: ${endNodeResult[1]} rows`);
      } else {
        this.logger.warn(
          `[INSERT WARNING] Unexpected endNodeResult: ${JSON.stringify(endNodeResult)}`,
        );
      }

      this.logger.info(
        '[INSERT] Process to insert Node IDs completed successfully.',
      );

      this.logger.info(`[INSERT TIME] End Update of source and target`);
    } catch (error) {
      const errorMsg =
        error instanceof Error ? error.message : JSON.stringify(error);
      this.logger.error(`[INSERT ERROR] Error during bulk update: ${errorMsg}`);
      this.logger.error('[INSERT ERROR] Failed to update node IDs in bulk.');
      throw new Error('Failed to update node IDs in bulk.');
    }
  }

  async insertAdminBoundariesFromFolder(countryName: string): Promise<void> {
    const folderPath = path.join(
      this.loggingUtil.getOutputFolder(),
      this.sanitizeName(countryName),
      'admin_boundary',
    );

    if (!fs.existsSync(folderPath)) {
      this.logger.warn(
        `[INSERT] No admin_boundary folder found for ${countryName}`,
      );
      return;
    }

    const files = fs
      .readdirSync(folderPath)
      .filter((f) => f.endsWith('.geojson'));

    if (files.length === 0) {
      this.logger.warn(
        `[INSERT] No .geojson files found in admin_boundary folder of ${countryName}`,
      );
      return;
    }

    for (const file of files) {
      const filePath = path.join(folderPath, file);
      this.logger.info(`[INSERT] Start inserting from file: ${filePath}`);
      await this.insertAdminBoundariesFromGeoJSON(filePath);
    }

    this.logger.info(
      `[INSERT] All admin boundaries inserted for ${countryName}`,
    );
  }

  private async createAdminBoundaryTableIfNotExist() {
    this.logger.info(
      `[INSERT] Checked or created admin_boundary table in schema '${this.envConfigService.schema}'`,
    );
    await this.dataSource.query(`
    DO $$
    BEGIN
      IF NOT EXISTS (
        SELECT FROM information_schema.tables
        WHERE table_schema = '${this.envConfigService.schema}' AND table_name = 'admin_boundary'
      ) THEN
        EXECUTE '
          CREATE TABLE ${this.envConfigService.schema}.admin_boundary (
            id SERIAL PRIMARY KEY,
            osm_id BIGINT,
            name_ko VARCHAR(255),
            name_en VARCHAR(255),
            admin_level INTEGER,
            geom GEOMETRY(MultiPolygon, 4326)
          );
        ';
        EXECUTE '
          CREATE INDEX admin_boundary_geom_idx
          ON ${this.envConfigService.schema}.admin_boundary USING GIST (geom);
        ';
      END IF;
    END
    $$;
  `);
  }

  async insertAdminBoundariesFromGeoJSON(filePath: string): Promise<void> {
    await this.createAdminBoundaryTableIfNotExist();

    const raw = fs.readFileSync(filePath, 'utf-8');
    const parsed = JSON.parse(raw) as FeatureCollection;
    const features = parsed.features.filter(
      // (f) => f.geometry?.type === 'Polygon',
      (f) => f.geometry?.type === 'MultiPolygon',
    );

    if (features.length === 0) {
      this.logger.warn(
        `[INSERT] No MultiPolygon features found in ${filePath}`,
      );
      return;
    }

    const batchSize = 500;
    for (let i = 0; i < features.length; i += batchSize) {
      const batch = features.slice(i, i + batchSize);
      this.logger.info(
        `[INSERT] Inserting admin boundaries batch ${i + 1}~${Math.min(
          i + batchSize,
          features.length,
        )} of ${features.length} from ${path.basename(filePath)}`,
      );

      await this.dataSource.query(
        `INSERT INTO ${this.envConfigService.schema}.admin_boundary
       (osm_id, name_ko, name_en, admin_level, geom)
       SELECT
         (feature->'properties'->>'osm_id')::BIGINT,
         feature->'properties'->>'name_ko',
         feature->'properties'->>'name_en',
         (feature->'properties'->>'admin_level')::INTEGER,
         ST_SetSRID(ST_GeomFromGeoJSON(feature->'geometry')::geometry, 4326)
       FROM jsonb_array_elements($1::jsonb) AS feature`,
        [JSON.stringify(batch)],
      );
    }

    this.logger.info(
      `[INSERT] Inserted ${features.length} admin boundaries from ${filePath}`,
    );
  }

  private sanitizeName(name: string): string {
    return name.replace(/\s+/g, '_').trim().toLowerCase();
  }
}

// 분할된 Link 정렬하는 부분 X
import * as fs from 'fs';
import * as path from 'path';
import { Injectable } from '@nestjs/common';
import { HttpService } from '@nestjs/axios';
import { ConfigService } from '@nestjs/config';
import { lastValueFrom } from 'rxjs';
import { featureCollection, lineString } from '@turf/turf';
import {
  Feature,
  FeatureCollection,
  LineString,
  Point,
  Geometry,
} from 'geojson';
import { DataSource } from 'typeorm';
import {
  OverpassElement,
  OverpassResponse,
} from 'src/common/types/overpass-element.interface';
import { WINSTON_MODULE_PROVIDER } from 'nest-winston';
import { EnvConfigService } from 'src/config/env-config.service';
import { Inject } from '@nestjs/common';
import { Logger } from 'winston';
import { OSM_COUNTRIES } from 'src/common/constants/osm-country.constants';

@Injectable()
export class ImportOsmDataService {
  public searchExpansion: number;
  constructor(
    @Inject(WINSTON_MODULE_PROVIDER)
    private readonly logger: Logger,
    private readonly httpService: HttpService,
    private configService: ConfigService,
    private readonly dataSource: DataSource,
    private readonly envConfigService: EnvConfigService,
  ) {}

  async processNodeLinkData(city: string) {
    const normalize = (str: string) =>
      str.toLowerCase().replace(/[^a-z0-9]/gi, '');

    const targetCountry = OSM_COUNTRIES.find(
      (c) => normalize(c.name) === normalize(city),
    );

    if (!targetCountry) {
      this.logger.error(`[IMPORT ERROR] Unknown country: ${city}`);
      throw new Error(`Unknown country: ${city}`);
    }

    this.logger.info(`[IMPORT TIME] Start processNodeLinkData`);
    const filePathList = await this.fetchHighwayData(targetCountry);
    await this.generateNodesFromLinkFiles(filePathList);

    this.logger.info(`[IMPORT TIME] End processNodeLinkData`);
  }

  async fetchHighwayData(targetCountry: {
    name: string;
    relationId: number;
  }): Promise<string[]> {
    const filePathList: string[] = [];

    const areaId = 3600000000 + targetCountry.relationId;

    const baseUrl = 'https://overpass-api.de/api/interpreter';
    const maxRetries = 3;

    const getCountryName = async (): Promise<string> => {
      try {
        const res = await lastValueFrom(
          this.httpService.post(
            baseUrl,
            `
            [out:json][timeout:25];
            relation(${targetCountry.relationId});
            out tags;
          `,
            {
              headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
            },
          ),
        );

        const data = res.data as OverpassResponse;
        const matched = data.elements?.[0];
        return (
          matched?.tags?.['name:en'] ||
          matched?.tags?.name ||
          `unknown-country-${targetCountry.relationId}`
        );
      } catch (err) {
        if (err instanceof Error) {
          console.warn();
          this.logger.warn(
            `[IMPORT WARNING] Failed to fetch country name: ${err.message}`,
          );
        } else {
          this.logger.warn(
            '[IMPORT WARNING] Failed to fetch country name: unknown error',
          );
        }
        return 'unknown-country';
      }
    };

    const buildAdminAreaQuery = (level: number): string => `
    [out:json][timeout:60];
    area(${areaId})->.country;
    (
      relation["boundary"="administrative"]["admin_level"="${level}"](area.country);
    );
    out ids tags;
    `;

    let areaInfoList: {
      areaId: number;
      admin_ko: string;
      admin_en: string;
      country: string;
    }[] = [];

    try {
      const countryName = await getCountryName();

      const fetchAdminAreas = async (adminLevel: number) => {
        const res = await lastValueFrom(
          this.httpService.post(baseUrl, buildAdminAreaQuery(adminLevel), {
            headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
          }),
        );

        const data = res.data as OverpassResponse;

        return data.elements
          .filter((el) => el.type === 'relation')
          .map((el: OverpassElement) => ({
            areaId: 3600000000 + el.id,
            admin_ko:
              el.tags?.['name:ko'] || el.tags?.name || `unknown-${el.id}`,
            admin_en:
              el.tags?.['name:en'] || el.tags?.name || `unknown-${el.id}`,
            country: countryName,
          }));
      };

      try {
        areaInfoList = await fetchAdminAreas(4);
        if (areaInfoList.length < 2) {
          this.logToFile(
            `admin_level=4 insufficient results (${areaInfoList.length}), retrying with admin_level=6`,
            this.envConfigService.dataImport,
          );
          this.logger.info(
            `[IMPORT] admin_level=4 insufficient results (${areaInfoList.length}), retrying with admin_level=6`,
          );
          areaInfoList = await fetchAdminAreas(6);
        }
      } catch (err) {
        if (err instanceof Error) {
          this.logger.error(
            `[IMPORT ERROR] Failed to fetch admin areas (admin_level=4,6): ${err.message}`,
          );
          throw new Error(
            `Failed to fetch admin areas (admin_level=4,6): ${err.message}`,
          );
        }
        this.logger.error(
          `[IMPORT ERROR] Failed to fetch admin areas (admin_level=4,6): Unknown error`,
        );
        throw new Error(
          'Failed to fetch admin areas (admin_level=4,6): Unknown error',
        );
      }
    } catch (err) {
      if (err instanceof Error) {
        this.logger.error(
          `[IMPORT ERROR] Failed to fetch admin areas: ${err.message}`,
        );
        throw new Error(`Failed to fetch admin areas: ${err.message}`);
      }
      this.logger.error(
        `[IMPORT ERROR] Failed to fetch admin areas (admin_level=4,6): Unknown error`,
      );
      throw new Error('Failed to fetch admin areas: Unknown error');
    }

    const highwayQuery = (areaId: number) => `
    [out:json][timeout:1000];
    area(${areaId})->.area_0;
    (
        node["highway"="living_street"](area.area_0);
        node["highway"="motorway"](area.area_0);
        node["highway"="motorway_link"](area.area_0);
        node["highway"="primary"](area.area_0);
        node["highway"="primary_link"](area.area_0);
        node["highway"="residential"](area.area_0);
        node["highway"="road"](area.area_0);
        node["highway"="secondary"](area.area_0);
        node["highway"="secondary_link"](area.area_0);
        node["highway"="service"](area.area_0);
        node["highway"="tertiary"](area.area_0);
        node["highway"="tertiary_link"](area.area_0);
        node["highway"="trunk"](area.area_0);
        node["highway"="trunk_link"](area.area_0);
        node["highway"="unclassified"](area.area_0);
        way["highway"="living_street"](area.area_0);
        way["highway"="motorway"](area.area_0);
        way["highway"="motorway_link"](area.area_0);
        way["highway"="primary"](area.area_0);
        way["highway"="primary_link"](area.area_0);
        way["highway"="residential"](area.area_0);
        way["highway"="road"](area.area_0);
        way["highway"="secondary"](area.area_0);
        way["highway"="secondary_link"](area.area_0);
        way["highway"="service"](area.area_0);
        way["highway"="tertiary"](area.area_0);
        way["highway"="tertiary_link"](area.area_0);
        way["highway"="trunk"](area.area_0);
        way["highway"="trunk_link"](area.area_0);
        way["highway"="unclassified"](area.area_0);
        relation["highway"="living_street"](area.area_0);
        relation["highway"="motorway"](area.area_0);
        relation["highway"="motorway_link"](area.area_0);
        relation["highway"="primary"](area.area_0);
        relation["highway"="primary_link"](area.area_0);
        relation["highway"="residential"](area.area_0);
        relation["highway"="road"](area.area_0);
        relation["highway"="secondary"](area.area_0);
        relation["highway"="secondary_link"](area.area_0);
        relation["highway"="service"](area.area_0);
        relation["highway"="tertiary"](area.area_0);
        relation["highway"="tertiary_link"](area.area_0);
        relation["highway"="trunk"](area.area_0);
        relation["highway"="trunk_link"](area.area_0);
        relation["highway"="unclassified"](area.area_0);
    );
    (._;>;);
    out geom;
  `;

    const failedAreas: {
      areaId: number;
      admin_ko: string;
      admin_en: string;
      country: string;
    }[] = [];

    for (const { areaId, admin_ko, admin_en, country } of areaInfoList) {
      let success = false;
      let attempts = 0;

      while (!success && attempts < maxRetries) {
        try {
          const res = await lastValueFrom(
            this.httpService.post(baseUrl, highwayQuery(areaId), {
              headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
            }),
          );

          if ((res.data as OverpassResponse).elements?.length) {
            const geoJsonData = this.convertToGeoJSON(
              res.data as OverpassResponse,
            );
            console.log(
              ` ImportOsmData ~ fetchHighwayData ~ ${country} - ${admin_en}, :`,
            );
            const sanitizedFileName = this.sanitizeName(
              `${admin_en}_${areaId}.geojson`,
            );
            this.saveLinkJSONToFile(
              geoJsonData,
              admin_en,
              country,
              sanitizedFileName,
            );
            const savedPath = path.join(
              this.getOutputFolder(),
              this.sanitizeName(country),
              this.sanitizeName(admin_en),
              sanitizedFileName,
            );
            filePathList.push(savedPath);
            geoJsonData.features.length = 0;
          }
          success = true;
          const completeMsg = `${admin_en}(${admin_ko}) (${areaId}) completed`;
          console.log(`completeMsg`);
          this.logToFile(completeMsg, this.envConfigService.dataImport);
          this.logger.info(
            `[IMPORT] ${admin_en}(${admin_ko}) (${areaId}) completed`,
          );
        } catch (err) {
          attempts++;
          const attemptFaileMsg =
            err instanceof Error
              ? `${admin_en} (${areaId}) attempt ${attempts} failed: ${err.message}`
              : `${admin_en} (${areaId}) attempt ${attempts} failed: unknown error`;
          console.log(`attemptFaileMsg`);
          this.logToFile(attemptFaileMsg, this.envConfigService.dataImport);
          this.logger.error(`[IMPORT ERROR] ${attemptFaileMsg}`);
        }
      }

      if (!success) {
        failedAreas.push({ areaId, admin_ko, admin_en, country });
      }
    }

    for (const { areaId, admin_ko, admin_en, country } of failedAreas) {
      try {
        const res = await lastValueFrom(
          this.httpService.post(baseUrl, highwayQuery(areaId), {
            headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
          }),
        );

        const data = res.data as OverpassResponse;
        if (data?.elements?.length) {
          const geoJsonData = this.convertToGeoJSON(data);
          console.log(
            ` ImportOsmData ~ fetchHighwayData ~ ${country} - ${admin_en}, :`,
          );
          const sanitizedFileName = this.sanitizeName(
            `${admin_en}_${areaId}.geojson`,
          );
          this.saveLinkJSONToFile(
            geoJsonData,
            admin_en,
            country,
            sanitizedFileName,
          );
          const savedPath = path.join(
            this.getOutputFolder(),
            this.sanitizeName(country),
            this.sanitizeName(admin_en),
            sanitizedFileName,
          );
          filePathList.push(savedPath);
          geoJsonData.features.length = 0;
          const retryMsg = `Retry succeeded: ${admin_ko} - ${admin_en} (${areaId})`;
          this.logger.info(`[IMPORT] ${retryMsg}`);

          console.log(`retryMsg`);
          this.logToFile(retryMsg, this.envConfigService.dataImport);
        }
      } catch (err) {
        const failMsg =
          err instanceof Error
            ? `Final failure: ${admin_en} (${areaId}) - ${err.message}`
            : `Final failure: ${admin_en} (${areaId}) - unknown error`;
        console.log(`failMsg`);
        this.logToFile(failMsg, this.envConfigService.dataImport);
        this.logger.error(`[IMPORT ERROR] ${failMsg}`);
      }
    }

    return filePathList;
  }

  async generateNodesFromLinkFiles(filePathList: string[]): Promise<void> {
    const allTasks: Promise<void>[] = [];

    for (const filePath of filePathList) {
      const nodeOutputPath = filePath.replace('.geojson', '_node.geojson');
      const task = this.generateNodeFromLinkFileInDB(filePath, nodeOutputPath);
      allTasks.push(task);
    }

    await Promise.all(allTasks);
    console.log('Node file generation completed for selected country');
    this.logger.info(
      `[IMPORT] Node file generation completed for selected country`,
    );
  }

  async generateNodeFromLinkFileInDB(
    linkFilePath: string,
    outputPath: string,
  ): Promise<void> {
    const sanitizeTableName = (name: string) => {
      return name.toLowerCase().replace(/[^a-z0-9_]/g, '_');
    };
    const areaKey = sanitizeTableName(
      path.basename(outputPath).replace('_node.geojson', ''),
    );
    const tempTable = `temp_link_data_${areaKey}`;

    try {
      const raw: string = fs.readFileSync(linkFilePath, 'utf-8');
      const parsed = JSON.parse(raw) as FeatureCollection<LineString>;

      // 1. DROP + CREATE
      await this.dataSource.query(`DROP TABLE IF EXISTS ${tempTable}`);
      await this.dataSource.query(`
        CREATE TABLE ${tempTable} (
          id SERIAL PRIMARY KEY,
          geom GEOMETRY(LineString, 4326),
          osm_id BIGINT
        );
        CREATE INDEX ON ${tempTable} USING GIST(geom);
      `);

      // 2. INSERT
      await this.dataSource.query(
        `
        INSERT INTO ${tempTable} (geom, osm_id)
        SELECT ST_SetSRID(ST_GeomFromGeoJSON(feature->'geometry')::geometry, 4326), (feature->'properties'->>'osm_id')::BIGINT
        FROM jsonb_array_elements($1::jsonb->'features') AS feature
      `,
        [parsed],
      );

      type PostGISGeoJSONResult = {
        geojson: {
          type: 'FeatureCollection';
          features: Array<{
            type: 'Feature';
            geometry: {
              type: string;
              coordinates: number[] | number[][] | number[][][];
            };
            properties: {
              type: 'node';
            };
          }>;
        };
      }[];

      // 3. Node 추출
      const result: PostGISGeoJSONResult = await this.dataSource.query(`
        WITH endpoints AS (
          SELECT ST_StartPoint(geom) AS geom FROM ${tempTable}
          UNION ALL
          SELECT ST_EndPoint(geom) FROM ${tempTable}
        ),
        intersections AS (
          SELECT ST_Intersection(a.geom, b.geom) AS geom
          FROM ${tempTable} a
          JOIN ${tempTable} b ON a.id < b.id AND ST_Intersects(a.geom, b.geom)
        ),
        union_nodes AS (
          SELECT geom FROM endpoints
          UNION
          SELECT geom FROM intersections
        )
        SELECT jsonb_build_object(
          'type', 'FeatureCollection',
          'features', jsonb_agg(
            jsonb_build_object(
              'type', 'Feature',
              'geometry', ST_AsGeoJSON(geom)::jsonb,
              'properties', jsonb_build_object('type', 'node')
            )
          )
        ) AS geojson
        FROM (
          SELECT DISTINCT ON (ST_AsText(geom)) geom
          FROM union_nodes
        ) sub;
      `);

      const rawGeojson = result[0]?.geojson as {
        type: string;
        features: Array<{
          type: string;
          geometry: { type: string };
          properties: Record<string, unknown>;
        }>;
      };
      // fs.writeFileSync(outputPath, JSON.stringify(result[0].geojson, null, 2), 'utf-8');
      fs.writeFileSync(
        outputPath,
        JSON.stringify(
          {
            type: 'FeatureCollection',
            features: (rawGeojson?.features || []).filter(
              (f) => f.geometry?.type === 'Point',
            ),
          },
          null,
          2,
        ),
        'utf-8',
      );
      console.log(`Node file generation completed: ${outputPath}`);
      this.logger.info(
        `[IMPORT] Node file generation completed: ${outputPath}`,
      );
    } catch (err) {
      if (err instanceof Error) {
        console.warn(
          `Node generation failed (${linkFilePath}): ${err.message}`,
        );
        this.logger.warn(
          `[IMPORT WARNING] Node file generation completed: ${outputPath}`,
        );
      } else {
        console.warn(`Node generation failed (${linkFilePath}): unknown error`);
        this.logger.warn(
          `[IMPORT WARNING] Node generation failed (${linkFilePath}): unknown error`,
        );
      }
    } finally {
      // 4. 테이블 삭제
      await this.dataSource.query(`DROP TABLE IF EXISTS ${tempTable}`);
    }
  }

  private convertToGeoJSON(
    overpassData: OverpassResponse,
  ): FeatureCollection<Point | LineString> {
    const features: Feature<Point | LineString>[] = [];

    overpassData.elements.forEach((element) => {
      if (
        typeof element === 'object' &&
        element !== null &&
        'type' in element &&
        'geometry' in element &&
        element.type === 'way' &&
        Array.isArray((element as { geometry }).geometry)
      ) {
        const way = element as {
          id: number;
          type: string;
          geometry: Array<{ lon: number; lat: number }>;
          tags?: Record<string, string>;
        };

        const coordinates = way.geometry.map((g) => [g.lon, g.lat]);

        const tags = way.tags ?? {};
        const properties = {
          osm_id: way.id,
          osm_type: 'way',
          highway: tags.highway ?? null,
          oneway: tags.oneway ?? null,
          name_ko: tags['name:ko'] ?? null,
          name_en: tags['name:en'] ?? null,
        };

        features.push({
          type: 'Feature',
          geometry: lineString(coordinates).geometry,
          properties,
        });
      }
    });

    return featureCollection(features);
  }

  // 수집 일자 폴더 생성 함수
  private getOutputFolder(): string {
    const basePath = this.configService.get<string>('DATA_PATH');
    if (!basePath) {
      this.logger.error(
        `[IMPORT ERROR] DATA_PATH is not defined in the environment variables.`,
      );
      throw new Error('DATA_PATH is not defined in the environment variables.');
    }
    const date = new Date();
    const formattedDate = `${date.getFullYear()}${String(date.getMonth() + 1).padStart(2, '0')}${String(
      date.getDate(),
    ).padStart(2, '0')}`;
    return path.join(basePath, `${formattedDate}_OSM`);
  }

  private saveLinkJSONToFile(
    data: FeatureCollection,
    admin_en: string,
    country: string,
    fileName: string,
  ) {
    const sanitizedAdminEn = this.sanitizeName(admin_en);
    const sanitizedCountry = this.sanitizeName(country);
    const sanitizedFileName = this.sanitizeName(fileName);
    const folderPath = path.join(
      this.getOutputFolder(),
      sanitizedCountry,
      sanitizedAdminEn,
    );
    const filePath = path.join(folderPath, sanitizedFileName);
    console.log(` ImportOsmData ~ saveLinkJSONToFile ~ filePath:`, filePath);

    try {
      if (!fs.existsSync(folderPath)) {
        fs.mkdirSync(folderPath, { recursive: true });
      }

      data.features = data.features.map((feature) => {
        const typedFeature = feature as Feature<
          Geometry,
          { [key: string]: unknown }
        >;
        if (
          typedFeature.properties &&
          typeof typedFeature.properties.type === 'string'
        ) {
          return {
            type: typedFeature.type,
            geometry: typedFeature.geometry,
            properties: {},
          };
        }
        return typedFeature;
      });

      fs.writeFileSync(filePath, JSON.stringify(data, null, 2), 'utf-8');
      const jsonSavedMsg = `GeoJSON data saved to ${filePath}`;
      console.log(jsonSavedMsg);
      this.logToFile(jsonSavedMsg, this.envConfigService.dataImport);
      this.logger.info(`[IMPORT] ${jsonSavedMsg}`);
    } catch (error) {
      const jsonErrorMsg =
        error instanceof Error
          ? `Failed to save GeoJSON data: ${error.message}`
          : 'Failed to save GeoJSON data: unknown error';
      console.log(jsonErrorMsg);
      this.logToFile(jsonErrorMsg, this.envConfigService.dataImport);
      this.logger.error(`[IMPORT ERROR] ${jsonErrorMsg}`);

      throw error;
    }
  }

  // 로그 파일에 메시지 기록하는 함수 수정
  private logToFile(message: string, fileName: string) {
    const logFolderPath = this.getLogFolder();
    const filePath = path.join(logFolderPath, fileName);
    // console.log(`ImportNodeLinkData ~ logToFile ~ filePath:`, filePath);

    try {
      if (!fs.existsSync(logFolderPath)) {
        fs.mkdirSync(logFolderPath, { recursive: true });
      }
      const logmsg = `${new Date().toISOString()} - ${message}`;
      fs.appendFileSync(filePath, logmsg + '\n', 'utf-8');
      // console.log(logmsg);
    } catch (error) {
      const logErrorMsg =
        error instanceof Error
          ? `Failed to write log to file: ${error.message}`
          : 'Failed to write log to file: unknown error';
      console.error(logErrorMsg);
      this.logger.error(`[IMPORT ERROR] ${logErrorMsg}`);
    }
  }

  private getLogFolder(): string {
    const basePath = this.configService.get<string>('LOG_PATH');
    if (!basePath) {
      this.logger.error(
        `[IMPORT ERROR] LOG_PATH is not defined in the environment variables.`,
      );
      throw new Error('LOG_PATH is not defined in the environment variables.');
    }
    const date = new Date();
    const formattedDate = `${date.getFullYear()}${String(date.getMonth() + 1).padStart(2, '0')}${String(
      date.getDate(),
    ).padStart(2, '0')}`;
    return path.join(basePath, `${formattedDate}_OSM`, 'log');
  }

  private sanitizeName(name: string): string {
    return name.replace(/\s+/g, '_').trim();
  }
}

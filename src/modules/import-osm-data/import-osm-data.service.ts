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
  // Polygon,
  MultiPolygon,
} from 'geojson';
import { DataSource } from 'typeorm';
import {
  OverpassElement,
  OverpassResponse,
} from 'src/common/types/overpass-element.interface';
import { WINSTON_MODULE_PROVIDER } from 'nest-winston';
import { LoggingUtil } from 'src/modules/map-matching/utils/logger.util';
import { Inject } from '@nestjs/common';
import { Logger } from 'winston';
import { OSM_COUNTRIES } from 'src/common/constants/osm-country.constants';
import { EnvConfigService } from 'src/config/env-config.service';

@Injectable()
export class ImportOsmDataService {
  public searchExpansion: number;
  constructor(
    @Inject(WINSTON_MODULE_PROVIDER)
    private readonly logger: Logger,
    private readonly httpService: HttpService,
    private configService: ConfigService,
    private readonly dataSource: DataSource,
    private readonly loggingUtil: LoggingUtil,
    private readonly envConfigService: EnvConfigService,
  ) {}

  async processNodeLinkData(city: string) {
    const { end: endProcessData } = this.loggingUtil.startTimer(
      'processNodeLinkData',
      'IMPORT',
    );
    const normalize = (str: string) =>
      str.toLowerCase().replace(/[^a-z0-9]/gi, '');

    const targetCountry = OSM_COUNTRIES.find(
      (c) => normalize(c.name) === normalize(city),
    );

    if (!targetCountry) {
      this.logger.error(`[IMPORT ERROR] Unknown country: ${city}`);
      throw new Error(`Unknown country: ${city}`);
    }
    const filePathList = await this.fetchHighwayData(targetCountry);
    await this.generateNodesFromLinkFiles(filePathList);

    endProcessData();
  }

  async fetchHighwayData(targetCountry: {
    name: string;
    relationId: number;
  }): Promise<string[]> {
    const { end: endFetchData } = this.loggingUtil.startTimer(
      'fetchHighwayData',
      'IMPORT',
    );
    const filePathList: string[] = [];

    const areaId = 3600000000 + targetCountry.relationId;

    const maxRetries = 3;

    this.logger.info(`getCountryName Start`);
    const getCountryName = async (): Promise<string> => {
      try {
        const res = await lastValueFrom(
          this.httpService.post(
            this.envConfigService.overpassUrl,
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
      const { end: endGetCountryName } = this.loggingUtil.startTimer(
        'Query - getCountryName',
        'IMPORT',
      );
      const countryName = await getCountryName();
      endGetCountryName();

      const fetchAdminAreas = async (adminLevel: number) => {
        const res = await lastValueFrom(
          this.httpService.post(
            this.envConfigService.overpassUrl,
            buildAdminAreaQuery(adminLevel),
            {
              headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
            },
          ),
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
        const { end: endBuildAdminAreaQuery } = this.loggingUtil.startTimer(
          'Query - buildAdminAreaQuery',
          'IMPORT',
        );
        areaInfoList = await fetchAdminAreas(4);
        endBuildAdminAreaQuery();

        if (areaInfoList.length < 2) {
          // this.logToFile(
          //   `admin_level=4 insufficient results (${areaInfoList.length}), retrying with admin_level=6`,
          //   this.envConfigService.dataImport,
          // );
          this.logger.info(
            `[IMPORT] admin_level=4 insufficient results (${areaInfoList.length}), retrying with admin_level=6`,
          );
          const { end: endBuildAdminAreaQuery } = this.loggingUtil.startTimer(
            'Query - buildAdminAreaQuery',
            'IMPORT',
          );
          areaInfoList = await fetchAdminAreas(6);
          endBuildAdminAreaQuery();
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
        success = await this.fetchAndSaveHighwayData(
          areaId,
          admin_ko,
          admin_en,
          country,
          filePathList,
          false,
        );
        attempts++;
      }

      if (!success) {
        failedAreas.push({ areaId, admin_ko, admin_en, country });
      }
    }

    for (const { areaId, admin_ko, admin_en, country } of failedAreas) {
      await this.fetchAndSaveHighwayData(
        areaId,
        admin_ko,
        admin_en,
        country,
        filePathList,
        true,
      );
    }

    endFetchData();
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
          layer: tags.layer ?? null,
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
      // this.logToFile(jsonSavedMsg, this.envConfigService.dataImport);
      this.logger.info(`[IMPORT] ${jsonSavedMsg}`);
    } catch (error) {
      const jsonErrorMsg =
        error instanceof Error
          ? `Failed to save GeoJSON data: ${error.message}`
          : 'Failed to save GeoJSON data: unknown error';
      console.log(jsonErrorMsg);
      // this.logToFile(jsonErrorMsg, this.envConfigService.dataImport);
      this.logger.error(`[IMPORT ERROR] ${jsonErrorMsg}`);

      throw error;
    }
  }

  private sanitizeName(name: string): string {
    return name.replace(/\s+/g, '_').trim();
  }

  private async fetchAndSaveHighwayData(
    areaId: number,
    admin_ko: string,
    admin_en: string,
    country: string,
    filePathList: string[],
    isRetry = false,
  ): Promise<boolean> {
    try {
      const { end: endHighwayQuery } = this.loggingUtil.startTimer(
        'Query - highwayQuery',
        'IMPORT',
      );
      const res = await lastValueFrom(
        this.httpService.post(
          this.envConfigService.overpassUrl,
          this.highwayQuery(areaId),
          {
            headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
          },
        ),
      );
      endHighwayQuery();

      const data = res.data as OverpassResponse;
      if (data?.elements?.length) {
        const geoJsonData = this.convertToGeoJSON(data);
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

        const successMsg = isRetry
          ? `Retry succeeded: ${admin_ko} - ${admin_en} (${areaId})`
          : `${admin_en}(${admin_ko}) (${areaId}) completed`;

        this.logger.info(`[IMPORT] ${successMsg}`);
      }
      return true;
    } catch (err) {
      const failMsg =
        err instanceof Error
          ? `${admin_en} (${areaId}) failed: ${err.message}`
          : `${admin_en} (${areaId}) failed: unknown error`;
      const logPrefix = isRetry ? 'Final failure' : 'attempt';
      this.logger.error(`[IMPORT ERROR] ${logPrefix} - ${failMsg}`);
      return false;
    }
  }

  private highwayQuery(areaId: number): string {
    return `
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
  }

  async importAdminBoundaries(countryName: string): Promise<void> {
    const relations =
      await this.fetchAdminBoundaryRelationsFromOverpass(countryName);
    const features = this.convertRelationsToFeatures(relations);

    this.logger.info(
      `[IMPORT] ${features.length} valid administrative boundaries extracted.`,
    );

    const geojsonData: FeatureCollection = {
      type: 'FeatureCollection',
      features,
    };

    const filePath = this.saveGeoJSONToFile(countryName, geojsonData);
    this.logger.info(
      `[IMPORT] Saved ${features.length} boundaries to ${filePath}`,
    );
  }

  // 1. Overpass에서 행정경계 relation 조회
  private async fetchAdminBoundaryRelationsFromOverpass(
    countryName: string,
  ): Promise<OverpassElement[]> {
    const normalize = (str: string) =>
      str.toLowerCase().replace(/[^a-z0-9]/gi, '');
    const target = OSM_COUNTRIES.find(
      (c) => normalize(c.name) === normalize(countryName),
    );
    if (!target) throw new Error(`Unknown country: ${countryName}`);

    const areaId = 3600000000 + target.relationId;
    const overpassUrl = this.envConfigService.overpassUrl;
    if (!overpassUrl) throw new Error('Overpass API URL is undefined');

    this.logger.info(
      `[IMPORT] Sending Overpass query for ${countryName} admin boundaries...`,
    );

    const query = `
    [out:json][timeout:180];
    area(${areaId})->.country;
    (
      relation["boundary"="administrative"]["admin_level"](area.country);
    );
    out geom;
    >;
    out geom;
  `;
    this.logger.info(`[IMPORT] Query:\n${query}`);

    this.logger.info(
      `[IMPORT] Starting Overpass query for admin boundaries...`,
    );

    const res = await lastValueFrom(
      this.httpService.post(overpassUrl, query, {
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      }),
    );

    this.logger.info(`[IMPORT] Overpass query completed, parsing results...`);

    const data = res.data as OverpassResponse;

    this.logger.info(
      `[IMPORT] Retrieved ${data.elements.length} elements from Overpass.`,
    );

    return data.elements.filter(
      (el) =>
        el.type === 'relation' &&
        el.tags?.['admin_level'] &&
        el.tags?.['boundary'] === 'administrative' &&
        el.tags?.['type'] === 'boundary',
    );
  }

  // 2. relation → Feature[] 변환
  private convertRelationsToFeatures(relations: OverpassElement[]): Feature[] {
    const features: Feature[] = [];

    for (const rel of relations) {
      const osm_id = rel.id;
      const nameKo = rel.tags?.['name:ko'] ?? null;
      const nameEn = rel.tags?.['name:en'] ?? null;
      const name = rel.tags?.['name'] ?? null;

      let name_ko = nameKo;
      let name_en = nameEn;

      if (!name_ko && name && /[가-힣]/.test(name)) {
        name_ko = name;
      }

      if (!name_en && name && !/[가-힣]/.test(name)) {
        name_en = name;
      }

      const admin_level = parseInt(rel.tags?.['admin_level'] ?? '', 10);
      if (isNaN(admin_level)) continue;

      if (
        !('members' in rel) ||
        !Array.isArray((rel as { members: unknown }).members)
      )
        continue;

      const members = (
        rel as {
          members: {
            role: string;
            geometry?: { lon: number; lat: number }[];
          }[];
        }
      ).members;

      const outerWays = members.filter(
        (m) => m.role === 'outer' && Array.isArray(m.geometry),
      );
      if (outerWays.length === 0) continue;

      const rings = this.buildOrderedRings(
        outerWays as { geometry: { lon: number; lat: number }[] }[],
      );
      if (rings.length === 0) continue;

      const multiPolygon: MultiPolygon = {
        type: 'MultiPolygon',
        coordinates: rings
          .map((coords) => {
            if (coords.length < 3) return null;
            const [first, last] = [coords[0], coords[coords.length - 1]];
            if (first[0] !== last[0] || first[1] !== last[1])
              coords.push(first);
            return [coords];
          })
          .filter((c): c is [number, number][][] => c !== null),
      };

      if (multiPolygon.coordinates.length === 0) continue;

      features.push({
        type: 'Feature',
        geometry: multiPolygon,
        properties: {
          osm_id,
          name_ko,
          name_en,
          admin_level,
        },
      });
    }

    return features;
  }

  // 3. polygon을 연결하여 MultiPolygon ring 구성
  private buildOrderedRings(
    ways: { geometry: { lon: number; lat: number }[] }[],
  ): [number, number][][] {
    const toTuple = (p: { lon: number; lat: number }) =>
      [p.lon, p.lat] as [number, number];
    const rings: [number, number][][] = [];
    const used = new Set<number>();

    for (let i = 0; i < ways.length; i++) {
      if (used.has(i)) continue;
      const ring: [number, number][] = ways[i].geometry.map(toTuple);
      used.add(i);

      let closed = false;
      while (!closed) {
        const last = ring[ring.length - 1];
        let found = false;

        for (let j = 0; j < ways.length; j++) {
          if (used.has(j)) continue;
          const candidate = ways[j].geometry.map(toTuple);

          if (this.arePointsEqual(candidate[0], last)) {
            ring.push(...candidate.slice(1));
            used.add(j);
            found = true;
            break;
          } else if (
            this.arePointsEqual(candidate[candidate.length - 1], last)
          ) {
            ring.push(...candidate.reverse().slice(1));
            used.add(j);
            found = true;
            break;
          }
        }

        if (!found || this.arePointsEqual(ring[0], ring[ring.length - 1]))
          closed = true;
      }

      rings.push(ring);
    }

    return rings;
  }

  // 4. point 좌표 동일성 판단
  private arePointsEqual(a: [number, number], b: [number, number]): boolean {
    return Math.abs(a[0] - b[0]) < 1e-6 && Math.abs(a[1] - b[1]) < 1e-6;
  }

  // 5. GeoJSON 저장
  private saveGeoJSONToFile(
    countryName: string,
    fc: FeatureCollection,
  ): string {
    const folderPath = path.join(
      this.getOutputFolder(),
      this.sanitizeName(countryName),
      'admin_boundary',
    );
    const filePath = path.join(folderPath, 'admin_boundary.geojson');

    fs.mkdirSync(folderPath, { recursive: true });
    fs.writeFileSync(filePath, JSON.stringify(fc, null, 2), 'utf-8');

    return filePath;
  }
}

# GeoLinker

**GeoLinker** is a high-precision map-matching system that processes OpenStreetMap (OSM) road data by country, segments roads based on topological intersections, and matches GPS trajectory data (Frames) to the correct road segments using geometric similarity measures (e.g., Hausdorff distance). Built with NestJS, TypeORM, PostGIS, and Turf.js.

---

## 🌍 Key Features

- **National OSM Road Data Extraction**

  - Queries Overpass API for a target country and its administrative areas.
  - Stores highway-type roads in GeoJSON format per region.

- **Road Network Segmentation**

  - Converts ways into LineStrings.
  - Extracts Nodes at start/end points and intersections.
  - Splits Links by nearby Nodes using PostGIS `ST_Split` and handles self-intersections.

- **Node-Link Structuring**

  - Assigns `start_node` and `end_node` IDs to each road Link via spatial joins and proximity filtering.

- **Map Matching Engine**

  - Matches sequential GPS `Frame` points to candidate `Link` geometries.
  - Uses a combination of bounding box filtering, distance thresholds, and **Hausdorff distance** to evaluate best-fit links.
  - Supports adaptive link extension, fallback logic for short links, and direction-aware matching.

- **Scalable, Modular Architecture**
  - Easily expandable to other countries (e.g., South Korea, UAE, Saudi Arabia, Singapore).
  - Modular services for extraction, node generation, splitting, node-link assignment, and frame-link matching.

---

## 🛠️ Tech Stack

- **Backend:** NestJS, TypeORM, PostgreSQL, PostGIS
- **Geo Processing:** Turf.js, Overpass API
- **Language:** TypeScript
- **Geometry Ops:** ST_DWithin, ST_Intersection, ST_Split, ST_ClosestPoint, ST_HausdorffDistance

---

## 📁 Folder Structure

---

## 🚀 How It Works

1. **Fetch Road Data:**  
   Use Overpass API to retrieve all relevant `highway=*` elements by administrative area.

2. **Convert to LineString:**  
   Parse `way` elements into GeoJSON `LineString` features.

3. **Extract Nodes:**

   - Collect endpoints and `ST_Intersection` of overlapping links.
   - Store unique points as Node GeoJSONs.

4. **Split by Nodes:**  
   Use PostGIS `ST_Split` and recursive re-splitting to divide road segments at node locations.

5. **Assign Node IDs:**  
   Attach `start_node` and `end_node` to each link using `ST_ClosestPoint`.

6. **Match GPS Data:**  
   For each GPS trajectory (`Frame`), identify nearby candidate Links and match them using distance-based filtering + `ST_HausdorffDistance`.

---

## 📦 Example Output

- `/data/YYYYMMDD_OSM/South_Korea/Seoul/Seoul_3602297418_link.geojson`
- `/data/YYYYMMDD_OSM/South_Korea/Seoul/Seoul_3602297418_node.geojson`

---

## 📌 TODO

- [ ] Add support for temporal OSM diffs (e.g., `osmium`)
- [ ] Integrate optional direction-based yaw matching
- [ ] Extend to non-road OSM elements (e.g., footways, cycleways)
- [ ] Publish API interface for external frame matching

---

## 📄 License

MIT License.  
OSM data used under the [Open Database License](https://www.opendatacommons.org/licenses/odbl/).

---

## 🤝 Acknowledgements

Built with ❤️ using:

- [OpenStreetMap](https://www.openstreetmap.org/)
- [PostGIS](https://postgis.net/)
- [Turf.js](https://turfjs.org/)

---

## ⚙️ Development & NestJS CLI

<p align="center">
  <a href="http://nestjs.com/" target="blank"><img src="https://nestjs.com/img/logo-small.svg" width="120" alt="Nest Logo" /></a>
</p>

[circleci-image]: https://img.shields.io/circleci/build/github/nestjs/nest/master?token=abc123def456
[circleci-url]: https://circleci.com/gh/nestjs/nest

  <p align="center">A progressive <a href="http://nodejs.org" target="_blank">Node.js</a> framework for building efficient and scalable server-side applications.</p>
    <p align="center">
<a href="https://www.npmjs.com/~nestjscore" target="_blank"><img src="https://img.shields.io/npm/v/@nestjs/core.svg" alt="NPM Version" /></a>
<a href="https://www.npmjs.com/~nestjscore" target="_blank"><img src="https://img.shields.io/npm/l/@nestjs/core.svg" alt="Package License" /></a>
<a href="https://www.npmjs.com/~nestjscore" target="_blank"><img src="https://img.shields.io/npm/dm/@nestjs/common.svg" alt="NPM Downloads" /></a>
<a href="https://circleci.com/gh/nestjs/nest" target="_blank"><img src="https://img.shields.io/circleci/build/github/nestjs/nest/master" alt="CircleCI" /></a>
<a href="https://discord.gg/G7Qnnhy" target="_blank"><img src="https://img.shields.io/badge/discord-online-brightgreen.svg" alt="Discord"/></a>
<a href="https://opencollective.com/nest#backer" target="_blank"><img src="https://opencollective.com/nest/backers/badge.svg" alt="Backers on Open Collective" /></a>
<a href="https://opencollective.com/nest#sponsor" target="_blank"><img src="https://opencollective.com/nest/sponsors/badge.svg" alt="Sponsors on Open Collective" /></a>
  <a href="https://paypal.me/kamilmysliwiec" target="_blank"><img src="https://img.shields.io/badge/Donate-PayPal-ff3f59.svg" alt="Donate us"/></a>
    <a href="https://opencollective.com/nest#sponsor"  target="_blank"><img src="https://img.shields.io/badge/Support%20us-Open%20Collective-41B883.svg" alt="Support us"></a>
  <a href="https://twitter.com/nestframework" target="_blank"><img src="https://img.shields.io/twitter/follow/nestframework.svg?style=social&label=Follow" alt="Follow us on Twitter"></a>
</p>
  <!--[![Backers on Open Collective](https://opencollective.com/nest/backers/badge.svg)](https://opencollective.com/nest#backer)
  [![Sponsors on Open Collective](https://opencollective.com/nest/sponsors/badge.svg)](https://opencollective.com/nest#sponsor)-->

## Description

[Nest](https://github.com/nestjs/nest) framework TypeScript starter repository.

## Project setup

```bash
$ npm install
```

## Compile and run the project

```bash
# development
$ npm run start

# watch mode
$ npm run start:dev

# production mode
$ npm run start:prod
```

## Run tests

```bash
# unit tests
$ npm run test

# e2e tests
$ npm run test:e2e

# test coverage
$ npm run test:cov
```

## Deployment

When you're ready to deploy your NestJS application to production, there are some key steps you can take to ensure it runs as efficiently as possible. Check out the [deployment documentation](https://docs.nestjs.com/deployment) for more information.

If you are looking for a cloud-based platform to deploy your NestJS application, check out [Mau](https://mau.nestjs.com), our official platform for deploying NestJS applications on AWS. Mau makes deployment straightforward and fast, requiring just a few simple steps:

```bash
$ npm install -g @nestjs/mau
$ mau deploy
```

With Mau, you can deploy your application in just a few clicks, allowing you to focus on building features rather than managing infrastructure.

## Resources

Check out a few resources that may come in handy when working with NestJS:

- Visit the [NestJS Documentation](https://docs.nestjs.com) to learn more about the framework.
- For questions and support, please visit our [Discord channel](https://discord.gg/G7Qnnhy).
- To dive deeper and get more hands-on experience, check out our official video [courses](https://courses.nestjs.com/).
- Deploy your application to AWS with the help of [NestJS Mau](https://mau.nestjs.com) in just a few clicks.
- Visualize your application graph and interact with the NestJS application in real-time using [NestJS Devtools](https://devtools.nestjs.com).
- Need help with your project (part-time to full-time)? Check out our official [enterprise support](https://enterprise.nestjs.com).
- To stay in the loop and get updates, follow us on [X](https://x.com/nestframework) and [LinkedIn](https://linkedin.com/company/nestjs).
- Looking for a job, or have a job to offer? Check out our official [Jobs board](https://jobs.nestjs.com).

## Support

Nest is an MIT-licensed open source project. It can grow thanks to the sponsors and support by the amazing backers. If you'd like to join them, please [read more here](https://docs.nestjs.com/support).

## Stay in touch

- Author - [Kamil Myśliwiec](https://twitter.com/kammysliwiec)
- Website - [https://nestjs.com](https://nestjs.com/)
- Twitter - [@nestframework](https://twitter.com/nestframework)

## License

Nest is [MIT licensed](https://github.com/nestjs/nest/blob/master/LICENSE).

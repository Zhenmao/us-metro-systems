import * as d3 from "https://cdn.jsdelivr.net/npm/d3@7/+esm";
import * as topojson from "https://cdn.jsdelivr.net/npm/topojson-client@3.1.0/+esm";

Promise.all([
  d3.csv("./data/data.csv", d3.autoType),
  d3.json("./data/nation-10m.json"),
  d3.json("./data/grid-data.json"), // Pre-computed grid data
]).then(([csv, us, grid]) => {
  const gridStep = 10;
  const dotRadius = gridStep / 2 - 1;

  const marginTop = 20;
  const marginRight = 20;
  const marginBottom = 20;
  const marginLeft = -20;
  const boundedWidth = 960;
  const width = boundedWidth + marginLeft + marginBottom;

  const maxBubbleRadius = 100;

  const bubbleScale = d3.scaleSqrt().range([0, maxBubbleRadius]);

  const land = topojson.feature(us, us.objects.nation);
  const projection = d3.geoAlbersUsa();
  const bounds = d3
    .geoPath(projection.fitWidth(boundedWidth, land))
    .bounds(land);
  const boundedHeight = Math.ceil(bounds[1][1] - bounds[0][1]);
  const height = boundedHeight + marginTop + marginBottom;
  projection.fitExtent(
    [
      [marginLeft, marginTop],
      [width - marginRight, height - marginBottom],
    ],
    land
  );

  // https://observablehq.com/@neocartocnrs/grids
  function dotGrid(step, width, height) {
    // build grid
    let y = d3.range(0 + step / 2, height, step).reverse();
    let x = d3.range(0 + step / 2, width, step);
    let grid = x.map((x) => y.map((y) => [x, y])).flat();
    // build object
    let result = grid.map((d, i) => {
      return {
        type: "Feature",
        geometry: {
          type: "Point",
          coordinates: d,
        },
        properties: {
          index: i,
        },
      };
    });
    return result;
  }

  // https://observablehq.com/@neocartocnrs/world-grids
  function mapGrid(grid, projection, boundaryGeometry) {
    return grid.filter((e) => {
      const center = e.geometry.coordinates;
      const geoCenter = projection.invert(center);
      return d3.geoContains(boundaryGeometry, geoCenter);
    });
  }

  // Grid data computation is slow. A pre-computed grid data is used instead.

  // const landGeometry = land.features[0].geometry;
  // const grid = mapGrid(
  //   dotGrid(gridStep, width, height),
  //   projection,
  //   landGeometry
  // );

  const delaunay = d3.Delaunay.from(
    grid,
    (d) => d.geometry.coordinates[0],
    (d) => d.geometry.coordinates[1]
  );

  const positionedData = new Map();
  const data = csv
    .map((d) => {
      const position = projection(
        d["LatLong"]
          .split(",")
          .map((d) => +d)
          .reverse()
      );
      const i = delaunay.find(...position);
      if (positionedData.has(i)) {
        console.error(
          `${positionedData.has(i)["City"]} and ${
            d["City"]
          } are located in the same position index ${i}`
        );
      } else {
        positionedData.set(i, d);
      }
      return {
        city: d["City"],
        numberOfLines: d["Lines"],
        systemLength: d["System length (mi)"],
        ridership: d["Annual ridership (2024) (millions)"],
        cell: grid[i],
      };
    })
    .sort((a, b) => d3.descending(a.ridership, b.ridership));
  data.forEach((d, i) => (d.rank = i + 1));
  bubbleScale.domain([0, d3.max(data, (d) => d.ridership)]);

  d3.select("#spinner").remove();

  const container = d3.select("#mapWrapper").attr("class", "grid-map");
  const svg = container
    .append("svg")
    .attr("width", width)
    .attr("height", height)
    .attr("viewBox", [0, 0, width, height]);
  svg
    .append("g")
    .attr("class", "dots")
    .selectChildren()
    .data(grid)
    .join("circle")
    .attr("class", "dot")
    .attr("r", dotRadius)
    .attr("transform", (d) => `translate(${d.geometry.coordinates})`);
  const bubble = svg
    .append("g")
    .attr("class", "bubbles")
    .selectChildren()
    .data(data)
    .join("g")
    .attr("class", "bubble")
    .attr("transform", (d) => `translate(${d.cell.geometry.coordinates})`)
    .on("pointerenter", entered)
    .on("pointerleave", left)
    .on("touchstart", (e) => e.preventDefault(), { passive: true });
  bubble
    .append("circle")
    .attr("class", "bubble__body")
    .attr("r", (d) => bubbleScale(d.ridership));
  bubble.append("circle").attr("class", "bubble__anchor").attr("r", dotRadius);
  bubble
    .append("text")
    .attr("class", "bubble__rank")
    .attr("text-anchor", "middle")
    .attr("y", (d) => -bubbleScale(d.ridership) - 2)
    .text((d) => d.rank);

  const tooltip = container.append("div").attr("class", "tooltip");

  const formatValue = new Intl.NumberFormat("en-US", {}).format;

  function entered(_, d) {
    d3.select(this).classed("highlighted", true);
    tooltip
      .html(
        /*html*/ `
      <table>
        <tbody>
          <tr>
            <th scope="row" colspan="2">${d.rank}. ${d.city}</tH>
          </tr>
          <tr>
            <th scope="row">Annual ridership (2024)</tH>
            <td>${formatValue(d.ridership)}millions</td>
          </tr>
          <tr>
            <th scope="row"># of Lines</tH>
            <td>${d.numberOfLines}</td>
          </tr>
          <tr>
            <th scope="row">System length</tH>
            <td>${formatValue(d.systemLength)}mi</td>
          </tr>
        </tbody>
      </table>  
    `
      )
      .classed("visible", true);

    const tooltipRect = tooltip.node().getBoundingClientRect();
    const bubbleRect = d3
      .select(this)
      .select(".bubble__body")
      .node()
      .getBoundingClientRect();
    const boundsWidth = document.body.clientWidth;
    const boundsHeight = window.innerHeight;

    let x = bubbleRect.x + bubbleRect.width / 2 - tooltipRect.width / 2;
    if (x < 0) {
      x = 0;
    } else if (x + tooltipRect.width > boundsWidth) {
      x = boundsWidth - tooltipRect.width;
    }

    let y = bubbleRect.y - tooltipRect.height - 4;
    if (y < 0) {
      y = bubbleRect.y + bubbleRect.height + 4;
      if (y + tooltipRect.height > boundsHeight) {
        y = boundsHeight - tooltipRect.height;
      }
    }

    tooltip.style("transform", `translate(${x}px,${y}px)`);
  }

  function left() {
    d3.select(this).classed("highlighted", false);
    tooltip.classed("visible", false);
  }
});

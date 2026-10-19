import { expect, it } from "vitest";
import { generateCatalog } from "../../scripts/project-catalog";
import { renderCatalog } from "../../scripts/catalog/render";
import { Script } from "node:vm";
import { minimapClientToWorld } from "../../scripts/catalog/geometry.mjs";

it("generates an offline map containing the same nodes and relations as the catalog", async () => {
  const catalog = await generateCatalog();
  const html = renderCatalog(catalog)["map.html"];
  expect(html).toContain('id="graph-data"');
  expect(html).not.toMatch(/<script[^>]+src=/);
  const graph = JSON.parse(/<script id="graph-data" type="application\/json">([\s\S]*?)<\/script>/.exec(html)![1]);
  expect(graph.nodes.map((node: { id: string }) => node.id).sort()).toEqual(catalog.nodes.map(node => node.id).sort());
  expect(graph.edges).toHaveLength(catalog.relations.length);
  expect(graph.meta.fingerprint).toBe(catalog.provenance.fingerprint);
  expect(graph.nodes.find((node: { id: string }) => node.id === "table:applications").detail).toContain("class_name");
  expect(graph.nodes.find((node: { id: string }) => node.id === "flow:application.cancel").detail).toContain("mail_outbox");
  expect(graph.nodes.find((node: { id: string }) => node.id === "route:PATCH /api/console/applications/:application_id").detail).toContain("取消投递");
  for (const match of html.matchAll(/<script>([\s\S]*?)<\/script>/g)) expect(() => new Script(match[1])).not.toThrow();
});

it("treats graph strings as data, not executable HTML", async () => {
  const catalog = await generateCatalog();
  catalog.nodes[0].title = "</script><script>window.injected = true</script> __GEOMETRY_CODE__ __GRAPH_JSON__";
  const html = renderCatalog(catalog)["map.html"];
  expect(html).not.toContain("<script>window.injected");
  const graph = JSON.parse(/<script id="graph-data" type="application\/json">([\s\S]*?)<\/script>/.exec(html)![1]);
  expect(graph.nodes[0].title).toBe(catalog.nodes[0].title);
});

it("maps minimap center and edges identically at desktop and narrow display sizes", () => {
  const geometry = { width: 200, height: 132, scale: 0.184, offsetX: 8, offsetY: 20 };
  for (const [width, height] of [[200, 132], [130, 86]]) {
    const rect = { left: 15, top: 30, width, height };
    const center = minimapClientToWorld({ x: 15 + width / 2, y: 30 + height / 2 }, rect, geometry);
    expect(center.x).toBeCloseTo(500);
    expect(center.y).toBeCloseTo(250);
    const origin = minimapClientToWorld({ x: 15 + width * 8 / 200, y: 30 + height * 20 / 132 }, rect, geometry);
    expect(origin.x).toBeCloseTo(0);
    expect(origin.y).toBeCloseTo(0);
  }
});

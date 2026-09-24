// @vitest-environment node
import {describe,it,expect} from "vitest";
import {gzipSync} from "node:zlib";
import {readNetmobJson} from "../lib/netmobAssets";
describe("NetMob asset hosting",()=>{
 it("accepts raw gzip from static hosting and already-decoded JSON from an encoded response",async()=>{
  const text=JSON.stringify({version:"fixture",rides:{"line|stop":[120,3]}});
  expect(await readNetmobJson(new Response(gzipSync(text)))).toEqual(JSON.parse(text));
  expect(await readNetmobJson(new Response(text,{headers:{"Content-Encoding":"gzip"}}))).toEqual(JSON.parse(text));
  expect(await readNetmobJson(new Response(text))).toEqual(JSON.parse(text));
 });
 it("reports failed or invalid assets",async()=>{
  await expect(readNetmobJson(new Response("missing",{status:404}))).rejects.toThrow("404");
  await expect(readNetmobJson(new Response("<html>fallback</html>"))).rejects.toThrow();
 });
});

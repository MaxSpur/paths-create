/** Servers may deliver .gz as encoded JSON (fetch decodes it) or as raw gzip.
 * Inspect the payload so both Vite and static project-path hosting work. */
export async function readNetmobJson<T>(response:Response):Promise<T> {
  if(!response.ok)throw new Error(`HTTP ${response.status}: ${response.url}`);
  const bytes=new Uint8Array(await response.arrayBuffer());
  if(bytes[0]===0x1f&&bytes[1]===0x8b){
    if(typeof DecompressionStream==="undefined")throw new Error("This browser needs gzip DecompressionStream support for offline transit assets.");
    return new Response(new Response(bytes).body!.pipeThrough(new DecompressionStream("gzip"))).json();
  }
  return JSON.parse(new TextDecoder().decode(bytes)) as T;
}

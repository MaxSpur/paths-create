import {fileURLToPath} from 'node:url';
import {createManager} from './manager';
const manager=await createManager({root:process.cwd(),worker:fileURLToPath(new URL('./run.mjs',import.meta.url))});
manager.server.listen(5199,'127.0.0.1',()=>console.log(`NetMob controller: http://127.0.0.1:5199 · output: ${manager.outputRoot}\nOpen the existing app at http://127.0.0.1:5198/ → NetMob → Local runs. Keep this process running; the browser may close.`));
manager.server.on('error',error=>{console.error(error.message);process.exitCode=1;});
let stopping=false;const stop=()=>{if(stopping)return;stopping=true;void manager.close().then(()=>process.exit());};process.on('SIGINT',stop);process.on('SIGTERM',stop);

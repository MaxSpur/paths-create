import {spawn, execFileSync} from 'node:child_process';
import {existsSync, readFileSync, writeFileSync, openSync, closeSync, mkdirSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import path from 'node:path';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const runtime=path.join(root,'.local-ors');
const jar=path.join(runtime,'ors.jar');
const pidFile=path.join(runtime,'process.json');
const health='http://127.0.0.1:8082/ors/v2/health';
function ownedProcess(){
  try {
    const {pid}=JSON.parse(readFileSync(pidFile,'utf8'));
    if(!Number.isInteger(pid)||pid<=1) return null;
    const command=execFileSync('ps',['-p',String(pid),'-o','command='],{encoding:'utf8',stdio:['ignore','pipe','ignore']});
    return command.includes(jar) ? pid : null;
  } catch{return null;}
}
const action=process.argv[2]??'status';
if(action==='start'){
  if(ownedProcess()) {console.log('Local ORS is already starting/running. Use npm run ors:status.');process.exit(0);}
  if(!existsSync(jar)||!existsSync(path.join(runtime,'ile-de-france.osm.pbf'))) throw new Error('Missing ORS JAR or IDF PBF. Run npm run ors:install; see OFFLINE_ROUTING.md.');
  const java=process.env.JAVA_HOME ? path.join(process.env.JAVA_HOME,'bin','java') : 'java';
  try {execFileSync(java,['-version'],{stdio:'pipe'});}
  catch {throw new Error('Java is unavailable. Install Java 21 and check JAVA_HOME/PATH; see OFFLINE_ROUTING.md.');}
  // Never launch over an unrelated listener on the fixed port.
  const net=await import('node:net');
  const probe=net.createServer();
  await new Promise((resolve,reject)=>{probe.once('error',reject);probe.listen(8082,'127.0.0.1',()=>probe.close(resolve));});
  mkdirSync(path.join(runtime,'logs'),{recursive:true});
  const log=openSync(path.join(runtime,'logs','console.log'),'a');
  const child=spawn(java,['-Xms1g','-Xmx8g','-jar',jar],{
    cwd:runtime,detached:true,stdio:['ignore',log,log],
    env:{...process.env,ORS_CONFIG_LOCATION:path.join(root,'scripts','ors-config.yml')}
  });
  await new Promise((resolve,reject)=>{child.once('spawn',resolve);child.once('error',reject);});
  writeFileSync(pidFile,JSON.stringify({pid:child.pid,started:new Date().toISOString()},null,2)+'\n');
  closeSync(log);child.unref();
  console.log(`Local ORS started (PID ${child.pid}); initial graph build runs in background. Use npm run ors:status. Logs: .local-ors/logs/console.log`);
}else if(action==='stop'){
  const pid=ownedProcess();
  if(pid){process.kill(pid,'SIGTERM');console.log(`Sent graceful stop to local ORS (${pid}).`);}
  else console.log('No project-owned ORS process is running.');
}else if(action==='status'){
  console.log(ownedProcess()?'Project ORS process is running.':'No project-owned ORS process found.');
  try{const response=await fetch(health,{signal:AbortSignal.timeout(3000)});console.log(`HTTP ${response.status}: ${await response.text()}`);if(!response.ok)process.exitCode=1;}
  catch(error){console.log(`Not ready: ${error.message}. Inspect .local-ors/logs/console.log.`);process.exitCode=1;}
}else throw new Error('Usage: node scripts/local-ors.mjs start|status|stop');

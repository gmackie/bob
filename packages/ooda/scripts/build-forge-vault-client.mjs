/** Bundle the production vault client for a Node 24 host with Git; embeds no settings or credentials. */
import {createRequire} from 'node:module';
import {readFile,writeFile} from 'node:fs/promises';
import {resolve,dirname} from 'node:path';
import {fileURLToPath} from 'node:url';
import {createHash} from 'node:crypto';
import {execFileSync} from 'node:child_process';
const [forgeRoot,output]=process.argv.slice(2);
if(!forgeRoot||!output)throw Error('Usage: build-forge-vault-client.mjs <built-forge-root> <output.mjs>');
const ooda=resolve(dirname(fileURLToPath(import.meta.url)),'..');
const require=createRequire(resolve(forgeRoot,'examples/acme/package.json'));
const {build}=require('esbuild');
const dist=resolve(forgeRoot,'packages/runtime/dist');
const alias={
  '@forgegraph/runtime/artifact-publication':resolve(dist,'artifact-publication.js'),
  '@forgegraph/runtime/artifact-publication-git':resolve(dist,'adapters/artifact-publication-git.js'),
  '@forgegraph/runtime/artifact-publication-sql':resolve(dist,'adapters/artifact-publication-sql.js'),
};
const result=await build({entryPoints:[resolve(ooda,'deploy/forge-vault-client.mjs')],outfile:output,bundle:true,platform:'node',target:'node24',format:'esm',alias,nodePaths:[resolve(forgeRoot,'packages/runtime/node_modules')],metafile:true,banner:{js:"import {createRequire} from 'node:module';const require=createRequire(import.meta.url);"}});
let forgeRevision=null;
try{forgeRevision=execFileSync('git',['-C',forgeRoot,'rev-parse','HEAD'],{encoding:'utf8',stdio:['ignore','pipe','ignore']}).trim()}catch{}
await writeFile(output+'.manifest.json',JSON.stringify({sha256:createHash('sha256').update(await readFile(output)).digest('hex'),esbuildVersion:require('esbuild').version,forgeRevision,inputFiles:Object.keys(result.metafile.inputs).length,scope:'Production Bob vault client bundle; settings in client.json beside it, credential read from credentialPath'},null,2)+'\n');
console.log('Client bundle and digest written');
